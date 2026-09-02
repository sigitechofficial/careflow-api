import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ServiceUserCarePlansService } from './service-user-care-plans.service';

@Injectable()
export class CarePlanReviewRemindersJob {
  private readonly logger = new Logger(CarePlanReviewRemindersJob.name);

  constructor(private readonly carePlans: ServiceUserCarePlansService) {}

  @Cron('0 6 * * *', { timeZone: 'UTC' })
  async sendDailyReviewReminders() {
    const result = await this.carePlans.sendReviewReminders();
    this.logger.log(
      `Care plan review reminders: sent=${result.data.sent} skipped=${result.data.skipped} due=${result.data.due}`,
    );
  }
}
