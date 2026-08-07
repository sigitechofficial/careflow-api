import { Injectable } from '@nestjs/common';
import {
  EcmArrivalClassification,
  EcmAttendanceConfidence,
  EcmDurationClassification,
  EcmMissedClassification,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import { scheduledJobLocationScope } from './ecm-location-scope.util';

export type EcmReportsQuery = {
  dateFrom?: string;
  dateTo?: string;
  scheduleAreaId?: string;
  locationId?: string;
  serviceUserId?: string;
  criticality?: string;
};

type EvaluationRow = {
  id: string;
  scheduledJobId: string;
  lifecycleStatus: string;
  arrivalClassification: EcmArrivalClassification;
  durationClassification: EcmDurationClassification;
  missedClassification: EcmMissedClassification;
  confidence: EcmAttendanceConfidence;
  criticality: string;
  startVarianceMinutes: number | null;
  durationVarianceMinutes: number | null;
  operationalExceptionCodes: string[];
  thresholdRuleVersion: string | null;
  plannedStartDateTime: Date;
  plannedEndDateTime: Date | null;
  localVisitDate: Date;
  scheduledJob: {
    jobName: string;
    serviceUser: {
      firstName: string | null;
      lastName: string | null;
      preferredName: string | null;
    };
    allocations: Array<{
      isLeadCarer: boolean;
      employee: {
        id: string;
        personalDetail: { firstName: string | null; lastName: string | null } | null;
      };
    }>;
  };
};

function serviceUserDisplayName(su: EvaluationRow['scheduledJob']['serviceUser']): string {
  return (
    su.preferredName?.trim() ||
    [su.firstName, su.lastName].filter(Boolean).join(' ') ||
    '—'
  );
}

function carerDisplayName(
  allocation: EvaluationRow['scheduledJob']['allocations'][number],
): string {
  const name = [
    allocation.employee.personalDetail?.firstName,
    allocation.employee.personalDetail?.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || allocation.employee.id;
}

/** Audit-facing reason codes from classifications + operational exceptions. */
function buildExceptionReasons(row: EvaluationRow): string[] {
  const reasons = new Set<string>();
  const arrival = row.arrivalClassification;
  const duration = row.durationClassification;
  const missed = row.missedClassification;

  if (arrival === EcmArrivalClassification.EARLY_ARRIVAL) reasons.add('EARLY_ARRIVAL');
  if (arrival === EcmArrivalClassification.LATE_ARRIVAL) reasons.add('LATE_ARRIVAL');
  if (arrival === EcmArrivalClassification.VERY_LATE_ARRIVAL) reasons.add('VERY_LATE_ARRIVAL');
  if (duration === EcmDurationClassification.SHORT_VISIT) reasons.add('SHORT_VISIT');
  if (duration === EcmDurationClassification.LONG_VISIT) reasons.add('LONG_VISIT');
  if (duration === EcmDurationClassification.EXCESSIVE_OVERRUN) {
    reasons.add('EXCESSIVE_OVERRUN');
  }
  if (missed === EcmMissedClassification.POTENTIAL_MISSED) reasons.add('POTENTIAL_MISSED');
  if (missed === EcmMissedClassification.CONFIRMED_MISSED) reasons.add('CONFIRMED_MISSED');
  if (missed === EcmMissedClassification.ATTENDANCE_VERIFICATION_PENDING) {
    reasons.add('ATTENDANCE_VERIFICATION_PENDING');
  }
  if (missed === EcmMissedClassification.FALSE_ECM_ALERT) reasons.add('FALSE_ECM_ALERT');
  if (missed === EcmMissedClassification.DISPUTED) reasons.add('DISPUTED');

  for (const code of row.operationalExceptionCodes) {
    if (code) reasons.add(code);
  }

  return [...reasons];
}

@Injectable()
export class EcmReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dailyOperations(query: EcmReportsQuery) {
    const dateFrom = (query.dateFrom ?? operationalTodayIso()).slice(0, 10);
    const dateTo = (query.dateTo ?? dateFrom).slice(0, 10);
    const from = dateFrom <= dateTo ? dateFrom : dateTo;
    const to = dateFrom <= dateTo ? dateTo : dateFrom;
    const singleDay = from === to;
    const localDateFilter: Prisma.DateTimeFilter = singleDay
      ? { equals: new Date(`${from}T00:00:00.000Z`) }
      : {
          gte: new Date(`${from}T00:00:00.000Z`),
          lte: new Date(`${to}T00:00:00.000Z`),
        };

    const where: Prisma.EcmVisitEvaluationWhereInput = {
      localVisitDate: localDateFilter,
      scheduledJob: {
        deletedAt: null,
        isActive: true,
        ...(query.scheduleAreaId ? { scheduleAreaId: query.scheduleAreaId } : {}),
        ...(query.locationId ? scheduledJobLocationScope(query.locationId) : {}),
        ...(query.serviceUserId ? { serviceUserId: query.serviceUserId } : {}),
      },
      ...(query.criticality
        ? { criticality: query.criticality as never }
        : {}),
    };

    const rows = (await this.prisma.ecmVisitEvaluation.findMany({
      where,
      select: {
        id: true,
        scheduledJobId: true,
        lifecycleStatus: true,
        arrivalClassification: true,
        durationClassification: true,
        missedClassification: true,
        confidence: true,
        criticality: true,
        startVarianceMinutes: true,
        durationVarianceMinutes: true,
        operationalExceptionCodes: true,
        thresholdRuleVersion: true,
        plannedStartDateTime: true,
        plannedEndDateTime: true,
        localVisitDate: true,
        scheduledJob: {
          select: {
            jobName: true,
            serviceUser: {
              select: { firstName: true, lastName: true, preferredName: true },
            },
            allocations: {
              where: {
                deletedAt: null,
                isActive: true,
                unallocatedAt: null,
              },
              select: {
                isLeadCarer: true,
                employee: {
                  select: {
                    id: true,
                    personalDetail: {
                      select: { firstName: true, lastName: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      take: singleDay ? 500 : 5000,
      orderBy: { plannedStartDateTime: 'asc' },
    })) as EvaluationRow[];

    const total = rows.length;
    const onTime = rows.filter(
      (r) => r.arrivalClassification === EcmArrivalClassification.ON_TIME,
    ).length;
    const early = rows.filter(
      (r) => r.arrivalClassification === EcmArrivalClassification.EARLY_ARRIVAL,
    ).length;
    const late = rows.filter(
      (r) => r.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL,
    ).length;
    const veryLate = rows.filter(
      (r) => r.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL,
    ).length;
    const arrivalNotAssessed = rows.filter(
      (r) => r.arrivalClassification === EcmArrivalClassification.NOT_ASSESSED,
    ).length;
    const lateArrivals = late + veryLate;

    const durationOnTime = rows.filter(
      (r) => r.durationClassification === EcmDurationClassification.ON_TIME,
    ).length;
    const shortVisits = rows.filter(
      (r) => r.durationClassification === EcmDurationClassification.SHORT_VISIT,
    ).length;
    const longVisits = rows.filter(
      (r) => r.durationClassification === EcmDurationClassification.LONG_VISIT,
    ).length;
    const excessiveOverrun = rows.filter(
      (r) => r.durationClassification === EcmDurationClassification.EXCESSIVE_OVERRUN,
    ).length;
    const durationNotAssessed = rows.filter(
      (r) => r.durationClassification === EcmDurationClassification.NOT_ASSESSED,
    ).length;

    const potentialMissed = rows.filter(
      (r) => r.missedClassification === EcmMissedClassification.POTENTIAL_MISSED,
    ).length;
    const confirmedMissed = rows.filter(
      (r) => r.missedClassification === EcmMissedClassification.CONFIRMED_MISSED,
    ).length;
    const manual = rows.filter((r) =>
      r.operationalExceptionCodes.includes('MANUAL_ATTENDANCE'),
    ).length;
    const verified = rows.filter(
      (r) => r.confidence === EcmAttendanceConfidence.VERIFIED,
    ).length;
    const geofenceBreaches = rows.filter((r) =>
      r.operationalExceptionCodes.includes('OUTSIDE_GEOFENCE'),
    ).length;
    const electronic = Math.max(0, total - manual);

    const exclusions = {
      confirmedMissed,
      falseEcmAlerts: rows.filter(
        (r) => r.missedClassification === EcmMissedClassification.FALSE_ECM_ALERT,
      ).length,
      disputed: rows.filter(
        (r) => r.missedClassification === EcmMissedClassification.DISPUTED,
      ).length,
    };

    const punctualityDenominator = Math.max(0, total - exclusions.confirmedMissed);
    const punctualityNumerator = onTime;

    const integrity = {
      verified,
      partiallyVerified: rows.filter(
        (r) => r.confidence === EcmAttendanceConfidence.PARTIALLY_VERIFIED,
      ).length,
      manuallyVerified: rows.filter(
        (r) => r.confidence === EcmAttendanceConfidence.MANUALLY_VERIFIED,
      ).length,
      unverified: rows.filter(
        (r) => r.confidence === EcmAttendanceConfidence.UNVERIFIED,
      ).length,
      disputed: rows.filter(
        (r) => r.confidence === EcmAttendanceConfidence.DISPUTED,
      ).length,
      rejected: rows.filter(
        (r) => r.confidence === EcmAttendanceConfidence.REJECTED,
      ).length,
    };

    const mappedRows = rows.map((r) => {
      const exceptionReasons = buildExceptionReasons(r);
      const carers = r.scheduledJob.allocations.map((a) => ({
        employeeId: a.employee.id,
        name: carerDisplayName(a),
        isLeadCarer: a.isLeadCarer,
      }));
      return {
        scheduledJobId: r.scheduledJobId,
        jobName: r.scheduledJob.jobName,
        serviceUserName: serviceUserDisplayName(r.scheduledJob.serviceUser),
        carerNames: carers.map((c) => c.name),
        carers,
        localVisitDate: formatScheduleDate(r.localVisitDate),
        plannedStartDateTime: r.plannedStartDateTime.toISOString(),
        plannedEndDateTime: r.plannedEndDateTime?.toISOString() ?? null,
        lifecycleStatus: r.lifecycleStatus,
        arrivalClassification: r.arrivalClassification,
        durationClassification: r.durationClassification,
        missedClassification: r.missedClassification,
        confidence: r.confidence,
        criticality: r.criticality,
        startVarianceMinutes: r.startVarianceMinutes,
        durationVarianceMinutes: r.durationVarianceMinutes,
        operationalExceptionCodes: r.operationalExceptionCodes,
        exceptionReasons,
        inExceptionRegister: exceptionReasons.length > 0,
      };
    });

    const exceptionRegister = mappedRows.filter((r) => r.inExceptionRegister);

    return {
      data: {
        reportType: 'daily-operations',
        date: from,
        dateFrom: from,
        dateTo: to,
        refreshedAt: new Date().toISOString(),
        operationalTimezone: DEFAULT_OPERATIONAL_TIMEZONE,
        thresholdVersion:
          rows.find((r) => r.thresholdRuleVersion)?.thresholdRuleVersion ?? 'platform-default',
        definitions: {
          punctuality:
            'ON_TIME arrivals ÷ (total evaluations − confirmed missed). Early is not on-time. Aligns with arrivalClassification SSOT used by Graphs.',
          electronicMonitoring:
            'Visits without MANUAL_ATTENDANCE (admin-completed) ÷ total evaluations in period.',
          exceptionRegister:
            'Evaluations with a non-compliant arrival/duration/missed classification or any operational exception code.',
          opsDay: `Operational calendar day in ${DEFAULT_OPERATIONAL_TIMEZONE}.`,
        },
        kpis: {
          punctuality: {
            numerator: punctualityNumerator,
            denominator: punctualityDenominator,
            rate:
              punctualityDenominator > 0
                ? Math.round((punctualityNumerator / punctualityDenominator) * 1000) / 10
                : null,
            exclusions,
          },
          electronicMonitoring: {
            numerator: electronic,
            denominator: total,
            rate:
              total > 0 ? Math.round((electronic / total) * 1000) / 10 : null,
          },
          lateArrivals,
          earlyArrivals: early,
          shortVisits,
          longVisits: longVisits + excessiveOverrun,
          potentialMissed,
          confirmedMissed,
          manualAttendance: manual,
          electronicAttendance: electronic,
          geofenceBreaches,
          verifiedConfidence: verified,
          totalVisits: total,
          exceptionRegisterCount: exceptionRegister.length,
        },
        classifications: {
          arrival: {
            onTime,
            early,
            late,
            veryLate,
            notAssessed: arrivalNotAssessed,
            total,
          },
          duration: {
            onTime: durationOnTime,
            short: shortVisits,
            long: longVisits,
            excessiveOverrun,
            notAssessed: durationNotAssessed,
            total,
          },
        },
        integrity,
        rows: mappedRows,
        exceptionRegister,
      },
    };
  }

  async compliance(query: EcmReportsQuery) {
    const ops = await this.dailyOperations(query);
    const openExceptions = await this.prisma.ecmException.count({
      where: {
        lifecycle: {
          notIn: ['RESOLVED', 'MANAGER_REVIEWED', 'CLOSED'],
        },
        ecmVisitEvaluation: {
          localVisitDate: {
            gte: new Date(`${ops.data.dateFrom}T00:00:00.000Z`),
            lte: new Date(`${ops.data.dateTo}T00:00:00.000Z`),
          },
          ...(query.scheduleAreaId || query.locationId || query.serviceUserId
            ? {
                scheduledJob: {
                  deletedAt: null,
                  isActive: true,
                  ...(query.scheduleAreaId
                    ? { scheduleAreaId: query.scheduleAreaId }
                    : {}),
                  ...(query.locationId
                    ? scheduledJobLocationScope(query.locationId)
                    : {}),
                  ...(query.serviceUserId
                    ? { serviceUserId: query.serviceUserId }
                    : {}),
                },
              }
            : {}),
        },
      },
    });

    return {
      data: {
        reportType: 'compliance',
        date: ops.data.date,
        dateFrom: ops.data.dateFrom,
        dateTo: ops.data.dateTo,
        refreshedAt: new Date().toISOString(),
        operationalTimezone: ops.data.operationalTimezone,
        thresholdVersion: ops.data.thresholdVersion,
        openExceptions,
        kpis: ops.data.kpis,
        integrity: ops.data.integrity,
        classifications: ops.data.classifications,
        definitions: ops.data.definitions,
      },
    };
  }
}
