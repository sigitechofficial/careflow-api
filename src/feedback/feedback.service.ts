import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeedbackRecord, FeedbackType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
  COMPLAINT_RESPONSE_WORKING_DAYS,
  addWorkingDays,
  complaintOverdue,
  formatFeedbackReference,
  nextFeedbackStatus,
  type FeedbackAction,
} from './feedback-workflow.util';
import {
  CreateFeedbackDto,
  FeedbackListQueryDto,
  FeedbackTransitionDto,
  UpdateFeedbackDto,
} from './dto/feedback.dto';

const EVENT_FOR_ACTION: Record<FeedbackAction, string> = {
  ACKNOWLEDGE: 'ACKNOWLEDGED',
  START_INVESTIGATION: 'INVESTIGATION_STARTED',
  RESPOND: 'RESPONDED',
  CLOSE: 'CLOSED',
  REOPEN: 'REOPENED',
  SHARE: 'SHARED',
};

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

type Names = {
  serviceUsers: Map<string, string>;
  employees: Map<string, string>;
  users: Map<string, string>;
  locations: Map<string, string>;
};

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(actor: RequestUser, query: FeedbackListQueryDto) {
    const where = this.scopeWhere(actor);
    if (!where) return { data: [] };
    if (query.type) where.type = query.type;
    if (query.status === 'OPEN') where.status = { not: 'CLOSED' };
    else if (query.status) where.status = query.status;
    if (query.serviceUserId) {
      where.OR = [
        { aboutServiceUserId: query.serviceUserId },
        { fromServiceUserId: query.serviceUserId },
      ];
    }
    if (query.employeeId) where.aboutEmployeeIds = { has: query.employeeId };
    if (query.from || query.to) {
      where.receivedAt = {
        ...(query.from
          ? { gte: new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`) }
          : {}),
        ...(query.to
          ? { lte: new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) }
          : {}),
      };
    }
    const search = query.search?.trim();
    if (search) {
      const contains = { contains: search, mode: 'insensitive' as const };
      where.AND = [
        {
          OR: [
            { referenceNumber: contains },
            { subject: contains },
            { details: contains },
            { fromName: contains },
          ],
        },
      ];
    }

    const rows = await this.prisma.feedbackRecord.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: 1000,
    });
    const now = new Date();
    const filtered = query.overdue
      ? rows.filter((r) => {
          const o = complaintOverdue(r, now);
          return o.acknowledge || o.response;
        })
      : rows;
    const names = await this.resolveNames(filtered);
    return { data: filtered.map((r) => this.toRow(r, names, now)) };
  }

  /** Counts for the summary cards. */
  async summary(actor: RequestUser) {
    const where = this.scopeWhere(actor);
    const empty = {
      openComplaints: 0,
      overdueComplaints: 0,
      complaintsThisMonth: 0,
      complimentsThisMonth: 0,
      complimentsToShare: 0,
    };
    if (!where) return { data: empty };
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const [open, complaintsThisMonth, complimentsThisMonth, toShare] =
      await Promise.all([
        this.prisma.feedbackRecord.findMany({
          where: { ...where, type: 'COMPLAINT', status: { not: 'CLOSED' } },
          select: {
            type: true,
            status: true,
            acknowledgeDueAt: true,
            acknowledgedAt: true,
            responseDueAt: true,
            respondedAt: true,
          },
        }),
        this.prisma.feedbackRecord.count({
          where: {
            ...where,
            type: 'COMPLAINT',
            receivedAt: { gte: monthStart },
          },
        }),
        this.prisma.feedbackRecord.count({
          where: {
            ...where,
            type: 'COMPLIMENT',
            receivedAt: { gte: monthStart },
          },
        }),
        this.prisma.feedbackRecord.count({
          where: { ...where, type: 'COMPLIMENT', status: 'RECEIVED' },
        }),
      ]);
    const overdue = open.filter((r) => {
      const o = complaintOverdue(r, now);
      return o.acknowledge || o.response;
    }).length;
    return {
      data: {
        openComplaints: open.length,
        overdueComplaints: overdue,
        complaintsThisMonth,
        complimentsThisMonth,
        complimentsToShare: toShare,
      },
    };
  }

  async findOne(actor: RequestUser, id: string) {
    const row = await this.getInScope(actor, id);
    const events = await this.prisma.feedbackEvent.findMany({
      where: { feedbackId: id },
      orderBy: { createdAt: 'asc' },
    });
    const names = await this.resolveNames(
      [row],
      events.map((e) => e.userId),
    );
    return {
      data: {
        ...this.toRow(row, names, new Date()),
        events: events.map((e) => ({
          id: e.id,
          action: e.action,
          note: e.note,
          userName: e.userId ? (names.users.get(e.userId) ?? null) : null,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    };
  }

  // ---------------------------------------------------------------- writes

  async create(
    actor: RequestUser,
    dto: CreateFeedbackDto,
    meta?: RequestAuditMeta,
  ) {
    const people = await this.validatePeople(actor, dto);
    const receivedAt = new Date(dto.receivedAt);
    const isComplaint = dto.type === 'COMPLAINT';
    const created = await this.prisma.$transaction(async (tx) => {
      const referenceNumber = await this.allocateReference(
        tx,
        dto.type,
        receivedAt.getUTCFullYear(),
      );
      const row = await tx.feedbackRecord.create({
        data: {
          referenceNumber,
          type: dto.type,
          receivedAt,
          channel: dto.channel,
          fromKind: dto.fromKind,
          fromName:
            dto.fromKind === 'ANONYMOUS' ? null : trimOrNull(dto.fromName),
          fromContact:
            dto.fromKind === 'ANONYMOUS' ? null : trimOrNull(dto.fromContact),
          fromServiceUserId: people.fromServiceUserId,
          fromEmployeeId: people.fromEmployeeId,
          aboutServiceUserId: people.aboutServiceUserId,
          aboutEmployeeIds: people.aboutEmployeeIds,
          locationId: people.locationId,
          subject: dto.subject.trim(),
          details: dto.details.trim(),
          category: trimOrNull(dto.category),
          severity: isComplaint ? (dto.severity ?? 'LOW') : null,
          desiredOutcome: isComplaint ? trimOrNull(dto.desiredOutcome) : null,
          handlerEmployeeId: people.handlerEmployeeId,
          acknowledgeDueAt: isComplaint
            ? addWorkingDays(receivedAt, COMPLAINT_ACKNOWLEDGE_WORKING_DAYS)
            : null,
          responseDueAt: isComplaint
            ? addWorkingDays(receivedAt, COMPLAINT_RESPONSE_WORKING_DAYS)
            : null,
          recordedById: actor.id,
        },
      });
      await tx.feedbackEvent.create({
        data: { feedbackId: row.id, action: 'RECORDED', userId: actor.id },
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.FEEDBACK_RECORDED,
        row,
        null,
        meta,
      );
      return row;
    });
    return {
      message: 'Recorded',
      data: { id: created.id, referenceNumber: created.referenceNumber },
    };
  }

  async update(
    actor: RequestUser,
    id: string,
    dto: UpdateFeedbackDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.getInScope(actor, id);
    const people = await this.validatePeople(actor, {
      fromServiceUserId:
        dto.fromServiceUserId === undefined
          ? existing.fromServiceUserId
          : dto.fromServiceUserId,
      fromEmployeeId:
        dto.fromEmployeeId === undefined
          ? existing.fromEmployeeId
          : dto.fromEmployeeId,
      aboutServiceUserId:
        dto.aboutServiceUserId === undefined
          ? existing.aboutServiceUserId
          : dto.aboutServiceUserId,
      aboutEmployeeIds: dto.aboutEmployeeIds ?? existing.aboutEmployeeIds,
      handlerEmployeeId:
        dto.handlerEmployeeId === undefined
          ? existing.handlerEmployeeId
          : dto.handlerEmployeeId,
      locationId:
        dto.locationId === undefined ? existing.locationId : dto.locationId,
      fromKind: dto.fromKind ?? existing.fromKind,
    });
    const isComplaint = existing.type === 'COMPLAINT';
    const fromKind = dto.fromKind ?? existing.fromKind;
    const data: Prisma.FeedbackRecordUpdateInput = {
      fromServiceUserId: people.fromServiceUserId,
      fromEmployeeId: people.fromEmployeeId,
      aboutServiceUserId: people.aboutServiceUserId,
      aboutEmployeeIds: people.aboutEmployeeIds,
      handlerEmployeeId: people.handlerEmployeeId,
      locationId: people.locationId,
    };
    if (dto.receivedAt !== undefined) {
      const receivedAt = new Date(dto.receivedAt);
      data.receivedAt = receivedAt;
      if (
        isComplaint &&
        receivedAt.getTime() !== existing.receivedAt.getTime()
      ) {
        data.acknowledgeDueAt = addWorkingDays(
          receivedAt,
          COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
        );
        data.responseDueAt = addWorkingDays(
          receivedAt,
          COMPLAINT_RESPONSE_WORKING_DAYS,
        );
      }
    }
    if (dto.channel !== undefined) data.channel = dto.channel;
    if (dto.fromKind !== undefined) data.fromKind = dto.fromKind;
    if (fromKind === 'ANONYMOUS') {
      data.fromName = null;
      data.fromContact = null;
    } else {
      if (dto.fromName !== undefined) data.fromName = trimOrNull(dto.fromName);
      if (dto.fromContact !== undefined)
        data.fromContact = trimOrNull(dto.fromContact);
    }
    if (dto.subject !== undefined) {
      if (!dto.subject.trim())
        throw new BadRequestException('Subject is required');
      data.subject = dto.subject.trim();
    }
    if (dto.details !== undefined) {
      if (!dto.details.trim())
        throw new BadRequestException('Details are required');
      data.details = dto.details.trim();
    }
    if (dto.category !== undefined) data.category = trimOrNull(dto.category);
    if (isComplaint) {
      if (dto.severity !== undefined) data.severity = dto.severity ?? 'LOW';
      if (dto.desiredOutcome !== undefined)
        data.desiredOutcome = trimOrNull(dto.desiredOutcome);
      if (dto.investigationNotes !== undefined)
        data.investigationNotes = trimOrNull(dto.investigationNotes);
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.feedbackRecord.update({ where: { id }, data });
      await tx.feedbackEvent.create({
        data: { feedbackId: id, action: 'UPDATED', userId: actor.id },
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.FEEDBACK_UPDATED,
        row,
        existing,
        meta,
      );
    });
    return this.findOne(actor, id);
  }

  async transition(
    actor: RequestUser,
    id: string,
    dto: FeedbackTransitionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.getInScope(actor, id);
    const next = nextFeedbackStatus(existing.type, existing.status, dto.action);
    if (!next) {
      throw new BadRequestException(
        `This ${existing.type.toLowerCase()} cannot be ${EVENT_FOR_ACTION[dto.action].toLowerCase().replace('_', ' ')} from ${existing.status.toLowerCase()}`,
      );
    }
    const at = dto.at ? new Date(dto.at) : new Date();
    if (at.getTime() < existing.receivedAt.getTime()) {
      throw new BadRequestException('Date cannot be before it was received');
    }
    const data: Prisma.FeedbackRecordUpdateInput = { status: next };
    switch (dto.action) {
      case 'ACKNOWLEDGE':
        data.acknowledgedAt = at;
        break;
      case 'RESPOND':
        if (!dto.responseSummary?.trim()) {
          throw new BadRequestException('Summarise the response sent');
        }
        if (!dto.outcome) throw new BadRequestException('Select the outcome');
        data.respondedAt = at;
        data.responseSummary = dto.responseSummary.trim();
        data.outcome = dto.outcome;
        if (!existing.acknowledgedAt) data.acknowledgedAt = at;
        break;
      case 'CLOSE':
        if (
          existing.type === 'COMPLAINT' &&
          !existing.outcome &&
          !dto.outcome
        ) {
          throw new BadRequestException('Select the outcome before closing');
        }
        if (dto.outcome) data.outcome = dto.outcome;
        if (dto.lessonsLearned !== undefined)
          data.lessonsLearned = trimOrNull(dto.lessonsLearned);
        data.closedAt = at;
        break;
      case 'SHARE':
        data.sharedWithStaffAt = at;
        data.closedAt = at;
        break;
      case 'REOPEN':
        if (!dto.note?.trim()) {
          throw new BadRequestException('Give a reason for reopening');
        }
        data.closedAt = null;
        break;
      default:
        break;
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.feedbackRecord.update({ where: { id }, data });
      await tx.feedbackEvent.create({
        data: {
          feedbackId: id,
          action: EVENT_FOR_ACTION[dto.action],
          note: trimOrNull(dto.note),
          userId: actor.id,
        },
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.FEEDBACK_STATUS_CHANGED,
        row,
        existing,
        meta,
      );
    });
    return this.findOne(actor, id);
  }

  async addNote(actor: RequestUser, id: string, note: string) {
    await this.getInScope(actor, id);
    await this.prisma.feedbackEvent.create({
      data: {
        feedbackId: id,
        action: 'NOTE',
        note: note.trim(),
        userId: actor.id,
      },
    });
    return this.findOne(actor, id);
  }

  async remove(
    actor: RequestUser,
    id: string,
    reason: string,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.getInScope(actor, id);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.feedbackRecord.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.id },
      });
      await tx.feedbackEvent.create({
        data: {
          feedbackId: id,
          action: 'DELETED',
          note: reason.trim(),
          userId: actor.id,
        },
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.FEEDBACK_DELETED,
        row,
        existing,
        meta,
      );
    });
    return { message: 'Deleted', data: {} };
  }

  // ---------------------------------------------------------------- helpers

  /** Rows the viewer may see: their branches, plus anything they recorded. Null = nothing. */
  private scopeWhere(
    actor: RequestUser,
  ): Prisma.FeedbackRecordWhereInput | null {
    const scope = this.orgScope.fromRequestUser(actor);
    const locationIds = this.orgScope.resolveListLocationIds(scope);
    const where: Prisma.FeedbackRecordWhereInput = { deletedAt: null };
    if (!locationIds) return where;
    where.AND = [
      {
        OR: [
          ...(locationIds.length ? [{ locationId: { in: locationIds } }] : []),
          { recordedById: actor.id },
        ],
      },
    ];
    return where;
  }

  private async getInScope(actor: RequestUser, id: string) {
    const where = this.scopeWhere(actor);
    const row = where
      ? await this.prisma.feedbackRecord.findFirst({ where: { ...where, id } })
      : null;
    if (!row) throw new NotFoundException('Record not found');
    return row;
  }

  private async validatePeople(
    actor: RequestUser,
    dto: {
      fromServiceUserId?: string | null;
      fromEmployeeId?: string | null;
      aboutServiceUserId?: string | null;
      aboutEmployeeIds?: string[];
      handlerEmployeeId?: string | null;
      locationId?: string | null;
      fromKind?: string;
    },
  ) {
    const scope = this.orgScope.fromRequestUser(actor);
    const fromServiceUserId =
      dto.fromKind === 'SERVICE_USER' ? (dto.fromServiceUserId ?? null) : null;
    const fromEmployeeId =
      dto.fromKind === 'STAFF' ? (dto.fromEmployeeId ?? null) : null;
    const aboutServiceUserId = dto.aboutServiceUserId ?? null;
    const aboutEmployeeIds = [...new Set(dto.aboutEmployeeIds ?? [])];
    const handlerEmployeeId = dto.handlerEmployeeId ?? null;

    const suIds = [fromServiceUserId, aboutServiceUserId].filter(
      (x): x is string => Boolean(x),
    );
    for (const suId of new Set(suIds)) {
      await this.orgScope.assertServiceUserInScope(scope, suId);
    }
    const empIds = [
      fromEmployeeId,
      handlerEmployeeId,
      ...aboutEmployeeIds,
    ].filter((x): x is string => Boolean(x));
    if (empIds.length) {
      const found = await this.prisma.employee.count({
        where: { id: { in: [...new Set(empIds)] }, deletedAt: null },
      });
      if (found !== new Set(empIds).size) {
        throw new BadRequestException('Employee not found');
      }
    }

    // Branch: from the service user it is about (or from), else the one picked.
    let locationId = dto.locationId ?? null;
    const suForBranch = aboutServiceUserId ?? fromServiceUserId;
    if (suForBranch) {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: suForBranch, deletedAt: null },
        select: { locationId: true },
      });
      if (!su) throw new BadRequestException('Service user not found');
      locationId = su.locationId ?? locationId;
    }
    if (locationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: locationId, deletedAt: null },
        select: { id: true },
      });
      if (!loc) throw new BadRequestException('Branch not found');
      this.orgScope.assertLocationAccess(scope, locationId);
    } else if (scope.locationIds && scope.locationIds.length === 1) {
      locationId = scope.locationIds[0];
    }
    return {
      fromServiceUserId,
      fromEmployeeId,
      aboutServiceUserId,
      aboutEmployeeIds,
      handlerEmployeeId,
      locationId,
    };
  }

  private async allocateReference(
    tx: Prisma.TransactionClient,
    type: FeedbackType,
    year: number,
  ): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
      INSERT INTO "incidents"."FeedbackNumberSequence" ("type", "year", "lastValue", "updatedAt")
      VALUES (${type}::"incidents"."FeedbackType", ${year}, 1, now())
      ON CONFLICT ("type", "year")
      DO UPDATE SET "lastValue" = "FeedbackNumberSequence"."lastValue" + 1, "updatedAt" = now()
      RETURNING "lastValue"
    `);
    return formatFeedbackReference(type, year, rows[0]?.lastValue ?? 1);
  }

  private async resolveNames(
    rows: FeedbackRecord[],
    extraUserIds: Array<string | null> = [],
  ): Promise<Names> {
    const suIds = new Set<string>();
    const empIds = new Set<string>();
    const userIds = new Set<string>();
    const locIds = new Set<string>();
    for (const r of rows) {
      if (r.fromServiceUserId) suIds.add(r.fromServiceUserId);
      if (r.aboutServiceUserId) suIds.add(r.aboutServiceUserId);
      if (r.fromEmployeeId) empIds.add(r.fromEmployeeId);
      if (r.handlerEmployeeId) empIds.add(r.handlerEmployeeId);
      r.aboutEmployeeIds.forEach((e) => empIds.add(e));
      if (r.recordedById) userIds.add(r.recordedById);
      if (r.locationId) locIds.add(r.locationId);
    }
    extraUserIds.forEach((u) => u && userIds.add(u));

    const [sus, emps, users, locs] = await Promise.all([
      suIds.size
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: [...suIds] } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
      empIds.size
        ? this.prisma.employee.findMany({
            where: { id: { in: [...empIds] } },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          })
        : [],
      userIds.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : [],
      locIds.size
        ? this.prisma.location.findMany({
            where: { id: { in: [...locIds] } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const join = (...parts: Array<string | null | undefined>) =>
      parts
        .map((p) => p?.trim())
        .filter(Boolean)
        .join(' ');
    return {
      serviceUsers: new Map(
        sus.map((s) => [s.id, join(s.firstName, s.lastName) || '—']),
      ),
      employees: new Map(
        emps.map((e) => [
          e.id,
          join(e.personalDetail?.firstName, e.personalDetail?.lastName) || '—',
        ]),
      ),
      users: new Map(
        users.map((u) => [u.id, join(u.firstName, u.lastName) || u.email]),
      ),
      locations: new Map(locs.map((l) => [l.id, l.name])),
    };
  }

  private toRow(r: FeedbackRecord, names: Names, now: Date) {
    const overdue = complaintOverdue(r, now);
    const person = (id: string | null, map: Map<string, string>) =>
      id ? { id, name: map.get(id) ?? '—' } : null;
    return {
      id: r.id,
      referenceNumber: r.referenceNumber,
      type: r.type,
      status: r.status,
      receivedAt: r.receivedAt.toISOString(),
      channel: r.channel,
      fromKind: r.fromKind,
      fromName: r.fromName,
      fromContact: r.fromContact,
      fromServiceUser: person(r.fromServiceUserId, names.serviceUsers),
      fromEmployee: person(r.fromEmployeeId, names.employees),
      aboutServiceUser: person(r.aboutServiceUserId, names.serviceUsers),
      aboutEmployees: r.aboutEmployeeIds.map((id) => ({
        id,
        name: names.employees.get(id) ?? '—',
      })),
      location: r.locationId
        ? { id: r.locationId, name: names.locations.get(r.locationId) ?? '—' }
        : null,
      subject: r.subject,
      details: r.details,
      category: r.category,
      severity: r.severity,
      desiredOutcome: r.desiredOutcome,
      handler: person(r.handlerEmployeeId, names.employees),
      acknowledgeDueAt: r.acknowledgeDueAt?.toISOString() ?? null,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      responseDueAt: r.responseDueAt?.toISOString() ?? null,
      respondedAt: r.respondedAt?.toISOString() ?? null,
      investigationNotes: r.investigationNotes,
      responseSummary: r.responseSummary,
      outcome: r.outcome,
      lessonsLearned: r.lessonsLearned,
      closedAt: r.closedAt?.toISOString() ?? null,
      sharedWithStaffAt: r.sharedWithStaffAt?.toISOString() ?? null,
      recordedByName: r.recordedById
        ? (names.users.get(r.recordedById) ?? null)
        : null,
      acknowledgeOverdue: overdue.acknowledge,
      responseOverdue: overdue.response,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private logAudit(
    tx: Prisma.TransactionClient,
    actor: RequestUser,
    action: AuditAction,
    row: FeedbackRecord,
    before: FeedbackRecord | null,
    meta?: RequestAuditMeta,
  ) {
    return this.audit.logAudit({
      tx,
      userId: actor.id,
      module: AuditModule.COMPLAINT,
      action,
      recordType: 'FeedbackRecord',
      recordId: row.id,
      ...(before ? { oldValues: auditSnapshot(before) } : {}),
      newValues: auditSnapshot(row),
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }
}
