import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobHandler } from '../jobs/job-handler.registry';
import {
  JobRunner,
  isExternalCronMode,
  runCronTick,
} from '../jobs/job-runner.service';
import { jobSuccess, type JobOutcome } from '../jobs/job-run.types';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceUserOverCareService } from './service-user-over-care.service';
import {
  clampAutoExtendRotaRunHour,
  currentHourInTimeZone,
} from './visit-plan-rolling-rota.util';

/**
 * Over care reviews (Workforce › Over care reviews): once a day, last week's over care raises a
 * review request per service user and managers are notified (notification panel). Its own job since
 * 10 Nov 2026, so it runs whether or not "Extend rota automatically" is on. It runs after the daily
 * rota job: in-process at :30 of the organisation's "Run daily extension at" hour (the rota job runs
 * at :00), and in Azure (CRON_MODE=external) at 02:45 UTC, after rolling-rota at 02:00.
 */
@Injectable()
export class OverCareReviewJob {
  private readonly logger = new Logger(OverCareReviewJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly overCare: ServiceUserOverCareService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  /** CRON_MODE=internal only: hourly tick that runs the job once a day at the org's rota hour, :30. */
  @Cron('30 * * * *')
  async handleOverCareReviewTick(): Promise<void> {
    if (isExternalCronMode(this.jobRunner)) return;
    // The same settings row and hour the rota job reads (its on/off switch is not checked).
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { domAutoExtendRotaRunHour: true },
    });
    const runHour = clampAutoExtendRotaRunHour(
      settings?.domAutoExtendRotaRunHour ?? Number.NaN,
    );
    const timeZone = await this.orgSettings.getOperationalTimezone();
    if (currentHourInTimeZone(new Date(), timeZone) !== runHour) return;
    await runCronTick(this.jobRunner, 'over-care-review', () =>
      this.runOverCareReview(),
    );
  }

  @JobHandler('over-care-review')
  async runOverCareReview(): Promise<JobOutcome> {
    const result = await this.overCare.runWeekly();
    this.logger.log(`Over care reviews raised: ${result.raised}`);
    return jobSuccess({ raised: result.raised });
  }
}
