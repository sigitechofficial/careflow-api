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
import { operationalTodayIso } from '../common/utils/operational-day.util';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import { scheduledJobLocationScope } from './ecm-location-scope.util';

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
  hourKey: string;
  statusKey: string;
  arrivalBand: string;
  durationBand: string;
  branchName: string | null;
  /** Distinct reason codes for this visit (exceptions ∪ operationalExceptionCodes). */
  reasonCodes: string[];
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

function hourKeyFromDate(d: Date): string {
  return String(d.getUTCHours()).padStart(2, '0');
}

function weekdayIndexUtc(isoDate: string): number {
  // 0=Mon … 6=Sun
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

function isExceptionVisit(row: {
  arrivalClassification: EcmArrivalClassification;
  durationClassification: EcmDurationClassification;
  missedClassification: EcmMissedClassification;
  operationalExceptionCodes: string[];
}): boolean {
  if (
    row.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL ||
    row.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL
  ) {
    return true;
  }
  if (
    row.durationClassification === EcmDurationClassification.SHORT_VISIT ||
    row.durationClassification === EcmDurationClassification.LONG_VISIT ||
    row.durationClassification === EcmDurationClassification.EXCESSIVE_OVERRUN
  ) {
    return true;
  }
  if (
    row.missedClassification !== EcmMissedClassification.NONE &&
    row.missedClassification !== EcmMissedClassification.FALSE_ECM_ALERT
  ) {
    return true;
  }
  return row.operationalExceptionCodes.length > 0;
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

@Injectable()
export class EcmGraphAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async graphDashboard(query: EcmGraphDashboardQuery) {
    const dateTo = query.dateTo ?? operationalTodayIso();
    const dateFrom = query.dateFrom ?? addDaysIso(dateTo, -6);
    const dates = eachDateInclusive(dateFrom, dateTo);
    const fromDate = parseIsoDate(dateFrom);
    const toDate = parseIsoDate(dateTo);

    const where: Prisma.EcmVisitEvaluationWhereInput = {
      localVisitDate: { gte: fromDate, lte: toDate },
      scheduledJob: {
        deletedAt: null,
        isActive: true,
        ...(query.scheduleAreaId ? { scheduleAreaId: query.scheduleAreaId } : {}),
        ...(query.locationId ? scheduledJobLocationScope(query.locationId) : {}),
      },
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
              select: { firstName: true, lastName: true, preferredName: true },
            },
          },
        },
        exceptions: {
          select: { reasonCode: true, kind: true },
          take: 5,
        },
      },
    });

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

    const trend = Object.fromEntries(
      dates.map((d) => [
        d,
        { late: 0, veryLate: 0, short: 0, missed: 0, missingCheckout: 0, noAccess: 0, manual: 0 },
      ]),
    ) as Record<
      string,
      {
        late: number;
        veryLate: number;
        short: number;
        missed: number;
        missingCheckout: number;
        noAccess: number;
        manual: number;
      }
    >;

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
      onTime: number;
      late: number;
      missed: number;
      short: number;
      verified: number;
    };
    const branchMap = new Map<string, BranchAgg>();

    const reasonCounts = new Map<string, number>();
    const verificationCounts = new Map<string, number>();
    const drillVisits: DrillVisit[] = [];

    for (const row of rows) {
      const localIso = formatScheduleDate(row.localVisitDate);
      const hour = hourKeyFromDate(row.plannedStartDateTime);
      const hourIdx = Number(hour);
      const sk = statusKey(row);
      if (hourIdx >= 0 && hourIdx < 24 && sk in visitStatusByHour) {
        visitStatusByHour[sk as keyof typeof visitStatusByHour][hourIdx] += 1;
      }

      const dayTrend = trend[localIso];
      if (dayTrend) {
        if (row.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL) dayTrend.late += 1;
        if (row.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL) {
          dayTrend.veryLate += 1;
        }
        if (row.durationClassification === EcmDurationClassification.SHORT_VISIT) {
          dayTrend.short += 1;
        }
        if (
          row.missedClassification === EcmMissedClassification.POTENTIAL_MISSED ||
          row.missedClassification === EcmMissedClassification.CONFIRMED_MISSED
        ) {
          dayTrend.missed += 1;
        }
        if (row.actualCheckInAt && !row.actualCheckOutAt) dayTrend.missingCheckout += 1;
        if (row.operationalExceptionCodes.includes('NO_ACCESS')) dayTrend.noAccess += 1;
        if (row.operationalExceptionCodes.includes('MANUAL_ATTENDANCE')) dayTrend.manual += 1;
      }

      const aBand = arrivalBandFromClassification(row.arrivalClassification);
      arrivalCounts[aBand] = (arrivalCounts[aBand] ?? 0) + 1;
      const dBand = durationBandFromClassification(row.durationClassification);
      durationCounts[dBand] = (durationCounts[dBand] ?? 0) + 1;

      const wd = weekdays[weekdayIndexUtc(localIso)] ?? 'Mon';
      const tb = timeBandKey(hourIdx);
      const cell = heatmapTotals[tb]?.[wd];
      if (cell) {
        cell.total += 1;
        if (isExceptionVisit(row)) cell.exceptions += 1;
      }

      const branchName = row.scheduledJob.scheduleArea?.name ?? 'Unassigned area';
      const branchId = row.scheduledJob.scheduleArea?.id ?? 'none';
      let branch = branchMap.get(branchId);
      if (!branch) {
        branch = {
          name: branchName,
          total: 0,
          onTime: 0,
          late: 0,
          missed: 0,
          short: 0,
          verified: 0,
        };
        branchMap.set(branchId, branch);
      }
      branch.total += 1;
      // Same SSOT as arrival chart `on_time` band (arrivalClassification.ON_TIME).
      if (row.arrivalClassification === EcmArrivalClassification.ON_TIME) branch.onTime += 1;
      if (
        row.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL ||
        row.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL
      ) {
        branch.late += 1;
      }
      if (
        row.missedClassification === EcmMissedClassification.POTENTIAL_MISSED ||
        row.missedClassification === EcmMissedClassification.CONFIRMED_MISSED
      ) {
        branch.missed += 1;
      }
      if (row.durationClassification === EcmDurationClassification.SHORT_VISIT) branch.short += 1;
      if (
        row.confidence === EcmAttendanceConfidence.VERIFIED ||
        row.confidence === EcmAttendanceConfidence.PARTIALLY_VERIFIED
      ) {
        branch.verified += 1;
      }

      const reasonCodes = distinctReasonCodes(row.exceptions, row.operationalExceptionCodes);
      for (const code of reasonCodes) {
        reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
      }

      const conf = String(row.confidence);
      verificationCounts.set(conf, (verificationCounts.get(conf) ?? 0) + 1);

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
        hourKey: hour,
        statusKey: sk,
        arrivalBand: aBand,
        durationBand: dBand,
        branchName,
        reasonCodes,
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
        onTimePct: b.total ? Math.round((b.onTime / b.total) * 1000) / 10 : 0,
        latePct: b.total ? Math.round((b.late / b.total) * 1000) / 10 : 0,
        missedPct: b.total ? Math.round((b.missed / b.total) * 1000) / 10 : 0,
        shortPct: b.total ? Math.round((b.short / b.total) * 1000) / 10 : 0,
        verifiedPct: b.total ? Math.round((b.verified / b.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.onTimePct - a.onTimePct);

    const exceptionReasons = [...reasonCounts.entries()]
      .map(([code, count]) => ({ code, label: code.replace(/_/g, ' '), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const verificationMethod = [...verificationCounts.entries()]
      .map(([code, value]) => ({
        code,
        label: code.replace(/_/g, ' '),
        value,
      }))
      .sort((a, b) => b.value - a.value);

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
            late: dates.map((d) => trend[d].late),
            veryLate: dates.map((d) => trend[d].veryLate),
            short: dates.map((d) => trend[d].short),
            missed: dates.map((d) => trend[d].missed),
            missingCheckout: dates.map((d) => trend[d].missingCheckout),
            noAccess: dates.map((d) => trend[d].noAccess),
          },
        },
        manualTrend: {
          dates,
          manual: dates.map((d) => trend[d].manual),
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
        verificationMethod,
        drillVisits,
      },
    };
  }
}
