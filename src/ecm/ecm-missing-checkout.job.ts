import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EcmExceptionKind,
  EcmExceptionLifecycle,
  ScheduledJobStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmEvaluationService } from './ecm-evaluation.service';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSuccess, type JobOutcome } from '../jobs/job-run.types';

const CLOSED: ScheduledJobStatus[] = [
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.MISSED,
  ScheduledJobStatus.DRAFT,
];

/**
 * Lifecycles that still count as an "open" exception — mirrors OPEN_LIFECYCLES
 * in ecm-exceptions.service.ts. A job that already carries an open
 * MISSING_CHECKOUT is skipped so we never re-evaluate the same stuck visit.
 */
const OPEN_LIFECYCLES: EcmExceptionLifecycle[] = [
  EcmExceptionLifecycle.DETECTED,
  EcmExceptionLifecycle.ALERT_GENERATED,
  EcmExceptionLifecycle.ASSIGNED,
  EcmExceptionLifecycle.ACKNOWLEDGED,
  EcmExceptionLifecycle.INVESTIGATING,
  EcmExceptionLifecycle.ACTION_TAKEN,
  EcmExceptionLifecycle.RESOLVED,
  EcmExceptionLifecycle.MANAGER_REVIEWED,
];

/**
 * Missing-checkout scanner.
 *
 * Detects visits a carer clocked into but never clocked out of, whose planned
 * end is already past (checked-in, no check-out, plannedEnd < now). Re-runs the
 * standard evaluation so the ECM MISSING_CHECKOUT exception row + SLA/alert get
 * raised reliably instead of only when some unrelated re-evaluation happens to
 * fire.
 *
 * We do NOT block or auto-close the visit — this only flags it for the office.
 * Jobs that already carry an open MISSING_CHECKOUT exception are excluded, so
 * each stuck visit is evaluated once and later runs mostly return nothing.
 */
@Injectable()
export class EcmMissingCheckoutDetectionJob {
  private readonly logger = new Logger(EcmMissingCheckoutDetectionJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluation: EcmEvaluationService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('*/15 * * * *', { timeZone: 'UTC' })
  async handle(): Promise<void> {
    await runCronTick(this.jobRunner, 'ecm-missing-checkout', () =>
      this.runMissingCheckoutScan(),
    );
  }

  @JobHandler('ecm-missing-checkout')
  async runMissingCheckoutScan(): Promise<JobOutcome> {
    const now = new Date();

    const candidates = await this.prisma.scheduledJob.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { notIn: CLOSED },
        // Clocked in, never clocked out, planned end already past.
        ecmEvaluation: {
          actualCheckInAt: { not: null },
          actualCheckOutAt: null,
          plannedEndDateTime: { lt: now },
        },
        // Skip visits already flagged with an open MISSING_CHECKOUT.
        NOT: {
          ecmExceptions: {
            some: {
              kind: EcmExceptionKind.MISSING_CHECKOUT,
              lifecycle: { in: OPEN_LIFECYCLES },
            },
          },
        },
      },
      take: 80,
      orderBy: { scheduledStartDateTime: 'asc' },
      select: { id: true },
    });

    if (candidates.length === 0) {
      return jobSuccess({ candidates: 0, evaluated: 0 });
    }

    let evaluated = 0;
    for (const job of candidates) {
      const result = await this.evaluation.evaluateJobSafe(job.id);
      if (result) evaluated += 1;
    }

    this.logger.log(
      `ECM missing-checkout scan: evaluated ${evaluated}/${candidates.length} stuck visit(s)`,
    );
    return jobSuccess({ candidates: candidates.length, evaluated });
  }
}
