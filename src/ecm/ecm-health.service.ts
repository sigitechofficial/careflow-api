import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAlertService } from './ecm-alert.service';

/**
 * ECM health endpoint (BE1.33 / GAP6).
 * "No alerts" must not be confused with a broken monitor.
 */
@Injectable()
export class EcmHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: EcmAlertService,
  ) {}

  async getHealth() {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);

    const [
      evaluationsLastHour,
      openExceptions,
      overdueExceptions,
      attendanceLastHour,
      lateAlertLogsToday,
    ] = await Promise.all([
      this.prisma.ecmVisitEvaluation.count({
        where: { evaluatedAt: { gte: hourAgo } },
      }),
      this.prisma.ecmException.count({
        where: {
          lifecycle: {
            notIn: ['RESOLVED', 'MANAGER_REVIEWED', 'CLOSED'],
          },
        },
      }),
      this.prisma.ecmException.count({ where: { overdue: true } }),
      this.prisma.visitAttendanceEvent.count({
        where: { createdAt: { gte: hourAgo } },
      }),
      this.prisma.lateVisitAlertLog.count({
        where: { alertedAt: { gte: dayAgo } },
      }),
    ]);

    await this.alerts.refreshOverdueFlags(100);

    const monitorActive = evaluationsLastHour > 0 || attendanceLastHour > 0;
    const status =
      !monitorActive && openExceptions === 0
        ? 'DEGRADED'
        : overdueExceptions > 10
          ? 'ATTENTION'
          : 'HEALTHY';

    return {
      data: {
        status,
        checkedAt: now.toISOString(),
        monitorActive,
        signals: {
          evaluationsLastHour,
          attendanceEventsLastHour: attendanceLastHour,
          openExceptions,
          overdueExceptions,
          lateAlertLogsLast24h: lateAlertLogsToday,
        },
        guidance:
          status === 'DEGRADED'
            ? 'No recent ECM evaluations or attendance events — verify monitoring jobs and mobile sync before treating a quiet board as all-clear.'
            : status === 'ATTENTION'
              ? 'Multiple overdue ECM exceptions require coordinator action.'
              : 'ECM monitoring appears active.',
      },
    };
  }
}
