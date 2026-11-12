import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AllocationStatus,
  CarerVisitPushKind,
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
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import { resolveAllocationWindow } from '../job-allocations/allocation-window.util';
import {
  formatHmInTimeZone,
  getOperationalTimeZone,
} from '../common/utils/operational-day.util';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';

/** Same office audience as ECM alerts. */
const LATE_ALERT_ROLE_NAMES: string[] = [
  IDENTITY_ROLE.SUPER_ADMIN,
  IDENTITY_ROLE.ADMIN,
  IDENTITY_ROLE.BRANCH_ADMIN,
  IDENTITY_ROLE.MANAGER,
  IDENTITY_ROLE.CARE_COORDINATOR,
  IDENTITY_ROLE.STAFF_ALLOCATION,
  IDENTITY_ROLE.MASTER_STAFF_ALLOCATION,
];

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
    @Optional() private readonly carerPush?: CarerVisitPushHook,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('*/5 * * * *', { timeZone: 'UTC' })
  async handleLateVisits(): Promise<void> {
    await runCronTick(this.jobRunner, 'late-visit-alert', () =>
      this.runLateVisitAlert(),
    );
  }

  @JobHandler('late-visit-alert')
  async runLateVisitAlert(): Promise<JobOutcome> {
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      select: {
        domLateVisitAlertRequired: true,
        domLateVisitAlertMinutes: true,
        domLateVisitAlertEmail: true,
        domLateVisitAlertText: true,
        domLateVisitAlertNotification: true,
        timezone: true,
      },
    });

    if (!settings?.domLateVisitAlertRequired) {
      return jobSkipped(
        'Late visit alerts are turned off in organisation settings',
      );
    }
    const timeZone = getOperationalTimeZone(settings.timezone);

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
        serviceUserId: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        estimatedDurationMinutes: true,
        serviceUser: {
          select: {
            firstName: true,
            lastName: true,
            preferredName: true,
            locationId: true,
          },
        },
        allocations: {
          where: {
            deletedAt: null,
            isActive: true,
            status: {
              in: [
                AllocationStatus.PENDING_CONFIRMATION,
                AllocationStatus.ALLOCATED,
                AllocationStatus.CONFIRMED,
              ],
            },
          },
          select: {
            employeeId: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            durationMinutes: true,
          },
        },
      },
    });

    if (candidates.length === 0) {
      return jobSuccess({ thresholdMinutes, candidates: 0, alerted: 0 });
    }

    const recipients = settings.domLateVisitAlertNotification
      ? await this.managerUserIds()
      : [];

    let alerted = 0;
    for (const job of candidates) {
      const plannedStarts = job.allocations.length
        ? job.allocations.map(
            (a) =>
              resolveAllocationWindow(a, {
                scheduledStartDateTime: job.scheduledStartDateTime,
                scheduledEndDateTime: job.scheduledEndDateTime,
                estimatedDurationMinutes: job.estimatedDurationMinutes,
              }).start,
          )
        : [job.scheduledStartDateTime];
      const effectiveStart = new Date(Math.min(...plannedStarts.map((d) => d.getTime())));
      if (effectiveStart.getTime() > cutoff.getTime()) continue;

      const su = job.serviceUser;
      const fullName =
        [su.firstName, su.lastName].filter(Boolean).join(' ').trim() ||
        su.preferredName?.trim() ||
        'Service user';
      const suName = su.preferredName?.trim() || fullName;
      // jobName already carries the preferred name ("Morning — Harry").
      const message = `${job.jobName} (${fullName}) has not started. Planned start ${formatHmInTimeZone(effectiveStart, timeZone)}, now ${thresholdMinutes}+ minutes late.`;

      let recipientCount = 0;
      if (settings.domLateVisitAlertNotification && this.notifications && recipients.length) {
        try {
          await this.notifications.notifyUsers({
            recipientUserIds: recipients,
            type: NotificationType.SCHEDULE_UNALLOCATED_VISIT,
            title: `Late visit not started — ${suName}`,
            message,
            module: NotificationModule.SCHEDULING,
            severity: NotificationSeverity.WARNING,
            recordType: 'ScheduledJob',
            recordId: job.id,
            metadata: {
              kind: 'LATE_START',
              // Opens the visit in Live visits › Exceptions.
              href: `/ecm/live?tab=exceptions&period=today&jobId=${job.id}`,
              thresholdMinutes,
              scheduledStart: effectiveStart.toISOString(),
            },
          });
          recipientCount = recipients.length;
        } catch (err) {
          this.logger.warn(`Failed to notify for late job ${job.id}: ${String(err)}`);
        }
      }

      const carerIds = [
        ...new Set(job.allocations.map((a) => a.employeeId).filter(Boolean)),
      ];
      this.carerPush?.notify({
        employeeIds: carerIds,
        kind: CarerVisitPushKind.VISIT_LATE,
        title: 'Visit not started',
        body: `You have not clocked in to "${job.jobName}".`,
        scheduledJobId: job.id,
        serviceUserId: job.serviceUserId,
        once: true,
      });

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
            scheduledStart: effectiveStart,
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
    return jobSuccess({
      thresholdMinutes,
      candidates: candidates.length,
      alerted,
    });
  }

  private async managerUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        name: { in: LATE_ALERT_ROLE_NAMES },
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
