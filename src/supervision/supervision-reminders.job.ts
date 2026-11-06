import { Injectable, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { hourInTimeZone } from '../common/utils/operational-day.util';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';
import { SupervisionRemindersService } from './supervision-reminders.service';

/**
 * Hourly check; sends supervision-due reminders from the configured hour (Settings → Supervision →
 * Reminders, organisation time). Later runs that day only pick up anything new or missed, because
 * every reminder is logged once per due date.
 */
@Injectable()
export class SupervisionRemindersJob {
  constructor(
    private readonly reminders: SupervisionRemindersService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('10 * * * *')
  async handleSupervisionReminders(): Promise<void> {
    await runCronTick(this.jobRunner, 'supervision-reminders', () => this.runSupervisionReminders());
  }

  @JobHandler('supervision-reminders')
  async runSupervisionReminders(): Promise<JobOutcome> {
    const [settings, timeZone] = await Promise.all([
      this.orgSettings.getSupervisionSettings(),
      this.orgSettings.getOperationalTimezone(),
    ]);
    if (!settings.remindersEnabled) {
      return jobSkipped('Supervision reminders are turned off (Settings → Supervision)');
    }
    const hour = hourInTimeZone(new Date(), timeZone);
    if (hour < settings.reminderHour) {
      return jobSkipped(`Before the reminder time (${String(settings.reminderHour).padStart(2, '0')}:00 ${timeZone})`, {
        hour,
      });
    }
    return jobSuccess(await this.reminders.sendDueReminders());
  }
}
