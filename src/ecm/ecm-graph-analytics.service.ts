import { Injectable } from '@nestjs/common';
import {
  EcmArrivalClassification,
  EcmAttendanceConfidence,
  EcmDurationClassification,
  EcmLifecycleStatus,
  EcmMissedClassification,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { operationalTodayIso } from '../common/utils/operational-day.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import { resolveGraphBranch } from './ecm-graph-branch.util';
import { ECM_REASON_CODES } from './ecm-reason-codes';

export type EcmGraphDashboardQuery = {
  dateFrom?: string;
  dateTo?: string;
  scheduleAreaId?: string;
  locationId?: string;
};

type DrillVisit = {
  scheduledJobId: string;
  jobName: string;
  serviceUserName: string;
  plannedStartDateTime: string;
  /** Operational calendar day YYYY-MM-DD (organisation timezone). */
  localVisitDate: string;
  hourKey: string;
  statusKey: string;
  arrivalBand: string;
  durationBand: string;
  branchName: string | null;
  /** Distinct reason codes for this visit (exceptions ∪ operationalExceptionCodes). */
  reasonCodes: string[];
  /** Weekday label Mon–Sun from localVisitDate. */
  weekday: string;
  /** Heatmap time-band key (e.g. 06-09, overnight). */
  timeBandKey: string;
  /** True when confidence is VERIFIED or PARTIALLY_VERIFIED. */
  verified: boolean;
};

const HOUR_KEYS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

/**
 * Band / on-time SSOT for graph-dashboard: persisted evaluation classifications
 * (EcmArrivalClassification / EcmDurationClassification), not raw minute buckets.
 * Branch onTimePct and Compliance Overview bands use the same enums so % and
 * charts reconcile. Null / NOT_ASSESSED → `not_assessed` (never counted as within).
 */
const ARRIVAL_BANDS = [
  'early',
  'on_time',
  'late',
  'very_late',
  'not_assessed',
] as const;

const DURATION_BANDS = [
  'short',
  'on_time',
  'long',
  'excessive',
  'not_assessed',
] as const;

const GRAPH_ROW_CAP = 5000;

const TIME_BANDS = [
  { key: '06-09', label: '06:00–09:00', start: 6, end: 9 },
  { key: '09-12', label: '09:00–12:00', start: 9, end: 12 },
  { key: '12-15', label: '12:00–15:00', start: 12, end: 15 },
  { key: '15-18', label: '15:00–18:00', start: 15, end: 18 },
  { key: '18-22', label: '18:00–22:00', start: 18, end: 22 },
  { key: 'overnight', label: 'Overnight', start: 22, end: 6 },
] as const;

const REASON_LABEL_BY_CODE = new Map(
  ECM_REASON_CODES.map((r) => [r.code.toUpperCase(), r.label]),
);

/** Operational / exception-kind codes that appear beside structured reason codes. */
const OPS_REASON_LABELS: Record<string, string> = {
  MANUAL_ATTENDANCE: 'Admin completed visit',
  OUTSIDE_GEOFENCE: 'Outside geofence',
  MOCK_LOCATION: 'Mock location',
  LOW_GPS_ACCURACY: 'Low GPS accuracy',
  NO_ACCESS: 'No access',
  LATE_ARRIVAL: 'Late arrival',
  VERY_LATE_ARRIVAL: 'Very late arrival',
  SHORT_VISIT: 'Short visit',
  LONG_VISIT: 'Long visit',
  EXCESSIVE_OVERRUN: 'Excessive overrun',
  POTENTIAL_MISSED: 'Potentially missed',
  CONFIRMED_MISSED: 'Confirmed missed',
  MISSING_CHECKOUT: 'Missing checkout',
  UNSPECIFIED: 'Unspecified',
};

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatScheduleDate(d);
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
    if (out.length > 366) break;
  }
  return out;
}

/** Planned-start hour in organisation operational TZ, not raw UTC. */
function hourKeyInOperationalTz(d: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    return hour.padStart(2, '0');
  } catch {
    return String(d.getUTCHours()).padStart(2, '0');
  }
}

