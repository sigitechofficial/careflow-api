import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { operationalDayBounds, operationalTodayIso } from '../common/utils/operational-day.util';
import type { OperationsOverviewQueryDto } from './dto/home-signals-query.dto';

const DAY_MS = 86_400_000;

/** Lifecycles in which an ECM alert still needs someone to act (matches the ECM queue). */
const OPEN_ALERT_LIFECYCLES = ['DETECTED', 'ALERT_GENERATED', 'ASSIGNED', 'ACKNOWLEDGED', 'INVESTIGATING', 'ACTION_TAKEN'];
/** Allocation statuses that put a carer on a visit. */
const ACTIVE_ALLOCATION = ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'];
/** Job statuses that no longer need a carer. */
const CLOSED_JOB = ['CANCELLED', 'CALLED_OFF', 'COMPLETED', 'PARTIALLY_COMPLETED', 'MISSED'];
const CANCELLED_JOB = ['CANCELLED', 'CALLED_OFF'];
/** Cancellation reasons where the provider, not the person, stopped the visit. */
const PROVIDER_REASONS = ['PROVIDER_UNABLE_TO_STAFF', 'PROVIDER_ROTA_ERROR'];
/** A service user seeing more different carers than this in 4 weeks has poor continuity. */
const MANY_CARERS_THRESHOLD = 5;

