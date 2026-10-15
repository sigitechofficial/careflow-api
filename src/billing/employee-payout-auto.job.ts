import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmployeePayoutsService } from './employee-payouts.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  hourInTimeZone,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';

const PAYOUT_DAY_OF_MONTH = '04';
const PAYOUT_HOUR = 6;

/** True during 06:00–06:59 on the 4th of the month in the given IANA timezone. */
export function isMonthlyPayoutHour(now: Date, timeZone: string): boolean {
  return (
    operationalTodayIso(now, timeZone).slice(8, 10) === PAYOUT_DAY_OF_MONTH &&
    hourInTimeZone(now, timeZone) === PAYOUT_HOUR
  );
}

/**
 * Hourly tick; pays at 06:00 on the 4th in the organisation's operational timezone
 * (OrganisationGeneralSettings.timezone), so DST and the org setting are respected.
 * Pays UK net for statutory/closed UK payroll runs in the previous calendar month;
 * the service skips a period that already has an open batch.
 */
@Injectable()
export class EmployeePayoutAutoJob {
  private readonly logger = new Logger(EmployeePayoutAutoJob.name);

  constructor(
    private readonly payouts: EmployeePayoutsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('0 * * * *')
  async handleMonthlyAutoPayout(): Promise<void> {
    await runCronTick(this.jobRunner, 'employee-payout-auto', () =>
      this.runMonthlyAutoPayout(),
    );
  }

  /** Self-gated: does nothing (skipped) outside 06:00 on the 4th in the org timezone. */
  @JobHandler('employee-payout-auto')
  async runMonthlyAutoPayout(): Promise<JobOutcome> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    if (!isMonthlyPayoutHour(new Date(), timeZone)) {
      return jobSkipped(
        'Not the payout hour (06:00 on the 4th, organisation time)',
        { timeZone },
      );
    }

    this.logger.log(
      `Starting scheduled UK-net employee payout (4th of month, ${timeZone})`,
    );
    try {
      const result = await this.payouts.executeAutomaticMonthlyPayout();
      this.logger.log(
        `Scheduled UK-net payout finished: ${result.outcome} period=${result.periodKey}` +
          (result.batchId ? ` batch=${result.batchId}` : '') +
          (result.reason ? ` (${result.reason})` : ''),
      );
      return jobSuccess({
        timeZone,
        outcome: result.outcome,
        periodKey: result.periodKey,
        batchId: result.batchId ?? null,
        reason: result.reason ?? null,
      });
    } catch (err) {
      this.logger.error(
        `Scheduled UK-net payout failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }
}
