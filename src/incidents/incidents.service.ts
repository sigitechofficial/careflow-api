import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IncidentActionPriority,
  IncidentActionStatus,
  IncidentPrivacyLevel,
  IncidentSeverity,
  IncidentStatus,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto';
import {
  AssignIncidentOwnerDto,
  ChangeIncidentSeverityDto,
  ChangeIncidentStatusDto,
} from './dto/incident-workflow.dto';
import {
  UpsertIncidentInvestigationDto,
  UpsertIncidentReviewDto,
} from './dto/incident-review.dto';
import {
  CompleteIncidentActionDto,
  CreateIncidentActionDto,
  UpdateIncidentActionDto,
} from './dto/incident-action.dto';
import { UpsertIncidentOutcomeDto } from './dto/incident-outcome.dto';
import { effectiveActionStatus, isActionOverdue } from './incident-action.util';
import {
  INCIDENT_PRIVACY_RANK,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  OPEN_INCIDENT_STATUSES,
  canTransitionIncidentStatus,
  formatIncidentReference,
} from './incident-workflow.util';

const SUPER_ADMIN_ROLE = 'Super Admin';
const REFERENCE_MAX_RETRIES = 5;

type IncidentWithRefs = Prisma.IncidentGetPayload<{
  include: { category: true; subtype: true };
}>;

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Privacy / access control
  // ---------------------------------------------------------------------------

  /** Highest privacy tier this user may view (0 normal, 1 restricted, 2 highly conf). */
  private maxViewablePrivacyRank(user: RequestUser): number {
    if (user.roles?.includes(SUPER_ADMIN_ROLE)) return 2;
    const perms = user.permissions ?? [];
    if (perms.includes('incidents.view_highly_confidential')) return 2;
    if (perms.includes('incidents.view_confidential')) return 1;
    return 0;
  }

  private allowedPrivacyLevels(user: RequestUser): IncidentPrivacyLevel[] {
    const rank = this.maxViewablePrivacyRank(user);
    return (
      Object.keys(INCIDENT_PRIVACY_RANK) as IncidentPrivacyLevel[]
    ).filter((level) => INCIDENT_PRIVACY_RANK[level] <= rank);
  }

  /** Where fragment that hides incidents above the caller's privacy clearance. */
  private privacyWhere(user: RequestUser): Prisma.IncidentWhereInput {
    return { privacyLevel: { in: this.allowedPrivacyLevels(user) } };
  }

  private canViewIncident(
    user: RequestUser,
    incident: { privacyLevel: IncidentPrivacyLevel },
  ): boolean {
    return (
      INCIDENT_PRIVACY_RANK[incident.privacyLevel] <=
      this.maxViewablePrivacyRank(user)
    );
  }

  // ---------------------------------------------------------------------------
  // Categories (configurable, DB-driven)
  // ---------------------------------------------------------------------------

  async listCategories() {
    const categories = await this.prisma.incidentCategory.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        subtypes: {
          where: { deletedAt: null, isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, key: true, label: true, sortOrder: true },
        },
      },
    });
    return {
      data: categories.map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        description: c.description,
        sortOrder: c.sortOrder,
        subtypes: c.subtypes,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Reference number generation (race-safe, per-year sequence)
  // ---------------------------------------------------------------------------

  private async allocateReference(
    tx: Prisma.TransactionClient,
    year: number,
  ): Promise<string> {
    // Atomic upsert-and-increment: Postgres serialises concurrent writers on the
    // conflicting row, so each caller receives a unique, monotonic sequence value.
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
      INSERT INTO "incidents"."IncidentNumberSequence" ("year", "lastValue", "updatedAt")
      VALUES (${year}, 1, now())
      ON CONFLICT ("year")
      DO UPDATE SET "lastValue" = "IncidentNumberSequence"."lastValue" + 1, "updatedAt" = now()
      RETURNING "lastValue"
    `);
    const value = rows[0]?.lastValue ?? 1;
    return formatIncidentReference(year, value);
  }

  // ---------------------------------------------------------------------------
  // Create (frontline reporting)
  // ---------------------------------------------------------------------------

  async create(
    user: RequestUser,
    dto: CreateIncidentDto,
    meta?: RequestAuditMeta,
  ) {
    const occurredAt = new Date(dto.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt is not a valid date');
    }
    if (occurredAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException(
        'Incident date/time cannot be in the future',
      );
    }

    await this.validateReferences(dto);

    const severity = dto.severity ?? IncidentSeverity.LOW;
    const privacyLevel = dto.privacyLevel ?? IncidentPrivacyLevel.NORMAL;
    const year = new Date().getUTCFullYear();

    let created: IncidentWithRefs | null = null;
    for (let attempt = 0; attempt < REFERENCE_MAX_RETRIES; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const referenceNumber = await this.allocateReference(tx, year);
          const incident = await tx.incident.create({
            data: {
              referenceNumber,
              categoryId: dto.categoryId,
              subtypeId: dto.subtypeId ?? null,
              status: IncidentStatus.REPORTED,
              severity,
              privacyLevel,
              shareWithHandover: dto.shareWithHandover ?? false,
              occurredAt,
              locationId: dto.locationId ?? null,
              specificArea: dto.specificArea?.trim() || null,
              reportedById: user.id,
              reporterEmployeeId:
                dto.reporterEmployeeId ?? user.employeeId ?? null,
              primaryServiceUserId: dto.primaryServiceUserId ?? null,
              primaryEmployeeId: dto.primaryEmployeeId ?? null,
              description: dto.description.trim(),
              contextBefore: dto.contextBefore?.trim() || null,
              contextAfter: dto.contextAfter?.trim() || null,
              immediateActions: dto.immediateActions?.trim() || null,
              immediateActionCodes: dto.immediateActionCodes ?? [],
              injuryOccurred: dto.injuryOccurred ?? false,
              createdById: user.id,
            },
            include: { category: true, subtype: true },
          });

          await tx.incidentStatusHistory.create({
            data: {
              incidentId: incident.id,
              toStatus: IncidentStatus.REPORTED,
              changedById: user.id,
            },
          });
          await tx.incidentSeverityHistory.create({
            data: {
              incidentId: incident.id,
              toSeverity: severity,
              changedById: user.id,
            },
          });

          await this.audit.logAudit({
            tx,
            userId: user.id,
            module: AuditModule.INCIDENT,
            action: AuditAction.INCIDENT_CREATED,
            recordType: 'Incident',
            recordId: incident.id,
            description: `Incident ${incident.referenceNumber} reported`,
            newValues: auditSnapshot(incident),
            ipAddress: meta?.ipAddress,
            userAgent: meta?.userAgent,
          });

          return incident;
        });
        break;
      } catch (err) {
        if (
          this.isUniqueViolation(err) &&
          attempt < REFERENCE_MAX_RETRIES - 1
        ) {
          continue; // reference collided under concurrency — retry with a fresh number
        }
        throw err;
      }
    }

    if (!created) {
      throw new BadRequestException(
        'Could not allocate an incident reference — please retry',
      );
    }

    // Notifications must never block the frontline report from succeeding.
    void this.notifyManagersOfNewIncident(created, user.id).catch((e) =>
      this.logger.warn(
        `Incident notification failed for ${created?.referenceNumber}: ${e}`,
      ),
    );

    return { message: 'Incident reported', data: this.mapIncident(created) };
  }

  private async validateReferences(dto: CreateIncidentDto): Promise<void> {
    const category = await this.prisma.incidentCategory.findFirst({
      where: { id: dto.categoryId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category)
      throw new BadRequestException('Invalid or inactive incident category');

    if (dto.subtypeId) {
      const subtype = await this.prisma.incidentSubtype.findFirst({
        where: {
          id: dto.subtypeId,
          categoryId: dto.categoryId,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (!subtype)
        throw new BadRequestException(
          'Subtype does not belong to the selected category',
        );
    }

    if (dto.primaryServiceUserId) {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: dto.primaryServiceUserId, deletedAt: null },
        select: { id: true },
      });
      if (!su)
        throw new BadRequestException('Linked service user does not exist');
    }

    for (const employeeId of [
      dto.primaryEmployeeId,
      dto.reporterEmployeeId,
    ].filter(Boolean) as string[]) {
      const emp = await this.prisma.employee.findFirst({
        where: { id: employeeId, deletedAt: null },
        select: { id: true },
      });
      if (!emp) throw new BadRequestException('Linked employee does not exist');
    }

    if (dto.locationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: dto.locationId, deletedAt: null },
        select: { id: true },
      });
      if (!loc) throw new BadRequestException('Linked location does not exist');
    }
  }

  // ---------------------------------------------------------------------------
  // List / read
  // ---------------------------------------------------------------------------

  async list(user: RequestUser, query: ListIncidentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const where: Prisma.IncidentWhereInput = {
      deletedAt: null,
      ...this.privacyWhere(user),
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.privacyLevel ? { privacyLevel: query.privacyLevel } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.subtypeId ? { subtypeId: query.subtypeId } : {}),
      ...(query.serviceUserId
        ? { primaryServiceUserId: query.serviceUserId }
        : {}),
      ...(query.employeeId ? { primaryEmployeeId: query.employeeId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.openOnly ? { status: { in: OPEN_INCIDENT_STATUSES } } : {}),
    };

    if (query.dateFrom || query.dateTo) {
      where.occurredAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo
          ? { lte: new Date(`${query.dateTo.slice(0, 10)}T23:59:59.999Z`) }
          : {}),
      };
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { specificArea: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.incident.count({ where }),
      this.prisma.incident.findMany({
        where,
        include: { category: true, subtype: true },
        orderBy: [{ occurredAt: 'desc' }, { reportedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: {
        items: rows.map((r) => this.mapIncident(r)),
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getById(user: RequestUser, id: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        subtype: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        severityHistory: { orderBy: { createdAt: 'asc' } },
        review: true,
        investigation: true,
        outcome: true,
        actions: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        injuries: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        witnesses: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        relatedCareRecords: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            attachments: { where: { deletedAt: null } },
            relatedFrom: true,
          },
        },
      },
    });
    // 404 (not 403) for incidents above clearance so their existence is not revealed.
    if (!incident || !this.canViewIncident(user, incident)) {
      throw new NotFoundException('Incident not found');
    }
    return {
      data: {
        ...this.mapIncident(incident),
        history: this.buildTimeline(incident),
        review: incident.review ?? null,
        investigation: incident.investigation ?? null,
        outcome: incident.outcome ?? null,
        actions: incident.actions.map((a) => this.mapAction(a)),
        injuries: incident.injuries,
        witnesses: incident.witnesses,
        relatedCareRecords: incident.relatedCareRecords,
        attachmentCount: incident._count.attachments,
        relatedIncidentCount: incident._count.relatedFrom,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Workflow transitions
  // ---------------------------------------------------------------------------

  async changeStatus(
    user: RequestUser,
    id: string,
    dto: ChangeIncidentStatusDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForManage(user, id);
    if (!canTransitionIncidentStatus(incident.status, dto.status)) {
      throw new BadRequestException(
        `Cannot move incident from ${INCIDENT_STATUS_LABELS[incident.status]} to ${INCIDENT_STATUS_LABELS[dto.status]}`,
      );
    }
    if (dto.status === IncidentStatus.REOPENED) {
      if (!this.can(user, 'incidents.reopen')) {
        throw new ForbiddenException(
          'You do not have permission to reopen incidents',
        );
      }
      if (!dto.reason?.trim()) {
        throw new BadRequestException(
          'A reason is required to reopen an incident',
        );
      }
    }

    // Closing requires the dedicated permission, mandatory-action rules AND a
    // recorded closure outcome.
    if (dto.status === IncidentStatus.CLOSED) {
      if (!this.can(user, 'incidents.close')) {
        throw new ForbiddenException(
          'You do not have permission to close incidents',
        );
      }
      await this.assertClosable(id, incident.severity, dto, user);
      const outcome = await this.prisma.incidentOutcome.findUnique({
        where: { incidentId: id },
        select: { finalOutcome: true },
      });
      if (!outcome?.finalOutcome?.trim()) {
        throw new BadRequestException(
          'Record the closure outcome (final outcome) before closing this incident',
        );
      }
    }

    const isClosing = dto.status === IncidentStatus.CLOSED;
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: {
          status: dto.status,
          updatedById: user.id,
          ...(isClosing ? { closedAt: new Date(), closedById: user.id } : {}),
        },
        include: { category: true, subtype: true },
      });
      await tx.incidentStatusHistory.create({
        data: {
          incidentId: id,
          fromStatus: incident.status,
          toStatus: dto.status,
          changedById: user.id,
          reason: dto.reason?.trim() || null,
        },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action:
          dto.status === IncidentStatus.REOPENED
            ? AuditAction.INCIDENT_REOPENED
            : dto.status === IncidentStatus.CLOSED
              ? AuditAction.INCIDENT_CLOSED
              : AuditAction.INCIDENT_STATUS_CHANGED,
        recordType: 'Incident',
        recordId: id,
        description: `Status ${incident.status} → ${dto.status}`,
        oldValues: { status: incident.status },
        newValues: { status: dto.status, reason: dto.reason ?? null },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return next;
    });

    return {
      message: 'Incident status updated',
      data: this.mapIncident(updated),
    };
  }

  async changeSeverity(
    user: RequestUser,
    id: string,
    dto: ChangeIncidentSeverityDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForManage(user, id);
    if (incident.severity === dto.severity) {
      return { message: 'No change', data: this.mapIncident(incident) };
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: { severity: dto.severity, updatedById: user.id },
        include: { category: true, subtype: true },
      });
      await tx.incidentSeverityHistory.create({
        data: {
          incidentId: id,
          fromSeverity: incident.severity,
          toSeverity: dto.severity,
          changedById: user.id,
          reason: dto.reason?.trim() || null,
        },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_SEVERITY_CHANGED,
        recordType: 'Incident',
        recordId: id,
        description: `Severity ${incident.severity} → ${dto.severity}`,
        oldValues: { severity: incident.severity },
        newValues: { severity: dto.severity, reason: dto.reason ?? null },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return next;
    });
    return {
      message: 'Incident severity updated',
      data: this.mapIncident(updated),
    };
  }

  async assignOwner(
    user: RequestUser,
    id: string,
    dto: AssignIncidentOwnerDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForManage(user, id);
    const owner = await this.prisma.user.findFirst({
      where: { id: dto.ownerId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!owner)
      throw new BadRequestException('Owner is not a valid active user');

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: { ownerId: dto.ownerId, updatedById: user.id },
        include: { category: true, subtype: true },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_OWNER_CHANGED,
        recordType: 'Incident',
        recordId: id,
        oldValues: { ownerId: incident.ownerId },
        newValues: { ownerId: dto.ownerId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return next;
    });
    return {
      message: 'Incident owner assigned',
      data: this.mapIncident(updated),
    };
  }

  // ---------------------------------------------------------------------------
  // Manager review & investigation (upserted, one per incident)
  // ---------------------------------------------------------------------------

  async upsertReview(
    user: RequestUser,
    id: string,
    dto: UpsertIncidentReviewDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForManage(user, id);
    const existing = await this.prisma.incidentReview.findUnique({
      where: { incidentId: id },
    });
    const data = {
      confirmedSeverity: dto.confirmedSeverity ?? null,
      investigationRequired: dto.investigationRequired ?? null,
      safeguardingConcern: dto.safeguardingConcern ?? null,
      possibleAbuseOrNeglect: dto.possibleAbuseOrNeglect ?? null,
      furtherMedicalAttention: dto.furtherMedicalAttention ?? null,
      externalNotificationRequired: dto.externalNotificationRequired ?? null,
      escalationRequired: dto.escalationRequired ?? null,
      managementNotes: dto.managementNotes?.trim() || null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    };
    const review = await this.prisma.incidentReview.upsert({
      where: { incidentId: id },
      create: {
        incidentId: id,
        ...data,
        createdById: user.id,
        updatedById: user.id,
      },
      update: { ...data, updatedById: user.id },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentReview',
      recordId: id,
      description: 'Manager review saved',
      oldValues: existing ? auditSnapshot(existing) : undefined,
      newValues: auditSnapshot(review),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    // Escalation / safeguarding routing (internal notifications; never blocking).
    void this.notifyOnReviewFlags(id, review, user.id).catch((e) =>
      this.logger.warn(`Incident review notification failed for ${id}: ${e}`),
    );
    return { message: 'Manager review saved', data: review };
  }

  async upsertInvestigation(
    user: RequestUser,
    id: string,
    dto: UpsertIncidentInvestigationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForManage(user, id);
    const existing = await this.prisma.incidentInvestigation.findUnique({
      where: { incidentId: id },
    });
    const data = {
      whatHappened: dto.whatHappened?.trim() || null,
      whyHappened: dto.whyHappened?.trim() || null,
      contributingFactors: dto.contributingFactors ?? [],
      rootCause: dto.rootCause?.trim() || null,
      preventable: dto.preventable ?? null,
      conclusion: dto.conclusion?.trim() || null,
      completedAt: dto.markComplete
        ? (existing?.completedAt ?? new Date())
        : (existing?.completedAt ?? null),
    };
    const investigation = await this.prisma.incidentInvestigation.upsert({
      where: { incidentId: id },
      create: {
        incidentId: id,
        ...data,
        createdById: user.id,
        updatedById: user.id,
      },
      update: { ...data, updatedById: user.id },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentInvestigation',
      recordId: id,
      description: 'Investigation updated',
      oldValues: existing ? auditSnapshot(existing) : undefined,
      newValues: auditSnapshot(investigation),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Investigation saved', data: investigation };
  }

  // ---------------------------------------------------------------------------
  // Outcome & lessons learned (closure record)
  // ---------------------------------------------------------------------------

  async upsertOutcome(
    user: RequestUser,
    id: string,
    dto: UpsertIncidentOutcomeDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForManage(user, id);
    const existing = await this.prisma.incidentOutcome.findUnique({
      where: { incidentId: id },
    });
    const data = {
      finalOutcome: dto.finalOutcome?.trim() || null,
      lessonsLearned: dto.lessonsLearned?.trim() || null,
      preventability: dto.preventability ?? null,
      changesMade: dto.changesMade ?? [],
      informationSharedWithStaff: dto.informationSharedWithStaff ?? null,
      serviceUserInformed: dto.serviceUserInformed ?? null,
      nokInformed: dto.nokInformed ?? null,
      finalManagementComments: dto.finalManagementComments?.trim() || null,
    };
    const outcome = await this.prisma.incidentOutcome.upsert({
      where: { incidentId: id },
      create: {
        incidentId: id,
        ...data,
        createdById: user.id,
        updatedById: user.id,
      },
      update: { ...data, updatedById: user.id },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentOutcome',
      recordId: id,
      description: 'Closure outcome saved',
      oldValues: existing ? auditSnapshot(existing) : undefined,
      newValues: auditSnapshot(outcome),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Outcome saved', data: outcome };
  }

  // ---------------------------------------------------------------------------
  // Dashboard statistics (privacy-filtered)
  // ---------------------------------------------------------------------------

  async getStats(user: RequestUser) {
    const base: Prisma.IncidentWhereInput = {
      deletedAt: null,
      isArchived: false,
      ...this.privacyWhere(user),
    };
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const [byStatus, bySeverity, open, closedThisMonth, total, overdueActions] =
      await Promise.all([
        this.prisma.incident.groupBy({
          by: ['status'],
          where: base,
          _count: true,
        }),
        this.prisma.incident.groupBy({
          by: ['severity'],
          where: base,
          _count: true,
        }),
        this.prisma.incident.count({
          where: { ...base, status: { in: OPEN_INCIDENT_STATUSES } },
        }),
        this.prisma.incident.count({
          where: {
            ...base,
            status: IncidentStatus.CLOSED,
            updatedAt: { gte: startOfMonth },
          },
        }),
        this.prisma.incident.count({ where: base }),
        this.prisma.incidentAction.count({
          where: {
            deletedAt: null,
            dueDate: { lt: new Date() },
            status: {
              notIn: [
                IncidentActionStatus.COMPLETED,
                IncidentActionStatus.CANCELLED,
              ],
            },
            incident: { is: base },
          },
        }),
      ]);

    const statusCounts = Object.fromEntries(
      byStatus.map((r) => [r.status, r._count]),
    ) as Record<IncidentStatus, number>;
    const severityCounts = Object.fromEntries(
      bySeverity.map((r) => [r.severity, r._count]),
    ) as Record<IncidentSeverity, number>;

    return {
      data: {
        total,
        open,
        closedThisMonth,
        overdueActions,
        awaitingReview: statusCounts[IncidentStatus.AWAITING_REVIEW] ?? 0,
        underInvestigation:
          statusCounts[IncidentStatus.UNDER_INVESTIGATION] ?? 0,
        actionsRequired: statusCounts[IncidentStatus.ACTIONS_REQUIRED] ?? 0,
        highOrCritical:
          (severityCounts[IncidentSeverity.HIGH] ?? 0) +
          (severityCounts[IncidentSeverity.CRITICAL] ?? 0),
        byStatus: statusCounts,
        bySeverity: severityCounts,
      },
    };
  }

  private async notifyOnReviewFlags(
    incidentId: string,
    review: {
      safeguardingConcern: boolean | null;
      escalationRequired: boolean | null;
    },
    actorId: string,
  ): Promise<void> {
    if (!review.safeguardingConcern && !review.escalationRequired) return;
    const recipients = (await this.managerUserIds()).filter(
      (uid) => uid !== actorId,
    );
    if (!recipients.length) return;
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: { referenceNumber: true },
    });
    const flag = review.safeguardingConcern
      ? 'Safeguarding concern'
      : 'Escalation required';
    await this.notifications.notifyUsers({
      recipientUserIds: recipients,
      type: NotificationType.INCIDENT_REPORTED,
      title: `${flag} — ${incident?.referenceNumber ?? 'incident'}`,
      message: `An incident review flagged: ${flag}. Please review.`,
      module: NotificationModule.SERVICE_CARE,
      severity: NotificationSeverity.ERROR,
      recordType: 'Incident',
      recordId: incidentId,
      createdById: actorId,
    });
  }

  // ---------------------------------------------------------------------------
  // Corrective actions
  // ---------------------------------------------------------------------------

  async listActions(user: RequestUser, incidentId: string) {
    await this.loadForManage(user, incidentId);
    const actions = await this.prisma.incidentAction.findMany({
      where: { incidentId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    return { data: actions.map((a) => this.mapAction(a)) };
  }

  async createAction(
    user: RequestUser,
    incidentId: string,
    dto: CreateIncidentActionDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForManage(user, incidentId);
    if (dto.assignedEmployeeId) {
      await this.assertEmployeeExists(dto.assignedEmployeeId);
    }
    const action = await this.prisma.incidentAction.create({
      data: {
        incidentId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        priority: dto.priority ?? IncidentActionPriority.MEDIUM,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assignedEmployeeId: dto.assignedEmployeeId ?? null,
        isMandatory: dto.isMandatory ?? false,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentAction',
      recordId: action.id,
      description: `Action created: ${action.title}`,
      newValues: auditSnapshot(action),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Action created', data: this.mapAction(action) };
  }

  async updateAction(
    user: RequestUser,
    actionId: string,
    dto: UpdateIncidentActionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadActionForManage(user, actionId);
    if (dto.assignedEmployeeId) {
      await this.assertEmployeeExists(dto.assignedEmployeeId);
    }
    const action = await this.prisma.incidentAction.update({
      where: { id: actionId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
          : {}),
        ...(dto.assignedEmployeeId !== undefined
          ? { assignedEmployeeId: dto.assignedEmployeeId || null }
          : {}),
        ...(dto.isMandatory !== undefined
          ? { isMandatory: dto.isMandatory }
          : {}),
        updatedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentAction',
      recordId: actionId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(action),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Action updated', data: this.mapAction(action) };
  }

  async completeAction(
    user: RequestUser,
    actionId: string,
    dto: CompleteIncidentActionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadActionForComplete(user, actionId);
    const action = await this.prisma.incidentAction.update({
      where: { id: actionId },
      data: {
        status: IncidentActionStatus.COMPLETED,
        completionNotes: dto.completionNotes?.trim() || null,
        completedById: user.id,
        completedAt: new Date(),
        updatedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentAction',
      recordId: actionId,
      description: `Action completed: ${existing.title}`,
      oldValues: { status: existing.status },
      newValues: {
        status: action.status,
        completionNotes: action.completionNotes,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Action completed', data: this.mapAction(action) };
  }

  /** Actions assigned to the current user's employee record ("My Actions"). */
  async listMyActions(user: RequestUser, openOnly = true) {
    if (!user.employeeId) return { data: [] };
    const actions = await this.prisma.incidentAction.findMany({
      where: {
        assignedEmployeeId: user.employeeId,
        deletedAt: null,
        ...(openOnly
          ? {
              status: {
                notIn: [
                  IncidentActionStatus.COMPLETED,
                  IncidentActionStatus.CANCELLED,
                ],
              },
            }
          : {}),
      },
      include: {
        incident: { select: { referenceNumber: true, privacyLevel: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    // Respect confidentiality: hide actions whose incident is above the user's clearance.
    const allowed = this.allowedPrivacyLevels(user);
    return {
      data: actions
        .filter((a) => allowed.includes(a.incident.privacyLevel))
        .map((a) => ({
          ...this.mapAction(a),
          incidentReference: a.incident.referenceNumber,
        })),
    };
  }

  private async assertClosable(
    incidentId: string,
    severity: IncidentSeverity,
    dto: ChangeIncidentStatusDto,
    user: RequestUser,
  ): Promise<void> {
    if (
      severity !== IncidentSeverity.HIGH &&
      severity !== IncidentSeverity.CRITICAL
    ) {
      return;
    }
    const outstanding = await this.prisma.incidentAction.count({
      where: {
        incidentId,
        deletedAt: null,
        isMandatory: true,
        status: {
          notIn: [
            IncidentActionStatus.COMPLETED,
            IncidentActionStatus.CANCELLED,
          ],
        },
      },
    });
    if (outstanding === 0) return;
    if (!dto.overrideMandatoryActions) {
      throw new BadRequestException(
        `This ${severity} incident has ${outstanding} incomplete mandatory action(s). Complete them or override with a reason to close.`,
      );
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException(
        'A reason is required to override incomplete mandatory actions',
      );
    }
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'Incident',
      recordId: incidentId,
      description: `Closure override — ${outstanding} mandatory action(s) incomplete`,
      newValues: { overrideReason: dto.reason },
    });
  }

  private async loadActionForManage(user: RequestUser, actionId: string) {
    const action = await this.prisma.incidentAction.findFirst({
      where: { id: actionId, deletedAt: null },
      include: { incident: { select: { privacyLevel: true } } },
    });
    if (!action || !this.canViewIncident(user, action.incident)) {
      throw new NotFoundException('Action not found');
    }
    return action;
  }

  /** Completion is allowed for managers OR the assigned employee themselves. */
  private async loadActionForComplete(user: RequestUser, actionId: string) {
    const action = await this.prisma.incidentAction.findFirst({
      where: { id: actionId, deletedAt: null },
      include: { incident: { select: { privacyLevel: true } } },
    });
    if (!action || !this.canViewIncident(user, action.incident)) {
      throw new NotFoundException('Action not found');
    }
    const isAssignee =
      user.employeeId != null && action.assignedEmployeeId === user.employeeId;
    if (!this.can(user, 'incidents.manage_actions') && !isAssignee) {
      throw new ForbiddenException('You cannot complete this action');
    }
    return action;
  }

  private async assertEmployeeExists(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!emp) throw new BadRequestException('Assigned employee does not exist');
  }

  private mapAction(action: import('@prisma/client').IncidentAction) {
    return {
      id: action.id,
      incidentId: action.incidentId,
      title: action.title,
      description: action.description,
      priority: action.priority,
      status: action.status,
      displayStatus: effectiveActionStatus(action),
      isOverdue: isActionOverdue(action),
      isMandatory: action.isMandatory,
      dueDate: action.dueDate ? action.dueDate.toISOString() : null,
      assignedEmployeeId: action.assignedEmployeeId,
      completionNotes: action.completionNotes,
      completedById: action.completedById,
      completedAt: action.completedAt ? action.completedAt.toISOString() : null,
      createdAt: action.createdAt.toISOString(),
      updatedAt: action.updatedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private can(user: RequestUser, permission: string): boolean {
    if (user.roles?.includes(SUPER_ADMIN_ROLE)) return true;
    return (user.permissions ?? []).includes(permission);
  }

  /** Load an incident for a management action, enforcing privacy access. */
  private async loadForManage(
    user: RequestUser,
    id: string,
  ): Promise<IncidentWithRefs> {
    const incident = await this.prisma.incident.findFirst({
      where: { id, deletedAt: null },
      include: { category: true, subtype: true },
    });
    if (!incident || !this.canViewIncident(user, incident)) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  private async managerUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        name: { in: ['Admin', 'Manager', 'Care Coordinator'] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!roles.length) return [];
    const links = await this.prisma.userRole.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { userId: true },
    });
    return [...new Set(links.map((l) => l.userId))];
  }

  private async notifyManagersOfNewIncident(
    incident: IncidentWithRefs,
    reporterId: string,
  ): Promise<void> {
    const recipients = (await this.managerUserIds()).filter(
      (uid) => uid !== reporterId,
    );
    if (!recipients.length) return;
    const severityToNotify: Record<IncidentSeverity, NotificationSeverity> = {
      LOW: NotificationSeverity.INFO,
      MEDIUM: NotificationSeverity.WARNING,
      HIGH: NotificationSeverity.ERROR,
      CRITICAL: NotificationSeverity.CRITICAL,
    };
    await this.notifications.notifyUsers({
      recipientUserIds: recipients,
      type: NotificationType.INCIDENT_REPORTED,
      title: `${incident.category.label} reported — ${incident.referenceNumber}`,
      message:
        incident.description.slice(0, 240) ||
        'A new incident has been reported.',
      module: NotificationModule.SERVICE_CARE,
      severity: severityToNotify[incident.severity],
      recordType: 'Incident',
      recordId: incident.id,
      metadata: {
        referenceNumber: incident.referenceNumber,
        severity: incident.severity,
        categoryKey: incident.category.key,
      },
      createdById: reporterId,
    });
  }

  private mapIncident(incident: IncidentWithRefs) {
    return {
      id: incident.id,
      referenceNumber: incident.referenceNumber,
      status: incident.status,
      statusLabel: INCIDENT_STATUS_LABELS[incident.status],
      severity: incident.severity,
      severityLabel: INCIDENT_SEVERITY_LABELS[incident.severity],
      privacyLevel: incident.privacyLevel,
      shareWithHandover: incident.shareWithHandover,
      category: {
        id: incident.category.id,
        key: incident.category.key,
        label: incident.category.label,
      },
      subtype: incident.subtype
        ? {
            id: incident.subtype.id,
            key: incident.subtype.key,
            label: incident.subtype.label,
          }
        : null,
      occurredAt: incident.occurredAt.toISOString(),
      reportedAt: incident.reportedAt.toISOString(),
      locationId: incident.locationId,
      specificArea: incident.specificArea,
      primaryServiceUserId: incident.primaryServiceUserId,
      primaryEmployeeId: incident.primaryEmployeeId,
      reportedById: incident.reportedById,
      ownerId: incident.ownerId,
      description: incident.description,
      contextBefore: incident.contextBefore,
      contextAfter: incident.contextAfter,
      immediateActions: incident.immediateActions,
      immediateActionCodes: incident.immediateActionCodes,
      injuryOccurred: incident.injuryOccurred,
      isArchived: incident.isArchived,
      closedAt: incident.closedAt ? incident.closedAt.toISOString() : null,
      closedById: incident.closedById,
      createdAt: incident.createdAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
    };
  }

  private buildTimeline(
    incident: Prisma.IncidentGetPayload<{
      include: { statusHistory: true; severityHistory: true };
    }>,
  ) {
    const events: Array<{
      at: string;
      kind: string;
      detail: string;
      byId: string | null;
    }> = [];
    events.push({
      at: incident.reportedAt.toISOString(),
      kind: 'REPORTED',
      detail: `Incident ${incident.referenceNumber} reported`,
      byId: incident.reportedById,
    });
    for (const s of incident.statusHistory) {
      if (!s.fromStatus) continue; // initial REPORTED already represented above
      events.push({
        at: s.createdAt.toISOString(),
        kind: 'STATUS',
        detail: `${INCIDENT_STATUS_LABELS[s.fromStatus]} → ${INCIDENT_STATUS_LABELS[s.toStatus]}${s.reason ? ` (${s.reason})` : ''}`,
        byId: s.changedById,
      });
    }
    for (const s of incident.severityHistory) {
      if (!s.fromSeverity) continue;
      events.push({
        at: s.createdAt.toISOString(),
        kind: 'SEVERITY',
        detail: `Severity ${INCIDENT_SEVERITY_LABELS[s.fromSeverity]} → ${INCIDENT_SEVERITY_LABELS[s.toSeverity]}${s.reason ? ` (${s.reason})` : ''}`,
        byId: s.changedById,
      });
    }
    return events.sort((a, b) => a.at.localeCompare(b.at));
  }
}
