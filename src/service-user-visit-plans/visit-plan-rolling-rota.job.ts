import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { VisitPlanBulkScheduleService } from './visit-plan-bulk-schedule.service';
import {
  clampAutoExtendRotaRunHour,
  clampRotaHorizonDays,
  currentHourInTimeZone,
  operationalRotaTodayIsoDate,
  parseRotaHorizonMode,
} from './visit-plan-rolling-rota.util';
import {
  chunkIsoDateRange,
  resolveRollingRotaCatchUpWindow,
  summarisePlanResults,
  type RotaPlanResult,
} from './visit-plan-rolling-rota-catchup.util';
import { JobHandler } from '../jobs/job-handler.registry';
import {
  JobRunner,
  isExternalCronMode,
  runCronTick,
} from '../jobs/job-runner.service';
import {
  JobFailedWithSummaryError,
  jobSkipped,
  jobSuccess,
  type JobOutcome,
} from '../jobs/job-run.types';

const MAX_LISTED = 20;

@Injectable()
export class VisitPlanRollingRotaJob {
  private readonly logger = new Logger(VisitPlanRollingRotaJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bulkSchedule: VisitPlanBulkScheduleService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  /**
   * CRON_MODE=internal only: hourly UTC tick that runs the catch-up once a day at the
   * configured org-timezone hour. In CRON_MODE=external the Container Apps Job runs it nightly.
   */
  @Cron('0 * * * *')
  async handleRollingRotaExtension(): Promise<void> {
    if (isExternalCronMode(this.jobRunner)) return;
    const settings = await this.loadSettings();
    if (!settings?.domAutoExtendRotaEnabled) return;

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const runHour = clampAutoExtendRotaRunHour(
      settings.domAutoExtendRotaRunHour,
    );
    if (currentHourInTimeZone(new Date(), timeZone) !== runHour) return;

    await runCronTick(this.jobRunner, 'rolling-rota', () => this.runCatchUp());
  }

  /** One rolling rota run: generate every missing visit from today to the horizon edge. */
  @JobHandler('rolling-rota')
  async runCatchUp(now = new Date()): Promise<JobOutcome> {
    const settings = await this.loadSettings();
    if (!settings?.domAutoExtendRotaEnabled) {
      return jobSkipped(
        'Auto-extend rota is turned off in organisation settings',
      );
    }

    const systemUser = await this.prisma.user.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!systemUser) {
      this.logger.warn('Rolling rota job skipped — no active user for audit');
      return jobSkipped('No active user for audit');
    }

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalRotaTodayIsoDate(now, timeZone);
    const mode = parseRotaHorizonMode(settings.domRotaHorizonMode);
    const horizonDays = clampRotaHorizonDays(settings.domRotaHorizonDays);
    const window = resolveRollingRotaCatchUpWindow(today, mode, horizonDays);
    const chunks = chunkIsoDateRange(window.fromDate, window.toDate);
    const base = {
      timeZone,
      mode,
      horizonDays,
      fromDate: window.fromDate,
      toDate: window.toDate,
      chunks: chunks.length,
    };

    let visitsCreated = 0;
    let visitsSkipped = 0;
    let visitsWithPatternWarnings = 0;
    let visitsWithRotaConflicts = 0;
    const planResults: RotaPlanResult[] = [];

    for (const chunk of chunks) {
      let response: Awaited<
        ReturnType<VisitPlanBulkScheduleService['bulkGenerate']>
      >;
      try {
        response = await this.bulkSchedule.bulkGenerate(
          systemUser.id,
          {
            fromDate: chunk.fromDate,
            toDate: chunk.toDate,
            readyOnly: true,
          },
          undefined,
          // Nightly catch-up never brings back visits the office deleted.
          { restoreDeletedJobs: false },
        );
      } catch (error) {
        if (
          error instanceof BadRequestException &&
          /no active visit plans/i.test(error.message)
        ) {
          this.logger.log(
            'Rolling rota: no active visit plans — nothing to generate',
          );
          return jobSkipped('No active visit plans', base);
        }
        throw error;
      }
      const totals = response.data.totals;
      visitsCreated += totals.visitsCreated;
      visitsSkipped += totals.visitsSkipped;
      visitsWithPatternWarnings += totals.visitsWithPatternWarnings;
      visitsWithRotaConflicts += totals.visitsWithRotaConflicts;
      for (const r of response.data.results) {
        planResults.push({
          planId: r.planId,
          status: r.status,
          error: r.error,
          skipReason: r.skipReason,
        });
      }
    }

    const plans = summarisePlanResults(planResults);
    this.logger.log(
      `Rolling rota ${window.fromDate}..${window.toDate} (${mode}, horizon ${horizonDays}d, tz ${timeZone}): ` +
        `${visitsCreated} created, ${visitsSkipped} skipped, ${plans.succeeded} plans ok, ` +
        `${plans.failed} failed, ${plans.skipped} skipped plans`,
    );

    const resultSummary = {
      ...base,
      visitsCreated,
      visitsSkipped,
      visitsWithPatternWarnings,
      visitsWithRotaConflicts,
      plans: {
        processed: plans.processed,
        succeeded: plans.succeeded,
        failed: plans.failed,
        skipped: plans.skipped,
      },
      failedPlans: plans.failures.slice(0, MAX_LISTED),
    };
    if (plans.failed > 0) {
      // Visits for the other plans are kept; failing the run raises the alert and lets the
      // next trigger retry the period (already-generated visits are skipped).
      throw new JobFailedWithSummaryError(
        `${plans.failed} visit plan(s) failed to generate`,
        resultSummary,
      );
    }
    return jobSuccess(resultSummary);
  }

  private loadSettings() {
    return this.prisma.organisationGeneralSettings.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: {
        domAutoExtendRotaEnabled: true,
        domRotaHorizonDays: true,
        domRotaHorizonMode: true,
        domAutoExtendRotaRunHour: true,
      },
    });
  }
}
