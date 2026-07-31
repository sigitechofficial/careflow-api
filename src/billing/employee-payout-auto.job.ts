import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmployeePayoutsService } from './employee-payouts.service';

/**
 * Runs at 06:00 UTC on the 4th of every month.
 * Pays out the previous calendar month's visit-pay net (create → approve → mark paid).
 */
@Injectable()
export class EmployeePayoutAutoJob {
  private readonly logger = new Logger(EmployeePayoutAutoJob.name);

  constructor(private readonly payouts: EmployeePayoutsService) {}

  @Cron('0 6 4 * *', { timeZone: 'UTC' })
  async handleMonthlyAutoPayout(): Promise<void> {
    this.logger.log('Starting scheduled employee payout (4th of month)');
    try {
      const result = await this.payouts.executeAutomaticMonthlyPayout();
      this.logger.log(
        `Scheduled employee payout finished: ${result.outcome} period=${result.periodKey}` +
          (result.batchId ? ` batch=${result.batchId}` : '') +
          (result.reason ? ` (${result.reason})` : ''),
      );
    } catch (err) {
      this.logger.error(
        `Scheduled employee payout failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
