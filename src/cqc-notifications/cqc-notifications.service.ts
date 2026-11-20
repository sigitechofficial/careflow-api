import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CqcNotification,
  CqcNotificationStatus,
  CqcNotificationType,
  CqcSubmissionMethod,
  Prisma,
  SafeguardingReferralDecision,
  SafeguardingStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { OrgScope } from '../common/org-scope/org-scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  CQC_NOTIFICATION_TARGET_HOURS,
  CQC_NOTIFICATION_TYPES,
  CQC_OTHERS_INFORMED,
  OPEN_CQC_NOTIFICATION_STATUSES,
  cleanDetails,
  dueAtFrom,
  formatCqcNotificationReference,
  isOverdue,
  readinessProblems,
  submittedLate,
  typeSpec,
} from './cqc-notification-types.util';
import {
  CQC_CANDIDATE_DAYS,
  abuseTypeForSafeguarding,
  suggestForIncident,
  viewableIncidentPrivacy,
} from './cqc-notification-links.util';
import type {
  AcknowledgeCqcNotificationDto,
  CloseCqcNotificationDto,
  CreateCqcNotificationDto,
  ListCqcNotificationsQueryDto,
  SubmitCqcNotificationDto,
  UpdateCqcNotificationDto,
} from './dto/cqc-notifications.dto';

const toIso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const text = (v: string | undefined) =>
  v === undefined ? undefined : v.trim() || null;

/** What was sent to CQC, frozen at submission (the print copy is built from this). */
export type CqcNotificationSnapshot = {
  referenceNumber: string;
  type: string;
  typeLabel: string;
  regulation: string;
  location: { id: string; name: string | null };
  /** Identifier only: CQC asks providers not to send names. */
  serviceUserIdentifier: string | null;
  incidentReference: string | null;
  safeguardingReference: string | null;
  eventOccurredAt: string | null;
  becameAwareAt: string;
  summary: string | null;
  actionsTaken: string | null;
  othersInformed: string[];
  details: Array<{ label: string; value: string }>;
  submittedAt: string;
  submissionMethod: CqcSubmissionMethod;
  cqcReference: string | null;
  /** Policies attached when it was sent ("we have this policy for it"). */
  policies: Array<{ reference: string; title: string; version: string | null }>;
};

/**
 * Governance → CQC notifications. Staff prepare a statutory notification (Reg 16 death, Reg 18
 * serious injury, abuse, police, events stopping the service), mark it ready, submit it themselves on
 * the CQC portal and record the submission and CQC's acknowledgement here. CareFlow never sends it.
 *
 * Branch scope: each notification belongs to one branch; branch-restricted users see and manage
 * only their branches' notifications.
 */
