import { Injectable } from '@nestjs/common';
import {
  EcmArrivalClassification,
  EcmAttendanceConfidence,
  EcmMissedClassification,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { operationalTodayIso } from '../common/utils/operational-day.util';
import { scheduledJobLocationScope } from './ecm-location-scope.util';

export type EcmReportsQuery = {
  dateFrom?: string;
  dateTo?: string;
  scheduleAreaId?: string;
  locationId?: string;
  serviceUserId?: string;
  criticality?: string;
};

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

    const rows = await this.prisma.ecmVisitEvaluation.findMany({
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
        scheduledJob: {
          select: {
            jobName: true,
            serviceUser: {
              select: { firstName: true, lastName: true, preferredName: true },
            },
          },
        },
      },
      take: singleDay ? 500 : 5000,
      orderBy: { plannedStartDateTime: 'asc' },
    });

    const total = rows.length;
    const onTime = rows.filter(
      (r) => r.arrivalClassification === EcmArrivalClassification.ON_TIME,
    ).length;
    const late = rows.filter(
      (r) =>
        r.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL ||
        r.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL,
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

    return {
      data: {
        reportType: 'daily-operations',
        date: from,
        dateFrom: from,
        dateTo: to,
        refreshedAt: new Date().toISOString(),
        thresholdVersion:
          rows.find((r) => r.thresholdRuleVersion)?.thresholdRuleVersion ?? 'platform-default',
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
          lateArrivals: late,
          potentialMissed,
          confirmedMissed,
          manualAttendance: manual,
          electronicAttendance: electronic,
          geofenceBreaches,
          verifiedConfidence: verified,
          totalVisits: total,
        },
        rows: rows.map((r) => ({
          scheduledJobId: r.scheduledJobId,
          jobName: r.scheduledJob.jobName,
          serviceUserName:
            r.scheduledJob.serviceUser.preferredName?.trim() ||
            [r.scheduledJob.serviceUser.firstName, r.scheduledJob.serviceUser.lastName]
              .filter(Boolean)
              .join(' '),
          lifecycleStatus: r.lifecycleStatus,
          arrivalClassification: r.arrivalClassification,
          durationClassification: r.durationClassification,
          missedClassification: r.missedClassification,
          confidence: r.confidence,
          criticality: r.criticality,
          startVarianceMinutes: r.startVarianceMinutes,
          durationVarianceMinutes: r.durationVarianceMinutes,
          operationalExceptionCodes: r.operationalExceptionCodes,
        })),
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
        ...(query.dateFrom
          ? {
              createdAt: {
                gte: new Date(`${query.dateFrom}T00:00:00.000Z`),
                lte: new Date(`${(query.dateTo ?? query.dateFrom)}T23:59:59.999Z`),
              },
            }
          : {}),
      },
    });

    return {
      data: {
        reportType: 'compliance',
        date: ops.data.date,
        refreshedAt: new Date().toISOString(),
        thresholdVersion: ops.data.thresholdVersion,
        openExceptions,
        kpis: ops.data.kpis,
        integrity: {
          unverified: ops.data.rows.filter((r) => r.confidence === 'UNVERIFIED').length,
          manuallyVerified: ops.data.rows.filter((r) => r.confidence === 'MANUALLY_VERIFIED')
            .length,
          rejected: ops.data.rows.filter((r) => r.confidence === 'REJECTED').length,
          disputed: ops.data.rows.filter((r) => r.confidence === 'DISPUTED').length,
        },
      },
    };
  }
}
