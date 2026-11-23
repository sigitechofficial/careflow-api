import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QualityAuditStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import {
  addDays,
  dayString,
  dueDatesBetween,
  nextDueDate,
  type AuditFrequency,
} from './quality-audit-schedule.util';
import {
  assertActiveUser,
  assertWritableLocation,
  defaultAuditTitle,
  locationNames,
  scheduleVisibleWhere,
  userNames,
} from './quality-audit-scope';
import { QualityAuditTemplatesService } from './quality-audit-templates.service';
import type {
  CreateAuditScheduleDto,
  ListAuditSchedulesQueryDto,
  UpdateAuditScheduleDto,
} from './dto/quality-audits.dto';

const OPEN: QualityAuditStatus[] = [
  QualityAuditStatus.DUE,
  QualityAuditStatus.IN_PROGRESS,
];
/** Never create more than this many past audits for one schedule in one go. */
const MAX_BACKFILL = 120;

const scheduleInclude = {
  template: {
    select: {
      code: true,
      title: true,
      sections: true,
      auditedItemLabel: true,
      retiredAt: true,
      area: { select: { code: true, name: true } },
    },
  },
} satisfies Prisma.QualityAuditScheduleInclude;
type ScheduleRow = Prisma.QualityAuditScheduleGetPayload<{
  include: typeof scheduleInclude;
}>;

const toDay = (d: Date | null | undefined) => (d ? dayString(d) : null);
const dayOf = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * Governance → Audits: schedules. A schedule carries out a template for a branch every period. It
 * always has one open audit (DUE, or IN_PROGRESS once started): when that is completed, missed or
 * cancelled, the next one is made for the next due date. An open audit not completed by its due date
 * plus the late days becomes MISSED. This happens in sync(), which the list, dashboard and reports
 * call before reading, so no scheduled job is needed; it is idempotent (one audit per schedule and
 * due date).
 */
