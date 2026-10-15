import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ServiceUserCarePlansService } from './service-user-care-plans.service';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSuccess, type JobOutcome } from '../jobs/job-run.types';

@Injectable()
export class CarePlanReviewRemindersJob {
  private readonly logger = new Logger(CarePlanReviewRemindersJob.name);

  constructor(
    private readonly carePlans: ServiceUserCarePlansService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'UTC' })
  async sendDailyReviewReminders() {
    await runCronTick(this.jobRunner, 'care-plan-review-reminders', () =>
      this.runReviewReminders(),
    );
  }

  @JobHandler('care-plan-review-reminders')
  async runReviewReminders(): Promise<JobOutcome> {
    const result = await this.carePlans.sendReviewReminders();
    this.logger.log(
      `Care plan review reminders: sent=${result.data.sent} skipped=${result.data.skipped} due=${result.data.due}`,
    );
    return jobSuccess({
      due: result.data.due,
      sent: result.data.sent,
      skipped: result.data.skipped,
    });
  }
}
