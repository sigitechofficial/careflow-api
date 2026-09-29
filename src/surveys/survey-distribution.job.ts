import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SurveysService } from './surveys.service';

@Injectable()
export class SurveyDistributionJob {
  private readonly logger = new Logger(SurveyDistributionJob.name);

  constructor(private readonly surveys: SurveysService) {}

  @Cron('* * * * *', { timeZone: 'UTC' })
  async handleDueDistributions(): Promise<void> {
    const results = await this.surveys.runDueDistributions();
    if (results.length === 0) return;
    for (const r of results) {
      if (r.ok) {
        this.logger.log(`Distributed survey ${r.surveyId}: ${r.detail}`);
      } else {
        this.logger.warn(`Survey ${r.surveyId} distribution skipped: ${r.detail}`);
      }
    }
  }
}
