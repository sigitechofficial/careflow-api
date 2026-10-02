import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SurveysService } from './surveys.service';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSuccess, type JobOutcome } from '../jobs/job-run.types';

@Injectable()
export class SurveyDistributionJob {
  private readonly logger = new Logger(SurveyDistributionJob.name);

  constructor(
    private readonly surveys: SurveysService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  @Cron('* * * * *', { timeZone: 'UTC' })
  async handleDueDistributions(): Promise<void> {
    await runCronTick(this.jobRunner, 'survey-distribution', () =>
      this.runDueDistributions(),
    );
  }

  @JobHandler('survey-distribution')
  async runDueDistributions(): Promise<JobOutcome> {
    const results = await this.surveys.runDueDistributions();
    let distributed = 0;
    for (const r of results) {
      if (r.ok) {
        distributed += 1;
        this.logger.log(`Distributed survey ${r.surveyId}: ${r.detail}`);
      } else {
        this.logger.warn(`Survey ${r.surveyId} distribution skipped: ${r.detail}`);
      }
    }
    return jobSuccess({
      due: results.length,
      distributed,
      skipped: results.length - distributed,
    });
  }
}