function addDaysIso(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T00:00:00.000Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/**
 * Care Operations module dashboard figures that the per-day lists cannot give reliably:
 * ECM alert backlog, unfilled visits over a horizon, cancellations and continuity of care.
 * Counted in the database (no page limits) and scoped to the caller's branches.
 */
@Injectable()
export class OperationsOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /** SQL condition limiting a job (alias j, service user su, area sa) to the caller's branches. */
  private jobScope(user: RequestUser, locationId?: string): Prisma.Sql | null {
    const scope = this.orgScope.fromRequestUser(user);
    const ids = this.orgScope.resolveListLocationIds(scope, locationId);
    if (ids && ids.length === 0) return null;
    if (!ids) return Prisma.sql`TRUE`;
    return Prisma.sql`(su."locationId" = ANY(${ids}::uuid[]) OR sa."locationId" = ANY(${ids}::uuid[]))`;
  }

  async overview(user: RequestUser, q: OperationsOverviewQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const dayStart = (iso: string) => operationalDayBounds(iso, timeZone).start;
    const todayStart = dayStart(today);
    const tomorrowStart = dayStart(addDaysIso(today, 1));
    const in7 = dayStart(addDaysIso(today, 7));
    const in28 = dayStart(addDaysIso(today, 28));
    const last7Start = dayStart(addDaysIso(today, -6));
    const last28Start = dayStart(addDaysIso(today, -27));
    const now = new Date();

    const result = {
      today,
      timeZone,
      alerts: {
        open: 0,
        unacknowledged: 0,
        pastResponseTarget: 0,
        oldestOpenAt: null as string | null,
        byKind: {} as Record<string, number>,
      },
      cover: {
        visitsToday: 0,
        unfilledToday: 0,
        visitsNext7: 0,
        unfilledNext7: 0,
        unfilledNext28: 0,
        nextUnfilledAt: null as string | null,
        plannedHoursNext7: 0,
        needsAttention: 0,
      },
      cancellations: {
        last7: 0,
        providerCaused: 0,
        withoutWelfareCheck: 0,
        timeCriticalNotEscalated: 0,
        byReason: {} as Record<string, number>,
      },
      continuity: {
        windowDays: 28,
        serviceUsers: 0,
        averageCarers: null as number | null,
        manyCarersThreshold: MANY_CARERS_THRESHOLD,
        serviceUsersWithManyCarers: 0,
      },
    };

    const scope = this.jobScope(user, q.locationId);
    if (!scope) return { data: result };

    const jobFrom = Prisma.sql`
      FROM scheduling."ScheduledJob" j
      JOIN service_users."ServiceUser" su ON su.id = j."serviceUserId"
      LEFT JOIN scheduling."ScheduleArea" sa ON sa.id = j."scheduleAreaId"`;
    const activeAlloc = Prisma.sql`
      SELECT count(*) FROM scheduling."JobAllocation" a
       WHERE a."scheduledJobId" = j.id AND a."deletedAt" IS NULL AND a."isActive"
         AND a."unallocatedAt" IS NULL AND a.status::text = ANY(${ACTIVE_ALLOCATION})`;

    const [alertRows, alertTotals, coverRows, cancelRows, cancelTotals, continuityRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ kind: string; n: bigint }>>`
        SELECT e.kind::text AS kind, count(*) AS n
          FROM scheduling."EcmException" e
          JOIN scheduling."ScheduledJob" j ON j.id = e."scheduledJobId" AND j."deletedAt" IS NULL
          JOIN service_users."ServiceUser" su ON su.id = j."serviceUserId"
          LEFT JOIN scheduling."ScheduleArea" sa ON sa.id = j."scheduleAreaId"
         WHERE e.lifecycle::text = ANY(${OPEN_ALERT_LIFECYCLES}) AND ${scope}
         GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ open: bigint; unack: bigint; past: bigint; oldest: Date | null }>>`
        SELECT count(*) AS open,
               count(*) FILTER (WHERE e."acknowledgedAt" IS NULL) AS unack,
               count(*) FILTER (WHERE e."acknowledgedAt" IS NULL AND (e.overdue OR e."escalationDeadlineAt" < ${now})) AS past,
               min(e."createdAt") AS oldest
          FROM scheduling."EcmException" e
          JOIN scheduling."ScheduledJob" j ON j.id = e."scheduledJobId" AND j."deletedAt" IS NULL
          JOIN service_users."ServiceUser" su ON su.id = j."serviceUserId"
          LEFT JOIN scheduling."ScheduleArea" sa ON sa.id = j."scheduleAreaId"
         WHERE e.lifecycle::text = ANY(${OPEN_ALERT_LIFECYCLES}) AND ${scope}`,
      this.prisma.$queryRaw<
        Array<{
          visits_today: bigint;
          unfilled_today: bigint;
          visits_7: bigint;
          unfilled_7: bigint;
          unfilled_28: bigint;
          next_unfilled: Date | null;
          planned_minutes_7: number | null;
          needs_attention: bigint;
        }>
      >`
        WITH jobs AS (
          SELECT j."scheduledStartDateTime" AS st,
                 j."scheduledEndDateTime" AS en,
                 j.status::text AS status,
                 j."requiredCarers" AS req,
                 (${activeAlloc}) AS alloc
          ${jobFrom}
          WHERE j."deletedAt" IS NULL AND j."isActive" AND ${scope}
            AND j."scheduledStartDateTime" >= ${todayStart} AND j."scheduledStartDateTime" < ${in28}
            AND j.status::text <> 'DRAFT'
        )
        SELECT
          count(*) FILTER (WHERE st < ${tomorrowStart} AND status <> ALL(${CANCELLED_JOB})) AS visits_today,
          count(*) FILTER (WHERE st < ${tomorrowStart} AND status <> ALL(${CLOSED_JOB}) AND alloc < req) AS unfilled_today,
          count(*) FILTER (WHERE st < ${in7} AND status <> ALL(${CANCELLED_JOB})) AS visits_7,
          count(*) FILTER (WHERE st < ${in7} AND status <> ALL(${CLOSED_JOB}) AND alloc < req) AS unfilled_7,
          count(*) FILTER (WHERE status <> ALL(${CLOSED_JOB}) AND alloc < req) AS unfilled_28,
          min(st) FILTER (WHERE status <> ALL(${CLOSED_JOB}) AND alloc < req AND st >= ${now}) AS next_unfilled,
          sum(EXTRACT(EPOCH FROM (en - st)) / 60) FILTER (WHERE st < ${in7} AND en IS NOT NULL AND status <> ALL(${CANCELLED_JOB})) AS planned_minutes_7,
          count(*) FILTER (WHERE status = 'NEEDS_ATTENTION') AS needs_attention
        FROM jobs`,
      this.prisma.$queryRaw<Array<{ reason: string; n: bigint }>>`
        SELECT c."reasonCode"::text AS reason, count(*) AS n
          FROM scheduling."ScheduledJobCancellation" c
          JOIN scheduling."ScheduledJob" j ON j.id = c."scheduledJobId"
          JOIN service_users."ServiceUser" su ON su.id = j."serviceUserId"
          LEFT JOIN scheduling."ScheduleArea" sa ON sa.id = j."scheduleAreaId"
         WHERE c."reinstatedAt" IS NULL AND ${scope}
           AND j."scheduledStartDateTime" >= ${last7Start} AND j."scheduledStartDateTime" < ${tomorrowStart}
         GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ no_welfare: bigint; tc_not_escalated: bigint }>>`
        SELECT count(*) FILTER (WHERE NOT c."welfareChecked") AS no_welfare,
               count(*) FILTER (WHERE c."timeCriticalVisit" AND NOT c."timeCriticalEscalated") AS tc_not_escalated
          FROM scheduling."ScheduledJobCancellation" c
          JOIN scheduling."ScheduledJob" j ON j.id = c."scheduledJobId"
          JOIN service_users."ServiceUser" su ON su.id = j."serviceUserId"
          LEFT JOIN scheduling."ScheduleArea" sa ON sa.id = j."scheduleAreaId"
         WHERE c."reinstatedAt" IS NULL AND ${scope}
           AND j."scheduledStartDateTime" >= ${last7Start} AND j."scheduledStartDateTime" < ${tomorrowStart}`,
      this.prisma.$queryRaw<Array<{ service_users: bigint; avg_carers: number | null; many: bigint }>>`
        WITH seen AS (
          SELECT j."serviceUserId" AS su_id, count(DISTINCT a."employeeId") AS carers
          ${jobFrom}
          JOIN scheduling."JobAllocation" a ON a."scheduledJobId" = j.id
           AND a."deletedAt" IS NULL AND a."isActive" AND a."unallocatedAt" IS NULL
           AND a.status::text = ANY(${ACTIVE_ALLOCATION})
          WHERE j."deletedAt" IS NULL AND j."isActive" AND ${scope}
            AND j.status::text <> ALL(${CANCELLED_JOB}) AND j.status::text <> 'DRAFT'
            AND j."scheduledStartDateTime" >= ${last28Start} AND j."scheduledStartDateTime" < ${tomorrowStart}
          GROUP BY 1
        )
        SELECT count(*) AS service_users,
               avg(carers)::float AS avg_carers,
               count(*) FILTER (WHERE carers > ${MANY_CARERS_THRESHOLD}) AS many
          FROM seen`,
    ]);

    /* Alerts */
    for (const r of alertRows) result.alerts.byKind[r.kind] = num(r.n);
    const at = alertTotals[0];
    result.alerts.open = num(at?.open);
    result.alerts.unacknowledged = num(at?.unack);
    result.alerts.pastResponseTarget = num(at?.past);
    result.alerts.oldestOpenAt = at?.oldest ? at.oldest.toISOString() : null;

    /* Cover */
    const c = coverRows[0];
    result.cover.visitsToday = num(c?.visits_today);
    result.cover.unfilledToday = num(c?.unfilled_today);
    result.cover.visitsNext7 = num(c?.visits_7);
    result.cover.unfilledNext7 = num(c?.unfilled_7);
    result.cover.unfilledNext28 = num(c?.unfilled_28);
    result.cover.nextUnfilledAt = c?.next_unfilled ? c.next_unfilled.toISOString() : null;
    result.cover.plannedHoursNext7 = Math.round(num(c?.planned_minutes_7) / 6) / 10;
    result.cover.needsAttention = num(c?.needs_attention);

    /* Cancellations (last 7 days, by visit date; reinstated visits excluded) */
    for (const r of cancelRows) {
      const n = num(r.n);
      result.cancellations.byReason[r.reason] = n;
      result.cancellations.last7 += n;
      if (PROVIDER_REASONS.includes(r.reason)) result.cancellations.providerCaused += n;
    }
    result.cancellations.withoutWelfareCheck = num(cancelTotals[0]?.no_welfare);
    result.cancellations.timeCriticalNotEscalated = num(cancelTotals[0]?.tc_not_escalated);

    /* Continuity (last 28 days) */
    const k = continuityRows[0];
    result.continuity.serviceUsers = num(k?.service_users);
    result.continuity.averageCarers = k?.avg_carers === null || k?.avg_carers === undefined ? null : Math.round(Number(k.avg_carers) * 10) / 10;
    result.continuity.serviceUsersWithManyCarers = num(k?.many);

    return { data: result };
  }
}
