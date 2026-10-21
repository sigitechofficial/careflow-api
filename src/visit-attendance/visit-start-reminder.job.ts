import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AllocationStatus,
  CarerVisitPushKind,
  ScheduledJobStatus,
  ScheduledVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import { resolveAllocationWindow } from '../job-allocations/allocation-window.util';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';

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

const LEAD_MINUTES = 15;

@Injectable()
export class VisitStartReminderJob {
  private readonly logger = new Logger(VisitStartReminderJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly carerPush?: CarerVisitPushHook,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('*/2 * * * *', { timeZone: 'UTC' })
  async handleUpcomingVisits(): Promise<void> {
    await runCronTick(this.jobRunner, 'visit-start-reminder', () =>
      this.runStartReminders(),
    );
  }

  @JobHandler('visit-start-reminder')
  async runStartReminders(): Promise<JobOutcome> {
    if (!this.carerPush) {
      return jobSkipped('Carer push notifications are not available');
    }
    const now = Date.now();
    const windowEnd = new Date(now + LEAD_MINUTES * 60_000);

    const jobs = await this.prisma.scheduledJob.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { notIn: CLOSED_JOB },
        scheduledStartDateTime: { gte: new Date(now), lte: windowEnd },
        visits: {
          some: {
            deletedAt: null,
            isActive: true,
            actualStartDateTime: null,
            status: { notIn: STARTED_VISIT },
          },
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

    let sent = 0;
    for (const job of jobs) {
      const employeeIds = [...new Set(job.allocations.map((a) => a.employeeId))];
      if (!employeeIds.length) continue;
      const starts = job.allocations.length
        ? job.allocations.map(
            (a) =>
              resolveAllocationWindow(a, {
                scheduledStartDateTime: job.scheduledStartDateTime,
                scheduledEndDateTime: job.scheduledEndDateTime,
                estimatedDurationMinutes: job.estimatedDurationMinutes,
              }).start.getTime(),
          )
        : [job.scheduledStartDateTime.getTime()];
      const effectiveStart = Math.min(...starts);
      if (effectiveStart < now || effectiveStart > windowEnd.getTime()) continue;

      await this.carerPush.notifySafe({
        employeeIds,
        kind: CarerVisitPushKind.VISIT_START_REMINDER,
        title: 'Visit starting soon',
        body: `"${job.jobName}" starts in ${LEAD_MINUTES} minutes.`,
        scheduledJobId: job.id,
        serviceUserId: job.serviceUserId,
        once: true,
      });
      sent += 1;
    }

    if (sent > 0) {
      this.logger.log(`Visit start reminders: ${sent} job(s)`);
    }
    return jobSuccess({ candidates: jobs.length, remindersSent: sent });
  }
}
