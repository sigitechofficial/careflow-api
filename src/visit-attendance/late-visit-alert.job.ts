import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  LateVisitAlertKind,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const CLOSED_JOB: ScheduledJobStatus[] = [
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.MISSED,
  ScheduledJobStatus.DRAFT,
];

const STARTED_VISIT: ScheduledVisitStatus[] = [
  ScheduledVisitStatus.STARTED,
  ScheduledVisitStatus.COMPLETED,
  ScheduledVisitStatus.PARTIALLY_COMPLETED,
  ScheduledVisitStatus.MISSED,
  ScheduledVisitStatus.CANCELLED,
  ScheduledVisitStatus.CALLED_OFF,
];

/**
 * ECM late-visit monitor — uses org Dom Care late-alert settings.
 * Runs every 5 minutes; dedupes via LateVisitAlertLog.
 */
@Injectable()
export class LateVisitAlertJob {
  private readonly logger = new Logger(LateVisitAlertJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  @Cron('*/5 * * * *', { timeZone: 'UTC' })
  async handleLateVisits(): Promise<void> {
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      select: {
        domLateVisitAlertRequired: true,
        domLateVisitAlertMinutes: true,
        domLateVisitAlertEmail: true,
        domLateVisitAlertText: true,
        domLateVisitAlertNotification: true,
      },
    });

    if (!settings?.domLateVisitAlertRequired) return;

    const thresholdMinutes = Math.max(1, settings.domLateVisitAlertMinutes ?? 15);
    const cutoff = new Date(Date.now() - thresholdMinutes * 60_000);

    const candidates = await this.prisma.scheduledJob.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { notIn: CLOSED_JOB },
        scheduledStartDateTime: { lte: cutoff },
        visits: {
          some: {
            deletedAt: null,
            isActive: true,
            actualStartDateTime: null,
            status: { notIn: STARTED_VISIT },
          },
        },
        lateVisitAlerts: {
          none: { alertKind: LateVisitAlertKind.LATE_START },
        },
      },
      take: 100,
      orderBy: { scheduledStartDateTime: 'asc' },
      select: {
        id: true,
        jobName: true,
        scheduledStartDateTime: true,
        serviceUser: {
          select: { firstName: true, lastName: true, preferredName: true },
        },
      },
    });

    if (candidates.length === 0) return;

    const recipients = settings.domLateVisitAlertNotification
      ? await this.managerUserIds()
      : [];

    let alerted = 0;
    for (const job of candidates) {
      const suName =
        job.serviceUser.preferredName?.trim() ||
        [job.serviceUser.firstName, job.serviceUser.lastName].filter(Boolean).join(' ') ||
        'Service user';
      const message = `Visit "${job.jobName}" for ${suName} has not started ${thresholdMinutes}+ minutes after planned start (${job.scheduledStartDateTime.toISOString()}).`;

      let recipientCount = 0;
      if (settings.domLateVisitAlertNotification && this.notifications && recipients.length) {
        try {
          await this.notifications.notifyUsers({
            recipientUserIds: recipients,
            type: NotificationType.SCHEDULE_UNALLOCATED_VISIT,
            title: 'Late visit — not started',
            message,
            module: NotificationModule.SCHEDULING,
            severity: NotificationSeverity.WARNING,
            recordType: 'ScheduledJob',
            recordId: job.id,
            metadata: {
              kind: 'LATE_START',
              thresholdMinutes,
              scheduledStart: job.scheduledStartDateTime.toISOString(),
            },
          });
          recipientCount = recipients.length;
        } catch (err) {
          this.logger.warn(`Failed to notify for late job ${job.id}: ${String(err)}`);
        }
      }

      if (settings.domLateVisitAlertEmail) {
        this.logger.warn(`[ECM late alert EMAIL channel enabled] ${message}`);
      }
      if (settings.domLateVisitAlertText) {
        this.logger.warn(`[ECM late alert SMS channel enabled] ${message}`);
      }

      try {
        await this.prisma.lateVisitAlertLog.create({
          data: {
            scheduledJobId: job.id,
            alertKind: LateVisitAlertKind.LATE_START,
            thresholdMinutes,
            scheduledStart: job.scheduledStartDateTime,
            channels: {
              notification: Boolean(settings.domLateVisitAlertNotification),
              email: Boolean(settings.domLateVisitAlertEmail),
              text: Boolean(settings.domLateVisitAlertText),
            } as Prisma.InputJsonValue,
            recipientCount,
            message,
          },
        });
        alerted += 1;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        this.logger.error(`Failed to log late alert for ${job.id}: ${String(err)}`);
      }
    }

    if (alerted > 0) {
      this.logger.log(`ECM late-visit monitor: alerted on ${alerted} job(s)`);
    }
  }

  private async managerUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        name: { in: ['Admin', 'Manager', 'Staff Allocation', 'Coordinator'] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!roles.length) return [];
    const links = await this.prisma.userRole.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { userId: true },
    });
    return [...new Set(links.map((l) => l.userId))];
  }
}
