import { Injectable, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { hourInTimeZone } from '../common/utils/operational-day.util';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';
import { PolicyAcknowledgementNotificationsService } from './policy-acknowledgement-notifications.service';

/**
 * Hourly check; from the reminder hour in Settings → Reviews & reminders (organisation time) reminds
 * staff about policies to read and acknowledge (3 days before, on the due date, 1 day overdue, then
 * weekly) and sends managers the weekly overdue summary. Later runs that day only pick up anything
 * new, because each reminder is claimed once in the acknowledgement row.
 */
@Injectable()
export class PolicyAcknowledgementRemindersJob {
  constructor(
    private readonly reminders: PolicyAcknowledgementNotificationsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('35 * * * *')
  async handlePolicyAcknowledgementReminders(): Promise<void> {
    await runCronTick(this.jobRunner, 'policy-acknowledgement-reminders', () =>
      this.runPolicyAcknowledgementReminders(),
    );
  }

  @JobHandler('policy-acknowledgement-reminders')
  async runPolicyAcknowledgementReminders(): Promise<JobOutcome> {
    const [settings, timeZone] = await Promise.all([
      this.orgSettings.getReviewSettings(),
      this.orgSettings.getOperationalTimezone(),
    ]);
    const hour = hourInTimeZone(new Date(), timeZone);
    if (hour < settings.reminderHour) {
      return jobSkipped(`Before the reminder time (${String(settings.reminderHour).padStart(2, '0')}:00 ${timeZone})`, {
        hour,
      });
    }
    return jobSuccess(await this.reminders.sendDueReminders());
  }
}
