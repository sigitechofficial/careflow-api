import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  hourInTimeZone,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { PlatformCostsSyncService } from './platform-costs-sync.service';
import {
  PlatformCostsReportService,
  previousMonth,
} from './platform-costs-report.service';
import {
  COSTS_SYNC_INTERVAL_MS,
  DAILY_SYNC_INTERVAL_MS,
  MONTHLY_REPORT_DAY_OF_MONTH,
  MONTHLY_REPORT_HOUR,
} from './platform-costs.constants';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';

/** True during 08:00–08:59 on the 1st of the month in the organisation's timezone. */
export function isMonthlyReportHour(now: Date, timeZone: string): boolean {
  return (
    Number(operationalTodayIso(now, timeZone).slice(8, 10)) ===
      MONTHLY_REPORT_DAY_OF_MONTH &&
    hourInTimeZone(now, timeZone) === MONTHLY_REPORT_HOUR
  );
}

/**
 * Hourly tick (only when AZURE_COST_ENABLED=true):
 * - costs (+ forecast, budgets, anomaly check) when the last success is ≥ 6 h old;
 * - retail prices and Advisor when ≥ 24 h old;
 * - monthly report at 08:00 on the 1st (org timezone) for the previous month.
 * Cadence is derived from persisted sync runs, so restarts neither skip nor double-run.
 * Single replica today — see TODO(job-lock) in PlatformCostsSyncService.
 */
@Injectable()
export class PlatformCostsJobs {
  private readonly logger = new Logger(PlatformCostsJobs.name);
  private ticking = false;

  constructor(
    private readonly sync: PlatformCostsSyncService,
    private readonly reports: PlatformCostsReportService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('5 * * * *')
  async hourlyTick(): Promise<void> {
    await runCronTick(this.jobRunner, 'platform-costs-sync', () =>
      this.runHourlySync(),
    );
  }

  /**
   * Self-gated: syncs only the kinds that are due (per persisted AzureSyncRun history).
   * Individual sync failures are recorded on AzureSyncRun and reported in the summary.
   */
  @JobHandler('platform-costs-sync')
  async runHourlySync(): Promise<JobOutcome> {
    if (!this.sync.enabled)
      return jobSkipped(
        'Azure cost sync disabled (AZURE_COST_ENABLED is not true)',
      );
    if (this.ticking)
      return jobSkipped('Previous Azure Pricing tick still running');
    this.ticking = true;
    const summary: Record<string, string | number> = {
      costs: 'not-due',
      prices: 'not-due',
      advisor: 'not-due',
      monthlyReport: 'not-due',
    };
    try {
      summary.abandonedRunsFailed = await this.sync.failAbandonedRuns();
      if (await this.sync.isDue('costs', COSTS_SYNC_INTERVAL_MS)) {
        summary.costs = (await this.sync.runCostsPipeline('schedule')).status;
      }
      if (await this.sync.isDue('prices', DAILY_SYNC_INTERVAL_MS)) {
        summary.prices = (await this.sync.run('prices', 'schedule')).status;
      }
      if (await this.sync.isDue('advisor', DAILY_SYNC_INTERVAL_MS)) {
        summary.advisor = (await this.sync.run('advisor', 'schedule')).status;
      }
      summary.monthlyReport = (await this.monthlyReportIfDue()) ?? 'not-due';
      return jobSuccess(summary);
    } catch (err) {
      this.logger.error(
        `Azure Pricing hourly tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    } finally {
      this.ticking = false;
    }
  }

  /** Returns the report outcome, or null when it is not the report hour. */
  async monthlyReportIfDue(
    now = new Date(),
  ): Promise<'sent' | 'skipped' | 'failed' | null> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    if (!isMonthlyReportHour(now, timeZone)) return null;
    const month = previousMonth(now);
    try {
      const outcome = await this.reports.sendScheduled(month);
      this.logger.log(
        `Azure monthly cost report ${month}: ${outcome} (${timeZone})`,
      );
      return outcome;
    } catch (err) {
      this.logger.error(
        `Azure monthly cost report ${month} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  }
}
