import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  QualityAuditActionStatus,
  QualityAuditAnswerValue,
  QualityAuditStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  auditResult,
  readSections,
  type AuditResult,
  type AuditSection,
} from './quality-audit-scoring.util';
import {
  COMPLIANCE_BANDS,
  addDays,
  auditTiming,
  complianceLevel,
  dayString,
  monthsFrom,
  type ComplianceLevel,
} from './quality-audit-schedule.util';
import {
  assertActiveUser,
  assertWritableLocation,
  auditVisibleWhere,
  defaultAuditTitle,
  locationNames,
  scheduleVisibleWhere,
  userNames,
} from './quality-audit-scope';
import { QualityAuditTemplatesService } from './quality-audit-templates.service';
import { QualityAuditSchedulesService } from './quality-audit-schedules.service';
import type {
  AnswerStandardDto,
  AuditFiltersDto,
  AuditReportsQueryDto,
  AuditTab,
  BeginQualityAuditDto,
  CreateQualityAuditActionDto,
  ListQualityAuditsQueryDto,
  StartQualityAuditDto,
  UpdateQualityAuditActionDto,
  UpdateQualityAuditDto,
} from './dto/quality-audits.dto';

const auditInclude = {
  template: {
    select: {
      code: true,
      title: true,
      keyQuestionCode: true,
      frequency: true,
      introduction: true,
      sections: true,
      area: { select: { code: true, name: true } },
    },
  },
  answers: true,
  actions: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.QualityAuditInclude;

export type AuditRow = Prisma.QualityAuditGetPayload<{
  include: typeof auditInclude;
}>;

const OPEN: QualityAuditStatus[] = [
  QualityAuditStatus.DUE,
  QualityAuditStatus.IN_PROGRESS,
];
/** Months on the dashboard timeline: 6 before the current month, the current month and 11 after. */
const TIMELINE_BEFORE = 6;
const TIMELINE_MONTHS = 18;

const toIso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const toDay = (d: Date | null | undefined) => (d ? dayString(d) : null);
const dayOf = (s: string) => new Date(`${s}T00:00:00.000Z`);
const text = (v: string | undefined) =>
  v === undefined ? undefined : v.trim() || null;

export { defaultAuditTitle };

/** The audits in a dashboard tab, on `today`. Missed audits are marked by sync() first. */
export function tabWhere(
  tab: AuditTab,
  today: string,
): Prisma.QualityAuditWhereInput {
  const day = dayOf(today);
  switch (tab) {
    case 'OVERDUE':
      return { status: { in: OPEN }, dueDate: { lt: day } };
    case 'DUE':
      return { status: QualityAuditStatus.DUE, dueDate: { gte: day } };
    case 'IN_PROGRESS':
      return {
        status: QualityAuditStatus.IN_PROGRESS,
        OR: [{ dueDate: null }, { dueDate: { gte: day } }],
      };
    case 'COMPLETED':
      return { status: QualityAuditStatus.COMPLETED };
    case 'MISSED':
      return { status: QualityAuditStatus.MISSED };
  }
}

/** Completed audits at a compliance level (from the frozen percent). */
export function levelWhere(
  level: ComplianceLevel,
): Prisma.QualityAuditWhereInput {
  const percent = (filter: Prisma.JsonNullableFilter<'QualityAudit'>) => ({
    result: { path: ['percent'], ...filter },
  });
  const base = { status: QualityAuditStatus.COMPLETED };
  if (level === 'COMPLIANT')
    return { ...base, ...percent({ gte: COMPLIANCE_BANDS.compliant }) };
  if (level === 'PARTIALLY_COMPLIANT')
    return {
      ...base,
      AND: [
        percent({ gte: COMPLIANCE_BANDS.partially }),
        percent({ lt: COMPLIANCE_BANDS.compliant }),
      ],
    };
  return { ...base, ...percent({ lt: COMPLIANCE_BANDS.partially }) };
}

/**
 * Governance → Audits. An audit is carried out from a template for a branch or the whole
 * organisation, either by hand (start) or from a schedule (QualityAuditSchedulesService makes it DUE;
 * begin or the first answer starts it). Each standard is marked met or not met, with a note for
 * anything not met; actions follow up what was found. The score (quality-audit-scoring.util.ts) is the
 * share of standards met, frozen when completed, and gives the compliance level. A scheduled audit can
 * be completed from its early window (due date − early days); after the late days it is MISSED.
 *
 * Branch scope: as for mock inspections (quality-audit-scope.ts).
 */
@Injectable()
export class QualityAuditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
    private readonly templates: QualityAuditTemplatesService,
    private readonly schedules: QualityAuditSchedulesService,
  ) {}

  // ─── Access ───────────────────────────────────────────────────────────────

  private async requireVisible(
    user: RequestUser,
    id: string,
  ): Promise<AuditRow> {
    const scope = this.orgScope.fromRequestUser(user);
    const row = await this.prisma.qualityAudit.findFirst({
      where: { AND: [{ id }, auditVisibleWhere(scope)] },
      include: auditInclude,
    });
    if (!row) throw new NotFoundException('Audit not found');
    return row;
  }

  /** Visible, the user may change it, and it is in one of `statuses`. */
  private async requireWritable(
    user: RequestUser,
    id: string,
    statuses: QualityAuditStatus[],
  ): Promise<AuditRow> {
    const row = await this.requireVisible(user, id);
    await assertWritableLocation(
      this.prisma,
      this.orgScope.fromRequestUser(user),
      row.locationId,
    );
    if (!statuses.includes(row.status)) {
      throw new BadRequestException(
        row.status === QualityAuditStatus.COMPLETED
          ? 'This audit is completed; its answers can no longer change.'
          : row.status === QualityAuditStatus.CANCELLED
            ? 'This audit was cancelled.'
            : row.status === QualityAuditStatus.MISSED
              ? 'This audit was missed: it was not completed in time.'
              : 'This audit cannot be changed now.',
      );
    }
    return row;
  }

  private async assertEmployee(id: string | null | undefined) {
    if (!id) return;
    const found = await this.prisma.employee.count({
      where: { id, deletedAt: null },
    });
    if (!found)
      throw new BadRequestException('That staff member was not found');
  }

  /** Visibility plus the shared filters (branch, area, person accountable). */
  private filtersWhere(
    user: RequestUser,
    f: AuditFiltersDto,
  ): Prisma.QualityAuditWhereInput[] {
    const scope = this.orgScope.fromRequestUser(user);
    const and: Prisma.QualityAuditWhereInput[] = [auditVisibleWhere(scope)];
    if (f.locationId) {
      this.orgScope.assertLocationAccess(scope, f.locationId);
      and.push({ OR: [{ locationId: f.locationId }, { locationId: null }] });
    }
    if (f.areaCode) and.push({ template: { area: { code: f.areaCode } } });
    if (f.accountableUserId)
      and.push({ accountableUserId: f.accountableUserId });
    return and;
  }

  // ─── List, dashboard and reports ──────────────────────────────────────────

  async list(
    user: RequestUser,
    query: ListQualityAuditsQueryDto,
    now: Date = new Date(),
  ) {
    await this.schedules.sync(now);
    const today = dayString(now);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const and = this.filtersWhere(user, query);
    if (query.tab) and.push(tabWhere(query.tab, today));
    if (query.status) and.push({ status: query.status });
    if (query.level) and.push(levelWhere(query.level));
    if (query.templateCode)
      and.push({ template: { code: query.templateCode } });
    if (query.q)
      and.push({ title: { contains: query.q.trim(), mode: 'insensitive' } });
    const where: Prisma.QualityAuditWhereInput = { AND: and };
    const orderBy: Prisma.QualityAuditOrderByWithRelationInput[] =
      query.tab === 'COMPLETED'
        ? [{ completedAt: 'desc' }]
        : query.tab === 'MISSED'
          ? [{ dueDate: 'desc' }]
          : query.tab
            ? [
                { dueDate: { sort: 'asc', nulls: 'last' } },
                { createdAt: 'asc' },
              ]
            : [{ createdAt: 'desc' }];
    const [total, rows] = await Promise.all([
      this.prisma.qualityAudit.count({ where }),
      this.prisma.qualityAudit.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: auditInclude,
      }),
    ]);
    const [locations, users, previous] = await Promise.all([
      locationNames(
        this.prisma,
        rows.map((r) => r.locationId),
      ),
      userNames(
        this.prisma,
        rows.flatMap((r) => [r.auditorId, r.accountableUserId]),
      ),
      this.previousResults(rows, now),
    ]);
    const person = (uid: string | null) =>
      uid ? { id: uid, name: users.get(uid) ?? null } : null;
    return {
      data: rows.map((r) => {
        const result = this.resultOf(r);
        const timing = this.timingOf(r, today);
        return {
          id: r.id,
          title: r.title,
          status: r.status,
          state: timing?.state ?? null,
          template: {
            code: r.template.code,
            title: r.template.title,
            area: r.template.area,
          },
          location: r.locationId
            ? { id: r.locationId, name: locations.get(r.locationId) ?? null }
            : null,
          scheduled: Boolean(r.scheduleId),
          dueDate: toDay(r.dueDate),
          daysToDue: timing?.daysToDue ?? null,
          daysToClose: timing?.daysToClose ?? null,
          auditDate: toDay(r.auditDate),
          auditor: person(r.auditorId),
          accountable: person(r.accountableUserId),
          auditedItem: r.auditedItemLabel
            ? { label: r.auditedItemLabel, value: r.auditedItemValue }
            : null,
          completedAt: toIso(r.completedAt),
          total: result.total,
          answered: result.answered,
          percent: result.percent,
          level:
            r.status === QualityAuditStatus.COMPLETED
              ? complianceLevel(result.percent)
              : null,
          previousPercent: previous.get(r.id) ?? null,
          openActions: r.actions.filter(
            (a) => a.status === QualityAuditActionStatus.OPEN,
          ).length,
        };
      }),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  /** For each audit, the percent of the last completed audit of the same template and branch before it. */
  private async previousResults(
    rows: AuditRow[],
    now: Date,
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (!rows.length) return out;
    const done = await this.prisma.qualityAudit.findMany({
      where: {
        status: QualityAuditStatus.COMPLETED,
        OR: rows.map((r) => ({
          templateId: r.templateId,
          locationId: r.locationId,
        })),
      },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        templateId: true,
        locationId: true,
        completedAt: true,
        result: true,
      },
    });
    for (const r of rows) {
      const before = r.completedAt ?? now;
      const prev = done.find(
        (d) =>
          d.id !== r.id &&
          d.templateId === r.templateId &&
          d.locationId === r.locationId &&
          d.completedAt &&
          d.completedAt < before,
      );
      out.set(
        r.id,
        prev
          ? ((prev.result as unknown as AuditResult | null)?.percent ?? null)
          : null,
      );
    }
    return out;
  }

  /** Tab counts and the month-by-month timeline (completed, missed and due, with future schedules). */
  async dashboard(
    user: RequestUser,
    filters: AuditFiltersDto,
    now: Date = new Date(),
  ) {
    await this.schedules.sync(now);
    const today = dayString(now);
    const and = this.filtersWhere(user, filters);
    const tabs = [
      'OVERDUE',
      'DUE',
      'IN_PROGRESS',
      'COMPLETED',
      'MISSED',
    ] as const;
    const counts = await Promise.all(
      tabs.map((t) =>
        this.prisma.qualityAudit.count({
          where: { AND: [...and, tabWhere(t, today)] },
        }),
      ),
    );

    const firstMonth = shiftMonth(today.slice(0, 7), -TIMELINE_BEFORE);
    const timelineMonths = monthsFrom(firstMonth, TIMELINE_MONTHS);
    const from = `${timelineMonths[0]}-01`;
    const lastMonth = timelineMonths[timelineMonths.length - 1];
    const to = addDays(`${shiftMonth(lastMonth, 1)}-01`, -1);
    const rows = await this.prisma.qualityAudit.findMany({
      where: {
        AND: [
          ...and,
          { status: { not: QualityAuditStatus.CANCELLED } },
          {
            OR: [
              { dueDate: { gte: dayOf(from), lte: dayOf(to) } },
              {
                dueDate: null,
                completedAt: { gte: dayOf(from), lt: dayOf(addDays(to, 1)) },
              },
            ],
          },
        ],
      },
      select: { status: true, dueDate: true, completedAt: true },
    });
    const bucket = new Map(
      timelineMonths.map((m) => [
        m,
        { month: m, completed: 0, missed: 0, due: 0 },
      ]),
    );
    for (const r of rows) {
      const month = (toDay(r.dueDate) ?? toDay(r.completedAt))!.slice(0, 7);
      const b = bucket.get(month);
      if (!b) continue;
      if (r.status === QualityAuditStatus.COMPLETED) b.completed += 1;
      else if (r.status === QualityAuditStatus.MISSED) b.missed += 1;
      else b.due += 1;
    }
    const scope = this.orgScope.fromRequestUser(user);
    const scheduleWhere: Prisma.QualityAuditScheduleWhereInput[] = [
      scheduleVisibleWhere(scope),
    ];
    if (filters.locationId)
      scheduleWhere.push({
        OR: [{ locationId: filters.locationId }, { locationId: null }],
      });
    if (filters.areaCode)
      scheduleWhere.push({ template: { area: { code: filters.areaCode } } });
    if (filters.accountableUserId)
      scheduleWhere.push({ accountableUserId: filters.accountableUserId });
    const projected = await this.schedules.projectedDueDates(
      { AND: scheduleWhere },
      today > from ? today : from,
      to,
    );
    for (const p of projected) {
      const b = bucket.get(p.dueDate.slice(0, 7));
      if (b) b.due += 1;
    }
    return {
      data: {
        today,
        currentMonth: today.slice(0, 7),
        counts: {
          overdue: counts[0],
          due: counts[1],
          inProgress: counts[2],
          completed: counts[3],
          missed: counts[4],
        },
        timeline: [...bucket.values()],
      },
    };
  }

  /** Compliance of audits completed in the last `days`, what is coming due, and compliance by month. */
  async reports(
    user: RequestUser,
    query: AuditReportsQueryDto,
    now: Date = new Date(),
  ) {
    await this.schedules.sync(now);
    const today = dayString(now);
    const days = query.days ?? 30;
    const since = dayOf(addDays(today, -days));
    const and = this.filtersWhere(user, query);
    const completed = await this.prisma.qualityAudit.findMany({
      where: {
        AND: [
          ...and,
          { status: QualityAuditStatus.COMPLETED, completedAt: { gte: since } },
        ],
      },
      select: { completedAt: true, result: true },
      orderBy: { completedAt: 'asc' },
    });
    const levels: Record<ComplianceLevel, number> = {
      COMPLIANT: 0,
      PARTIALLY_COMPLIANT: 0,
      NOT_COMPLIANT: 0,
    };
    const byMonth = new Map<
      string,
      { month: string; audits: number; total: number }
    >();
    let sum = 0;
    let scored = 0;
    for (const c of completed) {
      const percent =
        (c.result as unknown as AuditResult | null)?.percent ?? null;
      const level = complianceLevel(percent);
      if (level) levels[level] += 1;
      if (percent === null) continue;
      sum += percent;
      scored += 1;
      const month = dayString(c.completedAt!).slice(0, 7);
      const m = byMonth.get(month) ?? { month, audits: 0, total: 0 };
      m.audits += 1;
      m.total += percent;
      byMonth.set(month, m);
    }
    const openWhere = (
      toDayInclusive: string,
    ): Prisma.QualityAuditWhereInput => ({
      AND: [
        ...and,
        { status: { in: OPEN } },
        { dueDate: { gte: dayOf(today), lte: dayOf(toDayInclusive) } },
      ],
    });
    const [overdue, dueThisWeek, dueIn30Days] = await Promise.all([
      this.prisma.qualityAudit.count({
        where: { AND: [...and, tabWhere('OVERDUE', today)] },
      }),
      this.prisma.qualityAudit.count({ where: openWhere(addDays(today, 7)) }),
      this.prisma.qualityAudit.count({ where: openWhere(addDays(today, 30)) }),
    ]);
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      data: {
        days,
        since: dayString(since),
        bands: COMPLIANCE_BANDS,
        levels,
        overallPercent: scored ? round(sum / scored) : null,
        due: { overdue, dueThisWeek, dueIn30Days },
        byMonth: [...byMonth.values()].map((m) => ({
          month: m.month,
          audits: m.audits,
          percent: round(m.total / m.audits),
        })),
      },
    };
  }

  // ─── Audits ───────────────────────────────────────────────────────────────

  /** Starts an audit by hand (not from a schedule). */
  async start(
    user: RequestUser,
    dto: StartQualityAuditDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const scope = this.orgScope.fromRequestUser(user);
    const locationId = dto.locationId ?? null;
    await assertWritableLocation(this.prisma, scope, locationId);
    const auditorId = dto.auditorId ?? user.id;
    await assertActiveUser(this.prisma, auditorId, 'The auditor');
    const template = await this.templates.requireTemplate(
      user,
      dto.templateCode,
    );
    const auditDate = dto.auditDate ?? dayString(now);
    const row = await this.prisma.qualityAudit.create({
      data: {
        templateId: template.id,
        sections: template.sections as Prisma.InputJsonValue,
        locationId,
        title:
          dto.title?.trim() || defaultAuditTitle(template.title, auditDate),
        auditDate: dayOf(auditDate),
        auditorId,
        accountableUserId: auditorId,
        auditedItemLabel: template.auditedItemLabel,
        auditedItemValue: template.auditedItemLabel
          ? dto.auditedItemValue?.trim() || null
          : null,
        status: QualityAuditStatus.IN_PROGRESS,
        startedAt: now,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_STARTED,
      row.id,
      meta,
      undefined,
      {
        template: template.code,
        locationId,
        auditDate,
        auditorId,
      },
    );
    return {
      message: 'Audit started',
      data: await this.detail(await this.requireVisible(user, row.id), now),
    };
  }

  /** Starts a due (scheduled) audit: you become the auditor and it uses the template's current standards. */
  async begin(
    user: RequestUser,
    id: string,
    dto: BeginQualityAuditDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const row = await this.requireWritable(user, id, [QualityAuditStatus.DUE]);
    await this.beginRow(user, row, dto.auditedItemValue, now);
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_STARTED,
      id,
      meta,
      undefined,
      { begun: true },
    );
    return {
      message: 'Audit started',
      data: await this.detail(await this.requireVisible(user, id), now),
    };
  }

  private async beginRow(
    user: RequestUser,
    row: AuditRow,
    auditedItemValue: string | undefined,
    now: Date,
  ) {
    await this.prisma.qualityAudit.update({
      where: { id: row.id },
      data: {
        status: QualityAuditStatus.IN_PROGRESS,
        startedAt: now,
        auditDate: dayOf(dayString(now)),
        auditorId: user.id,
        sections: row.template.sections as Prisma.InputJsonValue,
        ...(row.auditedItemLabel && auditedItemValue !== undefined
          ? { auditedItemValue: auditedItemValue.trim() || null }
          : {}),
        updatedById: user.id,
      },
    });
  }

  async get(user: RequestUser, id: string, now: Date = new Date()) {
    return {
      data: await this.detail(await this.requireVisible(user, id), now),
    };
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateQualityAuditDto,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.requireWritable(user, id, OPEN);
    const data: Prisma.QualityAuditUncheckedUpdateInput = {
      updatedById: user.id,
    };
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.auditDate !== undefined) data.auditDate = dayOf(dto.auditDate);
    if (dto.auditorId !== undefined) {
      await assertActiveUser(this.prisma, dto.auditorId, 'The auditor');
      data.auditorId = dto.auditorId;
    }
    if (dto.accountableUserId !== undefined) {
      await assertActiveUser(
        this.prisma,
        dto.accountableUserId,
        'The person accountable',
      );
      data.accountableUserId = dto.accountableUserId;
    }
    if (dto.summary !== undefined) data.summary = text(dto.summary);
    if (dto.auditedItemValue !== undefined) {
      if (!row.auditedItemLabel)
        throw new BadRequestException(
          'This audit does not record an audited item.',
        );
      data.auditedItemValue = text(dto.auditedItemValue);
    }
    const updated = await this.prisma.qualityAudit.update({
      where: { id },
      data,
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_UPDATED,
      id,
      meta,
      auditSnapshot(row),
      auditSnapshot(updated),
    );
    return {
      message: 'Saved',
      data: await this.detail(await this.requireVisible(user, id)),
    };
  }

  /** Saves (or with `answer: null` clears) the answer to one standard; the first answer starts a due audit. */
  async answer(
    user: RequestUser,
    id: string,
    standardId: string,
    dto: AnswerStandardDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    let row = await this.requireWritable(user, id, OPEN);
    if (row.status === QualityAuditStatus.DUE) {
      if (dto.answer === null)
        throw new BadRequestException('Start the audit first.');
      await this.beginRow(user, row, undefined, now);
      row = await this.requireVisible(user, id);
    }
    if (!this.standardOf(row, standardId))
      throw new NotFoundException('That standard is not part of this audit');
    const existing = row.answers.find((a) => a.standardId === standardId);
    if (dto.answer === null) {
      if (existing)
        await this.prisma.qualityAuditAnswer.delete({
          where: { id: existing.id },
        });
    } else {
      const note =
        dto.note === undefined
          ? (existing?.note ?? null)
          : (text(dto.note) ?? null);
      const celebrate =
        dto.answer === QualityAuditAnswerValue.MET &&
        (dto.celebrate ?? existing?.celebrate ?? false);
      const data = {
        answer: dto.answer,
        note,
        celebrate,
        answeredById: user.id,
        answeredAt: now,
      };
      await this.prisma.qualityAuditAnswer.upsert({
        where: { auditId_standardId: { auditId: id, standardId } },
        create: { auditId: id, standardId, ...data },
        update: data,
      });
    }
    await this.prisma.qualityAudit.update({
      where: { id },
      data: { updatedById: user.id },
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_ANSWERED,
      id,
      meta,
      { standardId, answer: existing?.answer ?? null },
      { standardId, answer: dto.answer },
    );
    return {
      message: 'Saved',
      data: await this.detail(await this.requireVisible(user, id), now),
    };
  }

  /** Needs every standard answered, a note for each not met, and (scheduled) its window open; freezes the score. */
  async complete(
    user: RequestUser,
    id: string,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const row = await this.requireWritable(user, id, [
      QualityAuditStatus.IN_PROGRESS,
    ]);
    const timing = this.timingOf(row, dayString(now));
    if (timing?.state === 'UPCOMING')
      throw new BadRequestException(
        `This audit can be completed from ${ukDate(timing.opensOn)} (${row.earlyDays ?? 0} days before it is due).`,
      );
    const result = this.resultOf(row);
    if (!result.complete)
      throw new BadRequestException(
        `Answer every standard first: ${result.total - result.answered} of ${result.total} still to answer.`,
      );
    if (result.missingNotes.length)
      throw new BadRequestException(
        `Add a note to every standard not met: ${result.missingNotes.length} still ${result.missingNotes.length === 1 ? 'needs' : 'need'} one.`,
      );
    if (row.auditedItemLabel && !row.auditedItemValue?.trim())
      throw new BadRequestException(`Fill in "${row.auditedItemLabel}" first.`);
    await this.prisma.qualityAudit.update({
      where: { id },
      data: {
        status: QualityAuditStatus.COMPLETED,
        completedAt: now,
        result: result,
        updatedById: user.id,
      },
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_COMPLETED,
      id,
      meta,
      undefined,
      {
        percent: result.percent,
        met: result.met,
        notMet: result.notMet,
      },
    );
    // A scheduled audit's next one is made straight away.
    if (row.scheduleId) await this.schedules.sync(now);
    return {
      message: 'Audit completed',
      data: await this.detail(await this.requireVisible(user, id), now),
    };
  }

  async cancel(
    user: RequestUser,
    id: string,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const row = await this.requireWritable(user, id, OPEN);
    await this.prisma.qualityAudit.update({
      where: { id },
      data: {
        status: QualityAuditStatus.CANCELLED,
        cancelledAt: now,
        updatedById: user.id,
      },
    });
    await this.log(user, AuditAction.QUALITY_AUDIT_CANCELLED, id, meta);
    if (row.scheduleId) await this.schedules.sync(now);
    return {
      message: 'Audit cancelled',
      data: await this.detail(await this.requireVisible(user, id), now),
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  private static readonly ACTION_STATUSES: QualityAuditStatus[] = [
    QualityAuditStatus.IN_PROGRESS,
    QualityAuditStatus.COMPLETED,
    QualityAuditStatus.MISSED,
  ];

  async createAction(
    user: RequestUser,
    id: string,
    dto: CreateQualityAuditActionDto,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.requireWritable(
      user,
      id,
      QualityAuditsService.ACTION_STATUSES,
    );
    if (dto.standardId && !this.standardOf(row, dto.standardId))
      throw new BadRequestException('That standard is not part of this audit');
    await this.assertEmployee(dto.assignedEmployeeId);
    const action = await this.prisma.qualityAuditAction.create({
      data: {
        auditId: id,
        standardId: dto.standardId ?? null,
        title: dto.title.trim(),
        detail: text(dto.detail) ?? null,
        assignedEmployeeId: dto.assignedEmployeeId ?? null,
        dueAt: dto.dueAt ? dayOf(dto.dueAt.slice(0, 10)) : null,
        urgent: dto.urgent ?? false,
        createdById: user.id,
      },
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_ACTION_CREATED,
      id,
      meta,
      undefined,
      auditSnapshot(action),
    );
    return {
      message: 'Action added',
      data: await this.detail(await this.requireVisible(user, id)),
    };
  }

  async updateAction(
    user: RequestUser,
    id: string,
    actionId: string,
    dto: UpdateQualityAuditActionDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const row = await this.requireWritable(
      user,
      id,
      QualityAuditsService.ACTION_STATUSES,
    );
    const existing = row.actions.find((a) => a.id === actionId);
    if (!existing) throw new NotFoundException('Action not found');
    const data: Prisma.QualityAuditActionUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.detail !== undefined) data.detail = text(dto.detail);
    if (dto.assignedEmployeeId !== undefined) {
      await this.assertEmployee(dto.assignedEmployeeId);
      data.assignedEmployeeId = dto.assignedEmployeeId;
    }
    if (dto.dueAt !== undefined)
      data.dueAt = dto.dueAt ? dayOf(dto.dueAt.slice(0, 10)) : null;
    if (dto.urgent !== undefined) data.urgent = dto.urgent;
    if (dto.status !== undefined && dto.status !== existing.status) {
      data.status = dto.status;
      data.completedAt =
        dto.status === QualityAuditActionStatus.DONE ? now : null;
    }
    const updated = await this.prisma.qualityAuditAction.update({
      where: { id: actionId },
      data,
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_ACTION_UPDATED,
      id,
      meta,
      auditSnapshot(existing),
      auditSnapshot(updated),
    );
    return {
      message: 'Action updated',
      data: await this.detail(await this.requireVisible(user, id)),
    };
  }

  // ─── Detail ───────────────────────────────────────────────────────────────

  private sectionsOf(row: Pick<AuditRow, 'sections'>): AuditSection[] {
    return readSections(row.sections);
  }

  private standardOf(row: Pick<AuditRow, 'sections'>, standardId: string) {
    for (const s of this.sectionsOf(row))
      for (const st of s.standards) if (st.id === standardId) return st;
    return null;
  }

  private timingOf(
    row: Pick<AuditRow, 'status' | 'dueDate' | 'earlyDays' | 'lateDays'>,
    today: string,
  ) {
    if (!row.dueDate || !OPEN.includes(row.status)) return null;
    return auditTiming(
      toDay(row.dueDate)!,
      row.earlyDays ?? 0,
      row.lateDays ?? 0,
      today,
    );
  }

  /** The frozen result of a completed audit, otherwise the live one. */
  private resultOf(row: AuditRow): AuditResult {
    if (row.status === QualityAuditStatus.COMPLETED && row.result)
      return row.result as unknown as AuditResult;
    return auditResult(
      this.sectionsOf(row),
      row.answers.map((a) => ({
        standardId: a.standardId,
        answer: a.answer,
        celebrate: a.celebrate,
        note: a.note,
      })),
    );
  }

  async detail(row: AuditRow, now: Date = new Date()) {
    const [users, locations, employees] = await Promise.all([
      userNames(this.prisma, [
        row.auditorId,
        row.accountableUserId,
        row.createdById,
        ...row.answers.map((a) => a.answeredById),
      ]),
      locationNames(this.prisma, [row.locationId]),
      this.employeeNames(row.actions.map((a) => a.assignedEmployeeId)),
    ]);
    const person = (uid: string | null) =>
      uid ? { id: uid, name: users.get(uid) ?? null } : null;
    const answers = new Map(row.answers.map((a) => [a.standardId, a]));
    const numbers = new Map<string, { number: number; text: string }>();
    let n = 0;
    // A due audit shows the template's current standards (it takes a copy when started).
    const source =
      row.status === QualityAuditStatus.DUE
        ? readSections(row.template.sections)
        : this.sectionsOf(row);
    const sections = source.map((s) => ({
      title: s.title,
      standards: s.standards.map((st) => {
        n += 1;
        numbers.set(st.id, { number: n, text: st.text });
        const a = answers.get(st.id);
        return {
          id: st.id,
          number: n,
          text: st.text,
          hint: st.hint ?? null,
          answer: a
            ? {
                answer: a.answer,
                celebrate: a.celebrate,
                note: a.note,
                answeredBy: person(a.answeredById),
                answeredAt: a.answeredAt.toISOString(),
              }
            : null,
        };
      }),
    }));
    const result = this.resultOf(row);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      template: {
        code: row.template.code,
        title: row.template.title,
        keyQuestionCode: row.template.keyQuestionCode,
        frequency: row.template.frequency,
        introduction: row.template.introduction,
        area: row.template.area,
      },
      location: row.locationId
        ? { id: row.locationId, name: locations.get(row.locationId) ?? null }
        : null,
      scheduleId: row.scheduleId,
      dueDate: toDay(row.dueDate),
      earlyDays: row.earlyDays,
      lateDays: row.lateDays,
      timing: this.timingOf(row, dayString(now)),
      auditDate: toDay(row.auditDate),
      auditor: person(row.auditorId),
      accountable: person(row.accountableUserId),
      auditedItem: row.auditedItemLabel
        ? { label: row.auditedItemLabel, value: row.auditedItemValue }
        : null,
      summary: row.summary,
      createdBy: person(row.createdById),
      startedAt: toIso(row.startedAt),
      completedAt: toIso(row.completedAt),
      missedAt: toIso(row.missedAt),
      cancelledAt: toIso(row.cancelledAt),
      result,
      level:
        row.status === QualityAuditStatus.COMPLETED
          ? complianceLevel(result.percent)
          : null,
      sections,
      actions: row.actions.map((a) => ({
        id: a.id,
        standardId: a.standardId,
        standardNumber: a.standardId
          ? (numbers.get(a.standardId)?.number ?? null)
          : null,
        standardText: a.standardId
          ? (numbers.get(a.standardId)?.text ?? null)
          : null,
        title: a.title,
        detail: a.detail,
        assignedEmployee: a.assignedEmployeeId
          ? {
              id: a.assignedEmployeeId,
              name: employees.get(a.assignedEmployeeId) ?? null,
            }
          : null,
        dueAt: toDay(a.dueAt),
        urgent: a.urgent,
        status: a.status,
        completedAt: toIso(a.completedAt),
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

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
      recordType: 'QualityAudit',
      recordId,
      ...(oldValues !== undefined ? { oldValues } : {}),
      ...(newValues !== undefined ? { newValues } : {}),
      ...meta,
    });
  }

  private async employeeNames(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true } },
      },
    });
    return new Map(
      rows.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Staff member',
      ]),
    );
  }
}

/** "2026-11" moved by `by` months (negative for earlier). */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** "2026-11-23" → "23/11/2026". */
function ukDate(day: string) {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}