function weekdayIndexUtc(isoDate: string): number {
  // 0=Mon … 6=Sun — localVisitDate is UTC midnight of the London calendar day.
  const d = parseIsoDate(isoDate);
  const js = d.getUTCDay(); // 0=Sun
  return js === 0 ? 6 : js - 1;
}

function arrivalBandFromClassification(
  classification: EcmArrivalClassification,
): (typeof ARRIVAL_BANDS)[number] {
  switch (classification) {
    case EcmArrivalClassification.EARLY_ARRIVAL:
      return 'early';
    case EcmArrivalClassification.ON_TIME:
      return 'on_time';
    case EcmArrivalClassification.LATE_ARRIVAL:
      return 'late';
    case EcmArrivalClassification.VERY_LATE_ARRIVAL:
      return 'very_late';
    case EcmArrivalClassification.NOT_ASSESSED:
    default:
      return 'not_assessed';
  }
}

function durationBandFromClassification(
  classification: EcmDurationClassification,
): (typeof DURATION_BANDS)[number] {
  switch (classification) {
    case EcmDurationClassification.SHORT_VISIT:
      return 'short';
    case EcmDurationClassification.ON_TIME:
      return 'on_time';
    case EcmDurationClassification.LONG_VISIT:
      return 'long';
    case EcmDurationClassification.EXCESSIVE_OVERRUN:
      return 'excessive';
    case EcmDurationClassification.NOT_ASSESSED:
    default:
      return 'not_assessed';
  }
}

/** One count per distinct code per visit (no double-count across exception rows + op codes). */
function distinctReasonCodes(
  exceptions: Array<{ reasonCode: string | null; kind: string }>,
  operationalExceptionCodes: string[],
): string[] {
  const codes = new Set<string>();
  for (const ex of exceptions) {
    codes.add((ex.reasonCode || ex.kind || 'UNSPECIFIED').toUpperCase());
  }
  for (const code of operationalExceptionCodes) {
    if (code) codes.add(code.toUpperCase());
  }
  return [...codes];
}

