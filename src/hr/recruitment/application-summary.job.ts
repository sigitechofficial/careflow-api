import { Injectable, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrganisationGeneralSettingsService } from '../../organisation-general-settings/organisation-general-settings.service';
import { hourInTimeZone } from '../../common/utils/operational-day.util';
import { JobHandler } from '../../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../../jobs/job-run.types';
import { ApplicationAlertsService, DAILY_SUMMARY_HOUR } from './application-alerts.service';

/**
 * Hourly check; in the 08:00 hour (organisation time) emails each hiring manager the day's applications for
 * vacancies set to "one summary a day". Each application goes in one summary only.
 */
@Injectable()
export class ApplicationSummaryJob {
  constructor(
    private readonly alerts: ApplicationAlertsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('40 * * * *')
  async handleApplicationSummary(): Promise<void> {
    await runCronTick(this.jobRunner, 'recruitment-application-summary', () => this.runApplicationSummary());
  }

  @JobHandler('recruitment-application-summary')
  async runApplicationSummary(): Promise<JobOutcome> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const hour = hourInTimeZone(new Date(), timeZone);
    if (hour !== DAILY_SUMMARY_HOUR) {
      return jobSkipped(`Summaries go out at ${String(DAILY_SUMMARY_HOUR).padStart(2, '0')}:00 (${timeZone})`, { hour });
    }
    return jobSuccess(await this.alerts.sendDailySummaries());
  }
}
