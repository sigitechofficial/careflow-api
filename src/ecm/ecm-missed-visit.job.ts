import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EcmMissedClassification,
  ScheduledJobStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmEvaluationService } from './ecm-evaluation.service';

const CLOSED: ScheduledJobStatus[] = [
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.MISSED,
  ScheduledJobStatus.DRAFT,
];

/**
 * Missed-visit triage scanner (BE1.19 / GAP4).
 * Marks POTENTIAL_MISSED via re-evaluation; does not auto-confirm.
 */
@Injectable()
export class EcmMissedVisitDetectionJob {
  private readonly logger = new Logger(EcmMissedVisitDetectionJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluation: EcmEvaluationService,
  ) {}

  @Cron('*/5 * * * *', { timeZone: 'UTC' })
  async handle(): Promise<void> {
    const now = new Date();
    const lookback = new Date(now.getTime() - 12 * 60 * 60_000);
    const cutoff = new Date(now.getTime() - 30 * 60_000);

    const candidates = await this.prisma.scheduledJob.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { notIn: CLOSED },
        scheduledStartDateTime: { gte: lookback, lte: cutoff },
        OR: [
          { ecmEvaluation: null },
          {
            ecmEvaluation: {
              actualCheckInAt: null,
              missedClassification: {
                in: [EcmMissedClassification.NONE, EcmMissedClassification.POTENTIAL_MISSED],
              },
            },
          },
        ],
      },
      take: 80,
      orderBy: { scheduledStartDateTime: 'asc' },
      select: { id: true },
    });

    if (candidates.length === 0) return;

    let evaluated = 0;
    for (const job of candidates) {
      const result = await this.evaluation.evaluateJobSafe(job.id);
      if (result) evaluated += 1;
    }

    this.logger.log(
      `ECM missed-visit scan: evaluated ${evaluated}/${candidates.length} candidate job(s)`,
    );
  }
}