@Injectable()
export class CqcNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  // ─── Scope ────────────────────────────────────────────────────────────────

  visibleWhere(scope: OrgScope): Prisma.CqcNotificationWhereInput {
    if (scope.locationIds === null) return {};
    return { locationId: { in: scope.locationIds } };
  }

  /** The notification, if the user may see it (branch scope); used by the supporting-policies service too. */
  async requireVisible(
    user: RequestUser,
    id: string,
  ): Promise<CqcNotification> {
    const scope = this.orgScope.fromRequestUser(user);
    const row = await this.prisma.cqcNotification.findFirst({
      where: { AND: [{ id }, this.visibleWhere(scope)] },
    });
    if (!row) throw new NotFoundException('CQC notification not found');
    return row;
  }

  /** The branch to use: the one asked for (must be in scope), or the user's only branch. */
  private async resolveLocation(
    scope: OrgScope,
    requested: string | undefined,
  ): Promise<string> {
    let locationId = requested;
    if (!locationId && scope.locationIds?.length === 1)
      locationId = scope.locationIds[0];
    if (!locationId) throw new BadRequestException('Choose a branch');
    this.orgScope.assertLocationAccess(scope, locationId);
    const found = await this.prisma.location.count({
      where: { id: locationId, deletedAt: null },
    });
    if (!found) throw new BadRequestException('Branch not found');
    return locationId;
  }

  /** Linked records must exist and be visible to the user. */
  private async assertLinks(
    scope: OrgScope,
    links: {
      serviceUserId?: string | null;
      incidentId?: string | null;
      safeguardingCaseId?: string | null;
    },
  ) {
    if (links.serviceUserId)
      await this.orgScope.assertServiceUserInScope(scope, links.serviceUserId);
    if (links.incidentId) {
      await this.orgScope.assertIncidentInScope(scope, links.incidentId);
      const visible = await this.prisma.incident.count({
        where: {
          id: links.incidentId,
          privacyLevel: { in: viewableIncidentPrivacy(scope) },
        },
      });
      if (!visible) throw new NotFoundException('Incident not found');
    }
    if (links.safeguardingCaseId) {
      const found = await this.prisma.safeguardingCase.findFirst({
        where: { id: links.safeguardingCaseId, deletedAt: null },
        select: { locationId: true },
      });
      if (!found) throw new NotFoundException('Safeguarding case not found');
      if (found.locationId)
        this.orgScope.assertLocationAccess(scope, found.locationId);
    }
  }

  // ─── Reference data ───────────────────────────────────────────────────────

  types() {
    return {
      data: {
        targetHours: CQC_NOTIFICATION_TARGET_HOURS,
        types: CQC_NOTIFICATION_TYPES,
        othersInformed: CQC_OTHERS_INFORMED,
      },
    };
  }

  // ─── List / summary / detail ──────────────────────────────────────────────

  async list(user: RequestUser, query: ListCqcNotificationsQueryDto) {
    const scope = this.orgScope.fromRequestUser(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const now = new Date();
    const and: Prisma.CqcNotificationWhereInput[] = [this.visibleWhere(scope)];
    if (query.status) and.push({ status: query.status });
    if (query.type) and.push({ type: query.type });
    if (query.incidentId) and.push({ incidentId: query.incidentId });
    if (query.safeguardingCaseId)
      and.push({ safeguardingCaseId: query.safeguardingCaseId });
    if (query.locationId) {
      this.orgScope.assertLocationAccess(scope, query.locationId);
      and.push({ locationId: query.locationId });
    }
    if (query.overdue === true)
      and.push({
        status: { in: OPEN_CQC_NOTIFICATION_STATUSES },
        dueAt: { lt: now },
      });
    if (query.search) {
      const q = query.search.trim();
      and.push({
        OR: [
          { referenceNumber: { contains: q, mode: 'insensitive' } },
          { cqcReference: { contains: q, mode: 'insensitive' } },
          { summary: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.CqcNotificationWhereInput = { AND: and };
    const [total, rows] = await Promise.all([
      this.prisma.cqcNotification.count({ where }),
      this.prisma.cqcNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const [locations, serviceUsers] = await Promise.all([
      this.locationNames(rows.map((r) => r.locationId)),
      this.serviceUsers(rows.map((r) => r.serviceUserId)),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id,
        referenceNumber: r.referenceNumber,
        type: r.type,
        typeLabel: typeSpec(r.type).label,
        status: r.status,
        location: {
          id: r.locationId,
          name: locations.get(r.locationId) ?? null,
        },
        serviceUser: r.serviceUserId
          ? (serviceUsers.get(r.serviceUserId) ?? {
              id: r.serviceUserId,
              name: null,
              identifier: null,
            })
          : null,
        eventOccurredAt: toIso(r.eventOccurredAt),
        becameAwareAt: r.becameAwareAt.toISOString(),
        dueAt: r.dueAt.toISOString(),
        submittedAt: toIso(r.submittedAt),
        cqcReference: r.cqcReference,
        overdue: isOverdue(r, now),
        submittedLate: submittedLate(r),
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  /** Counts for the list page cards. */
  async summary(user: RequestUser, locationId?: string) {
    const scope = this.orgScope.fromRequestUser(user);
    const and: Prisma.CqcNotificationWhereInput[] = [this.visibleWhere(scope)];
    if (locationId) {
      this.orgScope.assertLocationAccess(scope, locationId);
      and.push({ locationId });
    }
    const now = new Date();
    const soon = new Date(now.getTime() + 4 * 3600_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const open = { status: { in: OPEN_CQC_NOTIFICATION_STATUSES } };
    const count = (extra: Prisma.CqcNotificationWhereInput) =>
      this.prisma.cqcNotification.count({ where: { AND: [...and, extra] } });
    const [drafts, ready, dueSoon, overdue, submittedThisMonth] =
      await Promise.all([
        count({ status: CqcNotificationStatus.DRAFT }),
        count({ status: CqcNotificationStatus.READY }),
        count({ ...open, dueAt: { gte: now, lt: soon } }),
        count({ ...open, dueAt: { lt: now } }),
        count({ submittedAt: { gte: monthStart } }),
      ]);
    return { data: { drafts, ready, dueSoon, overdue, submittedThisMonth } };
  }

  async get(user: RequestUser, id: string) {
    return { data: await this.detail(await this.requireVisible(user, id)) };
  }

  async detail(row: CqcNotification) {
    const spec = typeSpec(row.type);
    const [locations, serviceUsers, users, incident, safeguarding] =
      await Promise.all([
        this.locationNames([row.locationId]),
        this.serviceUsers([row.serviceUserId]),
        this.userNames([
          row.createdById,
          row.updatedById,
          row.readyById,
          row.submittedById,
          row.closedById,
        ]),
        row.incidentId
          ? this.prisma.incident.findFirst({
              where: { id: row.incidentId },
              select: { id: true, referenceNumber: true },
            })
          : null,
        row.safeguardingCaseId
          ? this.prisma.safeguardingCase.findFirst({
              where: { id: row.safeguardingCaseId },
              select: { id: true, referenceNumber: true },
            })
          : null,
      ]);
    const person = (id: string | null) =>
      id ? { id, name: users.get(id) ?? null } : null;
    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      type: row.type,
      typeLabel: spec.label,
      regulation: spec.regulation,
      status: row.status,
      location: {
        id: row.locationId,
        name: locations.get(row.locationId) ?? null,
      },
      serviceUser: row.serviceUserId
        ? (serviceUsers.get(row.serviceUserId) ?? {
            id: row.serviceUserId,
            name: null,
            identifier: null,
          })
        : null,
      incident,
      safeguardingCase: safeguarding,
      eventOccurredAt: toIso(row.eventOccurredAt),
      becameAwareAt: row.becameAwareAt.toISOString(),
      dueAt: row.dueAt.toISOString(),
      summary: row.summary,
      actionsTaken: row.actionsTaken,
      othersInformed: row.othersInformed,
      details: row.details,
      missing: OPEN_CQC_NOTIFICATION_STATUSES.includes(row.status)
        ? readinessProblems(row)
        : [],
      overdue: isOverdue(row, new Date()),
      submittedLate: submittedLate(row),
      readyAt: toIso(row.readyAt),
      readyBy: person(row.readyById),
      submissionMethod: row.submissionMethod,
      submittedAt: toIso(row.submittedAt),
      submittedBy: person(row.submittedById),
      submittedSnapshot: row.submittedSnapshot,
      cqcReference: row.cqcReference,
      acknowledgedAt: toIso(row.acknowledgedAt),
      closedReason: row.closedReason,
      closedAt: toIso(row.closedAt),
      closedBy: person(row.closedById),
      createdBy: person(row.createdById),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ─── Create / update ──────────────────────────────────────────────────────

  async create(
    user: RequestUser,
    dto: CreateCqcNotificationDto,
    meta?: RequestAuditMeta,
  ) {
    const scope = this.orgScope.fromRequestUser(user);
    await this.assertLinks(scope, dto);
    // Answers not given are taken from the linked incident or safeguarding case.
    const from = await this.prefill(dto);
    const locationId = await this.resolveLocation(
      scope,
      dto.locationId ?? from.locationId ?? undefined,
    );
    const details = this.details(dto.type, {
      ...(dto.type === CqcNotificationType.ABUSE_ALLEGATION
        ? from.abuseDetails
        : {}),
      ...(dto.details ?? {}),
    });
    const becameAwareAt =
      this.date(dto.becameAwareAt, 'becameAwareAt') ??
      from.becameAwareAt ??
      new Date();
    const eventOccurredAt =
      dto.eventOccurredAt === undefined
        ? (from.eventOccurredAt ?? null)
        : dto.eventOccurredAt
          ? this.date(dto.eventOccurredAt, 'eventOccurredAt')!
          : null;
    const year = becameAwareAt.getFullYear();
    const created = await this.prisma.$transaction(async (tx) => {
      const referenceNumber = await this.allocateReference(tx, year);
      return tx.cqcNotification.create({
        data: {
          referenceNumber,
          type: dto.type,
          locationId,
          serviceUserId:
            dto.serviceUserId === undefined
              ? (from.serviceUserId ?? null)
              : dto.serviceUserId,
          incidentId: dto.incidentId ?? null,
          safeguardingCaseId: dto.safeguardingCaseId ?? null,
          eventOccurredAt,
          becameAwareAt,
          dueAt: dueAtFrom(becameAwareAt),
          summary: text(dto.summary) ?? from.summary ?? null,
          actionsTaken: text(dto.actionsTaken) ?? from.actionsTaken ?? null,
          othersInformed: [...new Set(dto.othersInformed ?? [])],
          details: details,
          createdById: user.id,
          updatedById: user.id,
        },
      });
    });
    await this.log(
      user,
      AuditAction.CQC_NOTIFICATION_CREATED,
      created.id,
      meta,
      undefined,
      auditSnapshot(created),
    );
    return {
      message: 'Notification created',
      data: await this.detail(created),
    };
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateCqcNotificationDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireVisible(user, id);
    this.assertStatus(existing, OPEN_CQC_NOTIFICATION_STATUSES, 'changed');
    const scope = this.orgScope.fromRequestUser(user);
    const data: Prisma.CqcNotificationUncheckedUpdateInput = {
      updatedById: user.id,
    };
    if (dto.locationId !== undefined && dto.locationId !== existing.locationId)
      data.locationId = await this.resolveLocation(scope, dto.locationId);
    await this.assertLinks(scope, {
      serviceUserId:
        dto.serviceUserId !== existing.serviceUserId
          ? dto.serviceUserId
          : undefined,
      incidentId:
        dto.incidentId !== existing.incidentId ? dto.incidentId : undefined,
      safeguardingCaseId:
        dto.safeguardingCaseId !== existing.safeguardingCaseId
          ? dto.safeguardingCaseId
          : undefined,
    });
    if (dto.serviceUserId !== undefined) data.serviceUserId = dto.serviceUserId;
    if (dto.incidentId !== undefined) data.incidentId = dto.incidentId;
    if (dto.safeguardingCaseId !== undefined)
      data.safeguardingCaseId = dto.safeguardingCaseId;
    if (dto.eventOccurredAt !== undefined)
      data.eventOccurredAt = dto.eventOccurredAt
        ? this.date(dto.eventOccurredAt, 'eventOccurredAt')
        : null;
    if (dto.becameAwareAt !== undefined) {
      const aware = this.date(dto.becameAwareAt, 'becameAwareAt')!;
      data.becameAwareAt = aware;
      data.dueAt = dueAtFrom(aware);
    }
    if (dto.summary !== undefined) data.summary = text(dto.summary);
    if (dto.actionsTaken !== undefined)
      data.actionsTaken = text(dto.actionsTaken);
    if (dto.othersInformed !== undefined)
      data.othersInformed = [...new Set(dto.othersInformed)];
    if (dto.details !== undefined) {
      // Answers are merged, so the form can send only what changed.
      const merged = {
        ...(existing.details as Record<string, unknown>),
        ...this.details(existing.type, dto.details),
      };
      data.details = merged as Prisma.InputJsonValue;
    }
    if (existing.status === CqcNotificationStatus.READY) {
      const problems = readinessProblems({
        type: existing.type,
        eventOccurredAt:
          data.eventOccurredAt !== undefined
            ? (data.eventOccurredAt as Date | null)
            : existing.eventOccurredAt,
        summary:
          data.summary !== undefined
            ? (data.summary as string | null)
            : existing.summary,
        actionsTaken:
          data.actionsTaken !== undefined
            ? (data.actionsTaken as string | null)
            : existing.actionsTaken,
        details: data.details ?? existing.details,
      });
      if (problems.length)
        throw new BadRequestException(
          `A ready notification needs: ${problems.join(', ')}. Move it back to draft first.`,
        );
    }
    const updated = await this.prisma.cqcNotification.update({
      where: { id },
      data,
    });
    await this.log(
      user,
      AuditAction.CQC_NOTIFICATION_UPDATED,
      id,
      meta,
      auditSnapshot(existing),
      auditSnapshot(updated),
    );
    return {
      message: 'Notification updated',
      data: await this.detail(updated),
    };
  }

  // ─── Status changes ───────────────────────────────────────────────────────

  async markReady(user: RequestUser, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireVisible(user, id);
    this.assertStatus(existing, [CqcNotificationStatus.DRAFT], 'marked ready');
    const problems = readinessProblems(existing);
    if (problems.length)
      throw new BadRequestException(`Still needed: ${problems.join(', ')}`);
    return this.transition(
      user,
      existing,
      AuditAction.CQC_NOTIFICATION_READY,
      meta,
      {
        status: CqcNotificationStatus.READY,
        readyAt: new Date(),
        readyById: user.id,
      },
      'Notification ready to submit',
    );
  }

  /** Back to draft: from ready (to change it) or not required (decision changed). */
  async reopen(user: RequestUser, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireVisible(user, id);
    this.assertStatus(
      existing,
      [CqcNotificationStatus.READY, CqcNotificationStatus.NOT_REQUIRED],
      'moved back to draft',
    );
    return this.transition(
      user,
      existing,
      AuditAction.CQC_NOTIFICATION_REOPENED,
      meta,
      {
        status: CqcNotificationStatus.DRAFT,
        readyAt: null,
        readyById: null,
        closedReason: null,
        closedAt: null,
        closedById: null,
      },
      'Notification moved back to draft',
    );
  }

  /** Records that staff submitted it on the CQC portal (or by the CQC form); freezes what was sent. */
  async submit(
    user: RequestUser,
    id: string,
    dto: SubmitCqcNotificationDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireVisible(user, id);
    this.assertStatus(existing, [CqcNotificationStatus.READY], 'submitted');
    const submittedAt = this.date(dto.submittedAt, 'submittedAt')!;
    if (submittedAt.getTime() > Date.now() + 60_000)
      throw new BadRequestException(
        'The submission time cannot be in the future',
      );
    if (submittedAt.getTime() < existing.createdAt.getTime() - 60_000)
      throw new BadRequestException(
        'The submission time cannot be before the notification was created here',
      );
    const cqcReference = text(dto.cqcReference) ?? null;
    const snapshot = await this.snapshot(
      existing,
      submittedAt,
      dto.method,
      cqcReference,
    );
    return this.transition(
      user,
      existing,
      AuditAction.CQC_NOTIFICATION_SUBMITTED,
      meta,
      {
        status: CqcNotificationStatus.SUBMITTED,
        submittedAt,
        submittedById: user.id,
        submissionMethod: dto.method,
        cqcReference,
        submittedSnapshot: snapshot,
      },
      'Submission recorded',
      (tx, updated) => this.syncLinked(tx, user, updated, 'submitted'),
    );
  }

  async acknowledge(
    user: RequestUser,
    id: string,
    dto: AcknowledgeCqcNotificationDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireVisible(user, id);
    this.assertStatus(
      existing,
      [CqcNotificationStatus.SUBMITTED],
      'acknowledged',
    );
    const acknowledgedAt =
      this.date(dto.acknowledgedAt, 'acknowledgedAt') ?? new Date();
    if (
      existing.submittedAt &&
      acknowledgedAt.getTime() < existing.submittedAt.getTime()
    )
      throw new BadRequestException(
        'Acknowledgement cannot be before submission',
      );
    const cqcReference = text(dto.cqcReference);
    if (!cqcReference && !existing.cqcReference)
      throw new BadRequestException('Enter the CQC reference');
    return this.transition(
      user,
      existing,
      AuditAction.CQC_NOTIFICATION_ACKNOWLEDGED,
      meta,
      {
        status: CqcNotificationStatus.ACKNOWLEDGED,
        acknowledgedAt,
        ...(cqcReference ? { cqcReference } : {}),
      },
      'Acknowledgement recorded',
      (tx, updated) => this.syncLinked(tx, user, updated, 'acknowledged'),
    );
  }

  async markNotRequired(
    user: RequestUser,
    id: string,
    dto: CloseCqcNotificationDto,
    meta?: RequestAuditMeta,
  ) {
    return this.close(user, id, dto, CqcNotificationStatus.NOT_REQUIRED, meta);
  }

  async cancel(
    user: RequestUser,
    id: string,
    dto: CloseCqcNotificationDto,
    meta?: RequestAuditMeta,
  ) {
    return this.close(user, id, dto, CqcNotificationStatus.CANCELLED, meta);
  }

  private async close(
    user: RequestUser,
    id: string,
    dto: CloseCqcNotificationDto,
    status: 'NOT_REQUIRED' | 'CANCELLED',
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireVisible(user, id);
    this.assertStatus(
      existing,
      OPEN_CQC_NOTIFICATION_STATUSES,
      status === 'CANCELLED' ? 'cancelled' : 'marked not required',
    );
    return this.transition(
      user,
      existing,
      status === 'CANCELLED'
        ? AuditAction.CQC_NOTIFICATION_CANCELLED
        : AuditAction.CQC_NOTIFICATION_NOT_REQUIRED,
      meta,
      {
        status,
        closedReason: dto.reason.trim(),
        closedAt: new Date(),
        closedById: user.id,
      },
      status === 'CANCELLED' ? 'Notification cancelled' : 'Marked not required',
    );
  }

  private async transition(
    user: RequestUser,
    existing: CqcNotification,
    action: AuditAction,
    meta: RequestAuditMeta | undefined,
    data: Prisma.CqcNotificationUncheckedUpdateInput,
    message: string,
    after?: (
      tx: Prisma.TransactionClient,
      updated: CqcNotification,
    ) => Promise<void>,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // Only moves from the status we checked, so two people acting at once cannot both succeed.
      const { count } = await tx.cqcNotification.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { ...data, updatedById: user.id },
      });
      if (!count)
        throw new ConflictException(
          'This notification was changed by someone else. Reload it.',
        );
      const row = await tx.cqcNotification.findUniqueOrThrow({
        where: { id: existing.id },
      });
      if (after) await after(tx, row);
      return row;
    });
    await this.log(
      user,
      action,
      existing.id,
      meta,
      auditSnapshot(existing),
      auditSnapshot(updated),
    );
    return { message, data: await this.detail(updated) };
  }

  private assertStatus(
    row: CqcNotification,
    allowed: CqcNotificationStatus[],
    verb: string,
  ) {
    if (!allowed.includes(row.status))
      throw new BadRequestException(
        `This notification is ${row.status.toLowerCase().replace('_', ' ')} and cannot be ${verb}`,
      );
  }

  // ─── Links to incidents and safeguarding ──────────────────────────────────

  /** What a new notification can take from its linked incident or safeguarding case. */
  private async prefill(dto: CreateCqcNotificationDto): Promise<{
    locationId?: string | null;
    serviceUserId?: string | null;
    eventOccurredAt?: Date | null;
    becameAwareAt?: Date;
    summary?: string | null;
    actionsTaken?: string | null;
    abuseDetails?: Record<string, string>;
  }> {
    const suBranch = async (serviceUserId: string | null) =>
      serviceUserId
        ? ((
            await this.prisma.serviceUser.findFirst({
              where: { id: serviceUserId },
              select: { locationId: true },
            })
          )?.locationId ?? null)
        : null;
    if (dto.incidentId) {
      const i = await this.prisma.incident.findFirst({
        where: { id: dto.incidentId, deletedAt: null },
        select: {
          locationId: true,
          primaryServiceUserId: true,
          occurredAt: true,
          reportedAt: true,
          description: true,
          immediateActions: true,
        },
      });
      if (i)
        return {
          locationId: i.locationId ?? (await suBranch(i.primaryServiceUserId)),
          serviceUserId: i.primaryServiceUserId,
          eventOccurredAt: i.occurredAt,
          // The service knew once the incident was reported.
          becameAwareAt: i.reportedAt,
          summary: i.description.trim() || null,
          actionsTaken: i.immediateActions?.trim() || null,
        };
    }
    if (dto.safeguardingCaseId) {
      const c = await this.prisma.safeguardingCase.findFirst({
        where: { id: dto.safeguardingCaseId, deletedAt: null },
        select: {
          locationId: true,
          aboutServiceUserId: true,
          raisedAt: true,
          description: true,
          immediateAction: true,
          category: true,
          laReference: true,
        },
      });
      if (c)
        return {
          locationId: c.locationId ?? (await suBranch(c.aboutServiceUserId)),
          serviceUserId: c.aboutServiceUserId,
          // When the concern was raised is when the service knew; when the abuse happened is
          // often unknown, so it is left for the manager to fill in.
          becameAwareAt: c.raisedAt,
          summary: c.description.trim() || null,
          actionsTaken: c.immediateAction?.trim() || null,
          abuseDetails: {
            abuseType: abuseTypeForSafeguarding(c.category),
            ...(c.laReference ? { safeguardingReference: c.laReference } : {}),
          },
        };
    }
    return {};
  }

  /**
   * Incidents and safeguarding cases from the last 30 days that look notifiable and have no CQC
   * notification yet (not even one marked not required). A suggestion only.
   */
  async candidates(user: RequestUser) {
    const scope = this.orgScope.fromRequestUser(user);
    const since = new Date(Date.now() - CQC_CANDIDATE_DAYS * 86_400_000);
    const linked = await this.prisma.cqcNotification.findMany({
      where: {
        OR: [
          { incidentId: { not: null } },
          { safeguardingCaseId: { not: null } },
        ],
      },
      select: { incidentId: true, safeguardingCaseId: true },
    });
    const linkedIncidents = linked
      .map((l) => l.incidentId)
      .filter((v): v is string => Boolean(v));
    const linkedCases = linked
      .map((l) => l.safeguardingCaseId)
      .filter((v): v is string => Boolean(v));
    const incidentScope = await this.orgScope.incidentScopeWhere(scope);
    const [incidents, cases] = await Promise.all([
      this.prisma.incident.findMany({
        where: {
          AND: [
            incidentScope ?? {},
            {
              deletedAt: null,
              occurredAt: { gte: since },
              id: { notIn: linkedIncidents },
              privacyLevel: { in: viewableIncidentPrivacy(user) },
            },
            {
              OR: [
                { category: { key: { in: ['DEATH', 'SAFEGUARDING'] } } },
                { carerSafeguardingConcern: true },
                { admittedToHospital: true },
                { whoInformedKeys: { has: 'police' } },
                {
                  externalBodies: {
                    some: { bodyType: 'POLICE', deletedAt: null },
                  },
                },
              ],
            },
          ],
        },
        orderBy: { occurredAt: 'desc' },
        take: 100,
        select: {
          id: true,
          referenceNumber: true,
          occurredAt: true,
          locationId: true,
          primaryServiceUserId: true,
          admittedToHospital: true,
          whoInformedKeys: true,
          carerSafeguardingConcern: true,
          category: { select: { key: true, label: true } },
          externalBodies: {
            where: { deletedAt: null },
            select: { bodyType: true },
          },
        },
      }),
      this.prisma.safeguardingCase.findMany({
        where: {
          deletedAt: null,
          status: { not: SafeguardingStatus.CLOSED },
          cqcNotified: SafeguardingReferralDecision.PENDING,
          id: { notIn: linkedCases },
          ...(scope.locationIds === null
            ? {}
            : { locationId: { in: scope.locationIds } }),
        },
        orderBy: { raisedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          referenceNumber: true,
          raisedAt: true,
          locationId: true,
          aboutServiceUserId: true,
          category: true,
        },
      }),
    ]);
    const [locations, serviceUsers] = await Promise.all([
      this.locationNames([
        ...incidents.map((i) => i.locationId),
        ...cases.map((c) => c.locationId),
      ]),
      this.serviceUsers([
        ...incidents.map((i) => i.primaryServiceUserId),
        ...cases.map((c) => c.aboutServiceUserId),
      ]),
    ]);
    const ref = (map: Map<string, string>, id: string | null) =>
      id ? { id, name: map.get(id) ?? null } : null;
    const person = (id: string | null) => {
      const su = id ? serviceUsers.get(id) : undefined;
      return su ? { id: su.id, name: su.name } : null;
    };
    const rows = [
      ...incidents.flatMap((i) => {
        const s = suggestForIncident({
          categoryKey: i.category.key,
          admittedToHospital: i.admittedToHospital,
          whoInformedKeys: i.whoInformedKeys,
          externalBodyTypes: i.externalBodies.map((b) => b.bodyType),
          carerSafeguardingConcern: i.carerSafeguardingConcern,
        });
        if (!s) return [];
        return [
          {
            source: 'INCIDENT' as const,
            id: i.id,
            referenceNumber: i.referenceNumber,
            title: i.category.label,
            occurredAt: i.occurredAt.toISOString(),
            location: ref(locations, i.locationId),
            serviceUser: person(i.primaryServiceUserId),
            reason: s.reason,
            suggestedType: s.type,
            suggestedTypeLabel: typeSpec(s.type).label,
          },
        ];
      }),
      ...cases.map((c) => ({
        source: 'SAFEGUARDING' as const,
        id: c.id,
        referenceNumber: c.referenceNumber,
        title: 'Safeguarding case',
        occurredAt: c.raisedAt.toISOString(),
        location: ref(locations, c.locationId),
        serviceUser: person(c.aboutServiceUserId),
        reason: 'CQC decision pending on the case',
        suggestedType: CqcNotificationType.ABUSE_ALLEGATION,
        suggestedTypeLabel: typeSpec(CqcNotificationType.ABUSE_ALLEGATION)
          .label,
      })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return { data: rows };
  }

  /**
   * Keeps the linked records in step when a notification is submitted or acknowledged: the
   * safeguarding case's CQC decision and reference, and a CQC row in the incident's external bodies.
   */
  private async syncLinked(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    n: CqcNotification,
    what: 'submitted' | 'acknowledged',
  ) {
    const line = `CQC notification ${n.referenceNumber} ${what}${n.cqcReference ? ` (CQC ref ${n.cqcReference})` : ''}`;
    if (n.safeguardingCaseId) {
      const c = await tx.safeguardingCase.findFirst({
        where: { id: n.safeguardingCaseId, deletedAt: null },
        select: { cqcNotified: true, cqcReference: true },
      });
      if (c) {
        await tx.safeguardingCase.update({
          where: { id: n.safeguardingCaseId },
          data: {
            cqcNotified: SafeguardingReferralDecision.MADE,
            ...(n.cqcReference && !c.cqcReference
              ? { cqcReference: n.cqcReference }
              : {}),
          },
        });
        await tx.safeguardingEvent.create({
          data: { caseId: n.safeguardingCaseId, action: line, userId: user.id },
        });
      }
    }
    if (n.incidentId && n.submittedAt) {
      const marker = `Statutory notification ${n.referenceNumber}`;
      const existing = await tx.incidentExternalBody.findFirst({
        where: {
          incidentId: n.incidentId,
          bodyType: 'CQC',
          deletedAt: null,
          informationProvided: { startsWith: marker },
        },
      });
      if (!existing) {
        await tx.incidentExternalBody.create({
          data: {
            incidentId: n.incidentId,
            bodyType: 'CQC',
            organisationName: 'Care Quality Commission',
            referredOn: new Date(
              `${n.submittedAt.toISOString().slice(0, 10)}T00:00:00.000Z`,
            ),
            referenceNumber: n.cqcReference,
            role: 'INFORMED',
            status: 'REFERRED',
            informationProvided: `${marker} (${typeSpec(n.type).label}), recorded in CQC notifications.`,
            createdById: user.id,
            updatedById: user.id,
          },
        });
      } else if (n.cqcReference && !existing.referenceNumber) {
        await tx.incidentExternalBody.update({
          where: { id: existing.id },
          data: { referenceNumber: n.cqcReference, updatedById: user.id },
        });
      } else {
        return;
      }
      // Same timeline line the incident page shows for external body changes.
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentExternalBodyChange',
        recordId: n.incidentId,
        description: line,
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private details(type: CqcNotification['type'], input: unknown) {
    const result = cleanDetails(type, input);
    if (!result.ok) throw new BadRequestException(result.error);
    return result.details;
  }

  private date(value: string | undefined, field: string): Date | undefined {
    if (value === undefined) return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
      throw new BadRequestException(`${field} is not a valid date`);
    return d;
  }

  private async snapshot(
    row: CqcNotification,
    submittedAt: Date,
    method: CqcSubmissionMethod,
    cqcReference: string | null,
  ): Promise<CqcNotificationSnapshot> {
    const spec = typeSpec(row.type);
    const d = await this.detail(row);
    const answers = (row.details ?? {}) as Record<string, unknown>;
    const details = spec.fields
      .filter((f) => answers[f.key] !== undefined && answers[f.key] !== null)
      .map((f) => {
        const v = answers[f.key];
        const value =
          f.kind === 'boolean'
            ? v
              ? 'Yes'
              : 'No'
            : f.kind === 'select'
              ? (f.options?.find((o) => o.value === v)?.label ?? String(v))
              : String(v);
        return { label: f.label, value };
      });
    return {
      referenceNumber: row.referenceNumber,
      type: row.type,
      typeLabel: spec.label,
      regulation: spec.regulation,
      location: d.location,
      serviceUserIdentifier: d.serviceUser?.identifier ?? null,
      incidentReference: d.incident?.referenceNumber ?? null,
      safeguardingReference: d.safeguardingCase?.referenceNumber ?? null,
      eventOccurredAt: toIso(row.eventOccurredAt),
      becameAwareAt: row.becameAwareAt.toISOString(),
      summary: row.summary,
      actionsTaken: row.actionsTaken,
      othersInformed: row.othersInformed.map(
        (k) => CQC_OTHERS_INFORMED.find((o) => o.value === k)?.label ?? k,
      ),
      details,
      submittedAt: submittedAt.toISOString(),
      submissionMethod: method,
      cqcReference,
      policies: (
        await this.prisma.cqcNotificationPolicy.findMany({
          where: { notificationId: row.id },
          orderBy: { addedAt: 'asc' },
          select: {
            referenceSnapshot: true,
            titleSnapshot: true,
            versionLabel: true,
          },
        })
      ).map((p) => ({
        reference: p.referenceSnapshot,
        title: p.titleSnapshot,
        version: p.versionLabel,
      })),
    };
  }

  private async allocateReference(
    tx: Prisma.TransactionClient,
    year: number,
  ): Promise<string> {
    // Same atomic upsert-and-increment as incident references.
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
      INSERT INTO "quality"."CqcNotificationNumberSequence" ("year", "lastValue", "updatedAt")
      VALUES (${year}, 1, now())
      ON CONFLICT ("year")
      DO UPDATE SET "lastValue" = "CqcNotificationNumberSequence"."lastValue" + 1, "updatedAt" = now()
      RETURNING "lastValue"
    `);
    return formatCqcNotificationReference(year, rows[0]?.lastValue ?? 1);
  }

  private async log(
    user: RequestUser,
    action: AuditAction,
    recordId: string,
    meta?: RequestAuditMeta,
    oldValues?: unknown,
    newValues?: unknown,
  ) {
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_NOTIFICATIONS,
      action,
      recordType: 'CqcNotification',
      recordId,
      ...(oldValues !== undefined ? { oldValues } : {}),
      ...(newValues !== undefined ? { newValues } : {}),
      ...meta,
    });
  }

  /** Name for staff screens; identifier (service user number) for what goes to CQC. */
  private async serviceUsers(
    ids: Array<string | null | undefined>,
  ): Promise<
    Map<string, { id: string; name: string; identifier: string | null }>
  > {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.serviceUser.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
      },
    });
    return new Map(
      rows.map((s) => [
        s.id,
        {
          id: s.id,
          name: [s.preferredName || s.firstName, s.lastName]
            .filter(Boolean)
            .join(' '),
          identifier: s.serviceUserNumber,
        },
      ]),
    );
  }

  private async userNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          u.email ||
          'User',
      ]),
    );
  }

  private async locationNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.location.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((l) => [l.id, l.name]));
  }
}
