import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SurveysService } from './surveys.service';
import { SurveyAlertsService } from './survey-alerts.service';
import { SurveyRemindersService } from './survey-reminders.service';
import { SurveyEventTriggersService } from './survey-event-triggers.service';
import { CqcSurveyEvidenceService } from '../cqc-evidence/cqc-survey-evidence.service';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSuccess, type JobOutcome } from '../jobs/job-run.types';

/**
 * Every minute: send due scheduled surveys and due periods of repeating surveys, close surveys and
 * periods whose end date has passed, write waiting unlinked answers (shuffled batches, or all
 * of a closed survey's), then keep closed surveys' results as CQC evidence.
 */
@Injectable()
export class SurveyDistributionJob {
  private readonly logger = new Logger(SurveyDistributionJob.name);

  constructor(
    private readonly surveys: SurveysService,
    @Optional() private readonly jobRunner?: JobRunner,
    @Optional() private readonly cqcEvidence?: CqcSurveyEvidenceService,
    @Optional() private readonly alerts?: SurveyAlertsService,
    @Optional() private readonly reminders?: SurveyRemindersService,
    @Optional() private readonly eventTriggers?: SurveyEventTriggersService,
  ) {}

  @Cron('* * * * *', { timeZone: 'UTC' })
  async handleDueDistributions(): Promise<void> {
    await runCronTick(this.jobRunner, 'survey-distribution', () => this.runDueDistributions());
  }

  @JobHandler('survey-distribution')
  async runDueDistributions(): Promise<JobOutcome> {
    const now = new Date();
    const results = await this.surveys.runDueDistributions(now);
    let distributed = 0;
    for (const r of results) {
      if (r.ok) {
        distributed += 1;
        this.logger.log(`Distributed survey ${r.surveyId}: ${r.detail}`);
      } else {
        this.logger.warn(`Survey ${r.surveyId} not distributed: ${r.detail}`);
      }
    }
    const surveysClosed = await this.surveys.closeSurveysPastEndDate(now);
    if (surveysClosed > 0) this.logger.log(`Closed ${surveysClosed} survey(s) and period(s) at their end date`);
    // Answers not linked to anyone: written in shuffled batches (or all, once closed) — before the
    // CQC capture below, so closed surveys' evidence includes them. Late answers written to a survey
    // already kept as evidence mark it to be captured again, which the capture below then does.
    const pending = await this.surveys.flushPendingResponses({ now }).catch((e: Error) => {
      this.logger.warn(`Waiting survey answers not written: ${e.message}`);
      return null;
    });
    // Alert rules: named answers missed at submit, and answers linked to no one once written out
    // above (grouped per survey, never one by one).
    const alerts = await this.alerts?.sweep().catch((e: Error) => {
      this.logger.warn('Survey alerts not checked: ' + e.name);
      return null;
    });
    // Events in the care records (before held-back people are sent, so a death recorded since stops them): deaths stop contact; new events are noted; due ones are checked and sent.
    const events = await this.eventTriggers?.run(now).catch((e: Error) => {
      this.logger.warn('Survey event sends not run: ' + e.name);
      return null;
    });
    // People held back by the 4-week rule whose free day has come (survey still open long enough).
    const held = await Promise.resolve()
      .then(() => this.surveys.releaseHeldBack(now))
      .catch((e: Error) => {
      this.logger.warn('Held-back survey invitations not sent: ' + e.name);
      return null;
    });
    // Reminders to people who have not answered (contact plans, outside quiet hours) and call lists.
    const reminders = await this.reminders?.runDue(now).catch((e: Error) => {
      this.logger.warn('Survey reminders not sent: ' + e.name);
      return null;
    });
    // Closed surveys and periods → CQC evidence (each close handled once).
    const cqc = await this.cqcEvidence?.captureRecentlyClosed(now).catch((e: Error) => {
      this.logger.warn(`CQC evidence capture failed: ${e.message}`);
      return null;
    });
    return jobSuccess({
      due: results.length,
      distributed,
      failed: results.length - distributed,
      surveysClosed,
      pendingResponsesWritten: pending?.written ?? 0,
      surveyAlertsRaised: (alerts?.named ?? 0) + (alerts?.grouped ?? 0),
      cqcEvidenceCaptured: cqc?.captured ?? 0,
      surveyRemindersSent: reminders?.reminded ?? 0,
      surveyHeldBackSent: held?.sent ?? 0,
      surveyCallListsStarted: reminders?.callTasks ?? 0,
      surveyEventsFound: events?.found ?? 0,
      surveyEventSends: events?.sent ?? 0,
      surveyContactStoppedAfterDeath: events?.stopped ?? 0,
    });
  }
}