function humanReasonLabel(code: string): string {
  const upper = code.toUpperCase();
  return (
    REASON_LABEL_BY_CODE.get(upper) ??
    OPS_REASON_LABELS[upper] ??
    upper
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function statusKey(row: {
  lifecycleStatus: EcmLifecycleStatus;
  arrivalClassification: EcmArrivalClassification;
  missedClassification: EcmMissedClassification;
}): string {
  if (
    row.missedClassification === EcmMissedClassification.POTENTIAL_MISSED ||
    row.missedClassification === EcmMissedClassification.ATTENDANCE_VERIFICATION_PENDING
  ) {
    return 'potentialMissed';
  }
  if (row.missedClassification === EcmMissedClassification.CONFIRMED_MISSED) {
    return 'missed';
  }
  if (
    row.lifecycleStatus === EcmLifecycleStatus.UNASSIGNED ||
    row.lifecycleStatus === EcmLifecycleStatus.DRAFT
  ) {
    return 'unassigned';
  }
  if (
    row.lifecycleStatus === EcmLifecycleStatus.IN_PROGRESS ||
    row.lifecycleStatus === EcmLifecycleStatus.CHECKED_IN
  ) {
    return 'inProgress';
  }
  if (
    row.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL ||
    row.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL
  ) {
    return 'late';
  }
  if (
    row.lifecycleStatus === EcmLifecycleStatus.COMPLETED ||
    row.lifecycleStatus === EcmLifecycleStatus.COMPLETED_WITH_EXCEPTION ||
    row.lifecycleStatus === EcmLifecycleStatus.CHECKED_OUT ||
    row.lifecycleStatus === EcmLifecycleStatus.CLOSED
  ) {
    return 'completedOnTime';
  }
  return 'other';
}

/**
 * Heatmap / ops-pattern exception: aligns with primary trend series
 * (late+very late, short, missed) — excludes long/excessive-only and bare op codes.
 */
function isTrendAlignedException(row: {
  arrivalClassification: EcmArrivalClassification;
  durationClassification: EcmDurationClassification;
  missedClassification: EcmMissedClassification;
}): boolean {
  if (
    row.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL ||
    row.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL
  ) {
    return true;
  }
  if (row.durationClassification === EcmDurationClassification.SHORT_VISIT) {
    return true;
  }
  if (
    row.missedClassification === EcmMissedClassification.POTENTIAL_MISSED ||
    row.missedClassification === EcmMissedClassification.CONFIRMED_MISSED
  ) {
    return true;
  }
  return false;
}

function timeBandKey(hour: number): string {
  for (const b of TIME_BANDS) {
    if (b.key === 'overnight') {
      if (hour >= 22 || hour < 6) return b.key;
    } else if (hour >= b.start && hour < b.end) {
      return b.key;
    }
  }
  return 'overnight';
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

@Injectable()
export class EcmGraphAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async graphDashboard(query: EcmGraphDashboardQuery, actor?: RequestUser) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const dateTo = query.dateTo ?? operationalTodayIso(new Date(), timeZone);
    const dateFrom = query.dateFrom ?? addDaysIso(dateTo, -6);
    const dates = eachDateInclusive(dateFrom, dateTo);
    const fromDate = parseIsoDate(dateFrom);
    const toDate = parseIsoDate(dateTo);

    const jobFilter = await this.orgScope.resolveScheduledJobListFilter(actor, query);
    const jobWhere =
      'empty' in jobFilter ? { id: { in: [] as string[] } } : jobFilter.where;

    const where: Prisma.EcmVisitEvaluationWhereInput = {
      localVisitDate: { gte: fromDate, lte: toDate },
      scheduledJob: jobWhere,
    };

    const totalMatching = await this.prisma.ecmVisitEvaluation.count({ where });
    const truncated = totalMatching > GRAPH_ROW_CAP;

    const rows = await this.prisma.ecmVisitEvaluation.findMany({
      where,
      take: GRAPH_ROW_CAP,
      orderBy: { plannedStartDateTime: 'asc' },
      select: {
        scheduledJobId: true,
        plannedStartDateTime: true,
        localVisitDate: true,
        actualCheckInAt: true,
        actualCheckOutAt: true,
        arrivalClassification: true,
        durationClassification: true,
        lifecycleStatus: true,
        missedClassification: true,
        confidence: true,
        operationalExceptionCodes: true,
        scheduledJob: {
          select: {
            jobName: true,
            scheduleArea: { select: { id: true, name: true } },
            serviceUser: {
              select: {
                firstName: true,
                lastName: true,
                preferredName: true,
                locationId: true,
                location: { select: { id: true, name: true } },
              },
            },
          },
        },
        // Analytics path: do not truncate exception rows (reason ranking).
        exceptions: {
          select: { reasonCode: true, kind: true },
        },
      },
    });

    const locationIds = [
      ...new Set(
        rows
          .map((r) => r.scheduledJob.serviceUser.locationId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const areasForLocations =
      locationIds.length > 0
        ? await this.prisma.scheduleArea.findMany({
            where: {
              deletedAt: null,
              isActive: true,
              locationId: { in: locationIds },
            },
            select: { id: true, name: true, locationId: true, sortOrder: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          })
        : [];
    const areaByLocationId = new Map<string, { id: string; name: string }>();
    for (const area of areasForLocations) {
      if (!area.locationId || areaByLocationId.has(area.locationId)) continue;
      areaByLocationId.set(area.locationId, { id: area.id, name: area.name });
    }

    const statusSeriesKeys = [
      'completedOnTime',
      'inProgress',
      'late',
      'potentialMissed',
      'missed',
      'unassigned',
      'other',
    ] as const;

    const visitStatusByHour: Record<(typeof statusSeriesKeys)[number], number[]> = {
      completedOnTime: HOUR_KEYS.map(() => 0),
      inProgress: HOUR_KEYS.map(() => 0),
      late: HOUR_KEYS.map(() => 0),
      potentialMissed: HOUR_KEYS.map(() => 0),
      missed: HOUR_KEYS.map(() => 0),
      unassigned: HOUR_KEYS.map(() => 0),
      other: HOUR_KEYS.map(() => 0),
    };

    type DayTrend = {
      visits: number;
      assessedArrival: number;
      assessedDuration: number;
      late: number;
      short: number;
      missed: number;
    };
    const trend = Object.fromEntries(
      dates.map((d) => [
        d,
        {
          visits: 0,
          assessedArrival: 0,
          assessedDuration: 0,
          late: 0,
          short: 0,
          missed: 0,
        },
      ]),
    ) as Record<string, DayTrend>;

    const arrivalCounts = Object.fromEntries(ARRIVAL_BANDS.map((b) => [b, 0])) as Record<
      string,
      number
    >;
    const durationCounts = Object.fromEntries(DURATION_BANDS.map((b) => [b, 0])) as Record<
      string,
      number
    >;

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const heatmapTotals: Record<string, Record<string, { total: number; exceptions: number }>> = {};
    for (const band of TIME_BANDS) {
      heatmapTotals[band.key] = {};
      for (const day of weekdays) {
        heatmapTotals[band.key][day] = { total: 0, exceptions: 0 };
      }
    }

    type BranchAgg = {
      name: string;
      total: number;
      assessedArrival: number;
      assessedDuration: number;
      onTime: number;
      late: number;
      missed: number;
      short: number;
      verified: number;
    };
    const branchMap = new Map<string, BranchAgg>();

    const reasonCounts = new Map<string, number>();
    const drillVisits: DrillVisit[] = [];

    for (const row of rows) {
      const localIso = formatScheduleDate(row.localVisitDate);
      const hour = hourKeyInOperationalTz(row.plannedStartDateTime, timeZone);
      const hourIdx = Number(hour);
      const sk = statusKey(row);
      if (hourIdx >= 0 && hourIdx < 24 && sk in visitStatusByHour) {
        visitStatusByHour[sk as keyof typeof visitStatusByHour][hourIdx] += 1;
      }

      const aBand = arrivalBandFromClassification(row.arrivalClassification);
      const dBand = durationBandFromClassification(row.durationClassification);
      const isLate =
        row.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL ||
        row.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL;
      const isShort = row.durationClassification === EcmDurationClassification.SHORT_VISIT;
      const isMissed =
        row.missedClassification === EcmMissedClassification.POTENTIAL_MISSED ||
        row.missedClassification === EcmMissedClassification.CONFIRMED_MISSED;
      const isVerified =
        row.confidence === EcmAttendanceConfidence.VERIFIED ||
        row.confidence === EcmAttendanceConfidence.PARTIALLY_VERIFIED;

      const dayTrend = trend[localIso];
      if (dayTrend) {
        dayTrend.visits += 1;
        if (aBand !== 'not_assessed') dayTrend.assessedArrival += 1;
        if (dBand !== 'not_assessed') dayTrend.assessedDuration += 1;
        if (isLate) dayTrend.late += 1;
        if (isShort) dayTrend.short += 1;
        if (isMissed) dayTrend.missed += 1;
      }

      arrivalCounts[aBand] = (arrivalCounts[aBand] ?? 0) + 1;
      durationCounts[dBand] = (durationCounts[dBand] ?? 0) + 1;

      const wd = weekdays[weekdayIndexUtc(localIso)] ?? 'Mon';
      const tb = timeBandKey(hourIdx);
      const cell = heatmapTotals[tb]?.[wd];
      if (cell) {
        cell.total += 1;
        if (isTrendAlignedException(row)) cell.exceptions += 1;
      }

      const resolvedBranch = resolveGraphBranch({
        scheduleArea: row.scheduledJob.scheduleArea,
        serviceUserLocation: row.scheduledJob.serviceUser.location,
        areaByLocationId,
      });
      const branchName = resolvedBranch.name;
      const branchId = resolvedBranch.id;
      let branch = branchMap.get(branchId);
      if (!branch) {
        branch = {
          name: branchName,
          total: 0,
          assessedArrival: 0,
          assessedDuration: 0,
          onTime: 0,
          late: 0,
          missed: 0,
          short: 0,
          verified: 0,
        };
        branchMap.set(branchId, branch);
      }
      branch.total += 1;
      if (aBand !== 'not_assessed') branch.assessedArrival += 1;
      if (dBand !== 'not_assessed') branch.assessedDuration += 1;
      if (row.arrivalClassification === EcmArrivalClassification.ON_TIME) branch.onTime += 1;
      if (isLate) branch.late += 1;
      if (isMissed) branch.missed += 1;
      if (isShort) branch.short += 1;
      if (isVerified) branch.verified += 1;

      const reasonCodes = distinctReasonCodes(row.exceptions, row.operationalExceptionCodes);
      for (const code of reasonCodes) {
        reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
      }

      const su =
        row.scheduledJob.serviceUser.preferredName?.trim() ||
        [row.scheduledJob.serviceUser.firstName, row.scheduledJob.serviceUser.lastName]
          .filter(Boolean)
          .join(' ');

      drillVisits.push({
        scheduledJobId: row.scheduledJobId,
        jobName: row.scheduledJob.jobName,
        serviceUserName: su,
        plannedStartDateTime: row.plannedStartDateTime.toISOString(),
        localVisitDate: localIso,
        hourKey: hour,
        statusKey: sk,
        arrivalBand: aBand,
        durationBand: dBand,
        branchName,
        reasonCodes,
        weekday: wd,
        timeBandKey: tb,
        verified: isVerified,
      });
    }

    const heatmap = TIME_BANDS.map((band) => ({
      bandKey: band.key,
      bandLabel: band.label,
      rates: weekdays.map((day) => {
        const cell = heatmapTotals[band.key][day];
        if (!cell.total) return { day, total: 0, exceptions: 0, rate: null as number | null };
        const rate = Math.round((cell.exceptions / cell.total) * 1000) / 10;
        return { day, total: cell.total, exceptions: cell.exceptions, rate };
      }),
    }));

    const branchComparison = [...branchMap.values()]
      .map((b) => ({
        name: b.name,
        total: b.total,
        assessedArrival: b.assessedArrival,
        assessedDuration: b.assessedDuration,
        onTimePct: pct(b.onTime, b.assessedArrival),
        latePct: pct(b.late, b.assessedArrival),
        missedPct: pct(b.missed, b.total),
        shortPct: pct(b.short, b.assessedDuration),
        verifiedPct: pct(b.verified, b.total),
      }))
      .sort((a, b) => b.latePct - a.latePct);

    const exceptionReasons = [...reasonCounts.entries()]
      .map(([code, count]) => ({ code, label: humanReasonLabel(code), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return {
      data: {
        dateFrom,
        dateTo,
        refreshedAt: new Date().toISOString(),
        visitCount: rows.length,
        totalMatching,
        truncated,
        rowCap: GRAPH_ROW_CAP,
        visitStatusByHour: {
          hours: HOUR_KEYS.map((h) => `${h}:00`),
          series: statusSeriesKeys.map((key) => ({
            key,
            label: key,
            data: visitStatusByHour[key],
          })),
        },
        exceptionTrend: {
          dates,
          series: {
            latePct: dates.map((d) => pct(trend[d].late, trend[d].assessedArrival)),
            shortPct: dates.map((d) => pct(trend[d].short, trend[d].assessedDuration)),
            missedPct: dates.map((d) => pct(trend[d].missed, trend[d].visits)),
          },
          counts: {
            late: dates.map((d) => trend[d].late),
            short: dates.map((d) => trend[d].short),
            missed: dates.map((d) => trend[d].missed),
          },
          denominators: {
            assessedArrival: dates.map((d) => trend[d].assessedArrival),
            assessedDuration: dates.map((d) => trend[d].assessedDuration),
            visits: dates.map((d) => trend[d].visits),
          },
        },
        arrivalPunctuality: ARRIVAL_BANDS.map((key) => ({
          key,
          count: arrivalCounts[key] ?? 0,
        })),
        durationVariance: DURATION_BANDS.map((key) => ({
          key,
          count: durationCounts[key] ?? 0,
        })),
        heatmap: {
          weekdays,
          bands: heatmap,
        },
        branchComparison,
        exceptionReasons,
        drillVisits,
      },
    };
  }
}
