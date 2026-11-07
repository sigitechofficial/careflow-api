import { Injectable, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { hourInTimeZone } from '../common/utils/operational-day.util';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';
import { ServiceUserAssessmentsService } from './service-user-assessments.service';

/**
 * Hourly check; from the reminder hour in Settings → Reviews & reminders (organisation time) tells
 * key workers, named nurses and branch managers about assessment reviews coming due or overdue.
 * Later runs that day only pick up anything new, because each reminder is claimed once in
 * ReviewReminderLog.
 */
@Injectable()
export class AssessmentReviewRemindersJob {
  constructor(
    private readonly assessments: ServiceUserAssessmentsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('25 * * * *')
  async handleAssessmentReviewReminders(): Promise<void> {
    await runCronTick(this.jobRunner, 'assessment-review-reminders', () => this.runAssessmentReviewReminders());
  }

  @JobHandler('assessment-review-reminders')
  async runAssessmentReviewReminders(): Promise<JobOutcome> {
    const [settings, timeZone] = await Promise.all([
      this.orgSettings.getReviewSettings(),
      this.orgSettings.getOperationalTimezone(),
    ]);
    if (!settings.assessmentRemindersEnabled) {
      return jobSkipped('Assessment review reminders are turned off (Settings → Reviews & reminders)');
    }
    const hour = hourInTimeZone(new Date(), timeZone);
    if (hour < settings.reminderHour) {
      return jobSkipped(`Before the reminder time (${String(settings.reminderHour).padStart(2, '0')}:00 ${timeZone})`, {
        hour,
      });
    }
    const { data } = await this.assessments.sendReviewReminders({});
    return jobSuccess({ sent: data.sent, alreadySent: data.alreadySent, skipped: data.skipped, due: data.queueTotal });
  }
}