@Injectable()
export class QualityAuditSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
    private readonly templates: QualityAuditTemplatesService,
  ) {}

  /** Marks missed audits and makes each active schedule's next due audit. */
  async sync(
    now: Date = new Date(),
  ): Promise<{ missed: number; created: number }> {
    const today = dayString(now);
    let missed = 0;
    let created = 0;

    const open = await this.prisma.qualityAudit.findMany({
      where: { status: { in: OPEN }, dueDate: { lt: dayOf(today) } },
      select: { id: true, dueDate: true, lateDays: true },
    });
    const late = open.filter(
      (a) => addDays(dayString(a.dueDate!), a.lateDays ?? 0) < today,
    );
    if (late.length) {
      const r = await this.prisma.qualityAudit.updateMany({
        where: { id: { in: late.map((a) => a.id) }, status: { in: OPEN } },
        data: { status: QualityAuditStatus.MISSED, missedAt: now },
      });
      missed = r.count;
    }

    const schedules = await this.prisma.qualityAuditSchedule.findMany({
      where: { stoppedAt: null, template: { retiredAt: null } },
      include: scheduleInclude,
    });
    for (const s of schedules)
      created += await this.ensureOpenAudit(s, today, now);
    return { missed, created };
  }

  /** Makes the next due audit(s) until the schedule has one open; past ones are made as MISSED. */
  private async ensureOpenAudit(
    s: ScheduleRow,
    today: string,
    now: Date,
  ): Promise<number> {
    const latest = await this.prisma.qualityAudit.findFirst({
      where: { scheduleId: s.id },
      orderBy: { dueDate: 'desc' },
      select: { dueDate: true, status: true },
    });
    if (latest && OPEN.includes(latest.status)) return 0;
    const first = toDay(s.firstDueDate)!;
    let after = latest?.dueDate ? toDay(latest.dueDate) : null;
    let made = 0;
    for (let i = 0; i < MAX_BACKFILL; i++) {
      const due = nextDueDate(first, s.frequency as AuditFrequency, after);
      const isPast = addDays(due, s.lateDays) < today;
      try {
        await this.prisma.qualityAudit.create({
          data: {
            templateId: s.templateId,
            scheduleId: s.id,
            sections: s.template.sections as Prisma.InputJsonValue,
            locationId: s.locationId,
            title: defaultAuditTitle(s.template.title, due),
            dueDate: dayOf(due),
            earlyDays: s.earlyDays,
            lateDays: s.lateDays,
            auditDate: null,
            startedAt: null,
            accountableUserId: s.accountableUserId,
            auditedItemLabel: s.template.auditedItemLabel,
            status: isPast ? QualityAuditStatus.MISSED : QualityAuditStatus.DUE,
            missedAt: isPast ? now : null,
          },
        });
        made += 1;
      } catch (e) {
        // Another request made it at the same moment.
        if (
          !(
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          )
        )
          throw e;
        return made;
      }
      if (!isPast) break;
      after = due;
    }
    return made;
  }

  /** Due dates the active schedules will bring from `from` to `to` that have no audit yet (for the timeline). */
  async projectedDueDates(
    where: Prisma.QualityAuditScheduleWhereInput,
    from: string,
    to: string,
  ): Promise<Array<{ scheduleId: string; dueDate: string }>> {
    const schedules = await this.prisma.qualityAuditSchedule.findMany({
      where: {
        AND: [{ stoppedAt: null, template: { retiredAt: null } }, where],
      },
      select: {
        id: true,
        firstDueDate: true,
        frequency: true,
        audits: {
          select: { dueDate: true },
          orderBy: { dueDate: 'desc' },
          take: 1,
        },
      },
    });
    const out: Array<{ scheduleId: string; dueDate: string }> = [];
    for (const s of schedules) {
      const latest = toDay(s.audits[0]?.dueDate);
      const start = latest && latest >= from ? addDays(latest, 1) : from;
      for (const due of dueDatesBetween(
        toDay(s.firstDueDate)!,
        s.frequency as AuditFrequency,
        start,
        to,
      ))
        out.push({ scheduleId: s.id, dueDate: due });
    }
    return out;
  }

  // ─── Schedules ────────────────────────────────────────────────────────────

  async list(
    user: RequestUser,
    query: ListAuditSchedulesQueryDto,
    now: Date = new Date(),
  ) {
    await this.sync(now);
    const scope = this.orgScope.fromRequestUser(user);
    const and: Prisma.QualityAuditScheduleWhereInput[] = [
      scheduleVisibleWhere(scope),
    ];
    if (!query.includeStopped) and.push({ stoppedAt: null });
    if (query.templateCode)
      and.push({ template: { code: query.templateCode } });
    if (query.locationId) {
      this.orgScope.assertLocationAccess(scope, query.locationId);
      and.push({ locationId: query.locationId });
    }
    const rows = await this.prisma.qualityAuditSchedule.findMany({
      where: { AND: and },
      orderBy: { createdAt: 'desc' },
      include: {
        ...scheduleInclude,
        audits: {
          where: { status: { in: OPEN } },
          select: { id: true, dueDate: true, status: true },
          take: 1,
        },
      },
    });
    const [locations, users] = await Promise.all([
      locationNames(
        this.prisma,
        rows.map((r) => r.locationId),
      ),
      userNames(
        this.prisma,
        rows.map((r) => r.accountableUserId),
      ),
    ]);
    return {
      data: rows.map((s) => ({
        id: s.id,
        template: {
          code: s.template.code,
          title: s.template.title,
          area: s.template.area,
        },
        location: s.locationId
          ? { id: s.locationId, name: locations.get(s.locationId) ?? null }
          : null,
        frequency: s.frequency,
        earlyDays: s.earlyDays,
        lateDays: s.lateDays,
        firstDueDate: toDay(s.firstDueDate),
        accountable: s.accountableUserId
          ? {
              id: s.accountableUserId,
              name: users.get(s.accountableUserId) ?? null,
            }
          : null,
        stoppedAt: s.stoppedAt?.toISOString() ?? null,
        next: s.audits[0]
          ? {
              auditId: s.audits[0].id,
              dueDate: toDay(s.audits[0].dueDate),
              status: s.audits[0].status,
            }
          : null,
      })),
    };
  }

  async create(
    user: RequestUser,
    dto: CreateAuditScheduleDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const scope = this.orgScope.fromRequestUser(user);
    const locationId = dto.locationId ?? null;
    await assertWritableLocation(this.prisma, scope, locationId, 'A schedule');
    const template = await this.templates.requireTemplate(
      user,
      dto.templateCode,
    );
    if (
      template.isCustom &&
      template.locationIds.length &&
      (!locationId || !template.locationIds.includes(locationId))
    )
      throw new BadRequestException(
        'That template is not used at this branch. Choose one of its branches.',
      );
    const accountableUserId = dto.accountableUserId ?? user.id;
    await assertActiveUser(
      this.prisma,
      accountableUserId,
      'The person accountable',
    );
    const duplicate = await this.prisma.qualityAuditSchedule.count({
      where: { templateId: template.id, locationId, stoppedAt: null },
    });
    if (duplicate)
      throw new BadRequestException(
        'This audit is already scheduled for this branch. Change that schedule instead.',
      );
    const schedule = await this.prisma.qualityAuditSchedule.create({
      data: {
        templateId: template.id,
        locationId,
        frequency: dto.frequency ?? template.frequency,
        earlyDays: dto.earlyDays ?? template.earlyDays,
        lateDays: dto.lateDays ?? template.lateDays,
        firstDueDate: dayOf(dto.firstDueDate),
        accountableUserId,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_SCHEDULE_CREATED,
      schedule.id,
      meta,
      undefined,
      auditSnapshot(schedule),
    );
    await this.sync(now);
    return {
      message: 'Audit scheduled',
      data: await this.one(user, schedule.id),
    };
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateAuditScheduleDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireWritable(user, id);
    if (dto.accountableUserId !== undefined)
      await assertActiveUser(
        this.prisma,
        dto.accountableUserId,
        'The person accountable',
      );
    const data: Prisma.QualityAuditScheduleUncheckedUpdateInput = {
      updatedById: user.id,
    };
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.earlyDays !== undefined) data.earlyDays = dto.earlyDays;
    if (dto.lateDays !== undefined) data.lateDays = dto.lateDays;
    if (dto.accountableUserId !== undefined)
      data.accountableUserId = dto.accountableUserId;
    const updated = await this.prisma.qualityAuditSchedule.update({
      where: { id },
      data,
    });
    // The audit waiting to be done follows the new settings; ones already started keep theirs.
    await this.prisma.qualityAudit.updateMany({
      where: { scheduleId: id, status: QualityAuditStatus.DUE },
      data: {
        earlyDays: updated.earlyDays,
        lateDays: updated.lateDays,
        accountableUserId: updated.accountableUserId,
      },
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_SCHEDULE_UPDATED,
      id,
      meta,
      auditSnapshot(existing),
      auditSnapshot(updated),
    );
    return { message: 'Schedule saved', data: await this.one(user, id) };
  }

  /** Stops the schedule; the audit waiting to be done is cancelled, one already started is kept. */
  async stop(
    user: RequestUser,
    id: string,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const existing = await this.requireWritable(user, id);
    if (existing.stoppedAt)
      throw new BadRequestException('This schedule is already stopped.');
    await this.prisma.qualityAuditSchedule.update({
      where: { id },
      data: { stoppedAt: now, updatedById: user.id },
    });
    await this.prisma.qualityAudit.updateMany({
      where: { scheduleId: id, status: QualityAuditStatus.DUE },
      data: { status: QualityAuditStatus.CANCELLED, cancelledAt: now },
    });
    await this.log(user, AuditAction.QUALITY_AUDIT_SCHEDULE_STOPPED, id, meta);
    return { message: 'Schedule stopped', data: await this.one(user, id) };
  }

  private async one(user: RequestUser, id: string) {
    const { data } = await this.list(user, { includeStopped: true });
    const row = data.find((s) => s.id === id);
    if (!row) throw new NotFoundException('Schedule not found');
    return row;
  }

  private async requireWritable(user: RequestUser, id: string) {
    const scope = this.orgScope.fromRequestUser(user);
    const row = await this.prisma.qualityAuditSchedule.findFirst({
      where: { AND: [{ id }, scheduleVisibleWhere(scope)] },
    });
    if (!row) throw new NotFoundException('Schedule not found');
    await assertWritableLocation(
      this.prisma,
      scope,
      row.locationId,
      'A schedule',
    );
    return row;
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
      module: AuditModule.QUALITY_AUDITS,
      action,
      recordType: 'QualityAuditSchedule',
      recordId,
      ...(oldValues !== undefined ? { oldValues } : {}),
      ...(newValues !== undefined ? { newValues } : {}),
      ...meta,
    });
  }
}
