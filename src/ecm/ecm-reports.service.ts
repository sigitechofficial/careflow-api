import { Injectable } from '@nestjs/common';
import {
  EcmArrivalClassification,
  EcmAttendanceConfidence,
  EcmMissedClassification,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatScheduleDate } from '../schedules/schedules-date.util';

export type EcmReportsQuery = {
  dateFrom?: string;
  dateTo?: string;
  scheduleAreaId?: string;
  serviceUserId?: string;
  criticality?: string;
};

@Injectable()
export class EcmReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dailyOperations(query: EcmReportsQuery) {
    const date = query.dateFrom ?? formatScheduleDate(new Date());
    const localDate = new Date(`${date}T00:00:00.000Z`);

    const where: Prisma.EcmVisitEvaluationWhereInput = {
      localVisitDate: localDate,
      scheduledJob: {
        deletedAt: null,
        isActive: true,
        ...(query.scheduleAreaId ? { scheduleAreaId: query.scheduleAreaId } : {}),
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
      take: 500,
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
        date,
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
