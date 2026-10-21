import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceUserVisitPlansService } from '../service-user-visit-plans/service-user-visit-plans.service';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';

@Injectable()
export class VisitPlanScheduledEndJob {
  private readonly logger = new Logger(VisitPlanScheduledEndJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly visitPlans: ServiceUserVisitPlansService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('30 0 * * *', { timeZone: 'UTC' })
  async handleScheduledEndPlans(): Promise<void> {
    await runCronTick(this.jobRunner, 'visit-plan-scheduled-end', () =>
      this.runScheduledEnd(),
    );
  }

  @JobHandler('visit-plan-scheduled-end')
  async runScheduledEnd(): Promise<JobOutcome> {
    const systemUser = await this.prisma.user.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!systemUser) {
      this.logger.warn('Scheduled end job skipped — no active user for audit');
      return jobSkipped('No active user for audit');
    }
    const ended = await this.visitPlans.processScheduledEndPlans(systemUser.id);
    if (ended > 0) {
      this.logger.log(`Auto-ended ${ended} visit plan(s) after scheduled closure date`);
    }
    return jobSuccess({ plansEnded: ended });
  }
}
