import { Injectable, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { hourInTimeZone } from '../common/utils/operational-day.util';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';
import { ComplianceExpiryRemindersService } from './compliance-expiry-reminders.service';

/**
 * Hourly check; from the reminder hour in Settings → Reviews & reminders (organisation time) sends
 * compliance and DBS expiry reminders. Later runs that day only pick up anything new, because each
 * stage is claimed once per record and expiry date.
 */
@Injectable()
export class ComplianceExpiryRemindersJob {
  constructor(
    private readonly reminders: ComplianceExpiryRemindersService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('20 * * * *')
  async handleComplianceExpiryReminders(): Promise<void> {
    await runCronTick(this.jobRunner, 'compliance-expiry-reminders', () => this.runComplianceExpiryReminders());
  }

  @JobHandler('compliance-expiry-reminders')
  async runComplianceExpiryReminders(): Promise<JobOutcome> {
    const [settings, timeZone] = await Promise.all([
      this.orgSettings.getReviewSettings(),
      this.orgSettings.getOperationalTimezone(),
    ]);
    if (!settings.complianceRemindersEnabled) {
      return jobSkipped('Compliance expiry reminders are turned off (Settings → Reviews & reminders)');
    }
    const hour = hourInTimeZone(new Date(), timeZone);
    if (hour < settings.reminderHour) {
      return jobSkipped(`Before the reminder time (${String(settings.reminderHour).padStart(2, '0')}:00 ${timeZone})`, {
        hour,
      });
    }
    return jobSuccess(await this.reminders.sendExpiryReminders());
  }
}
