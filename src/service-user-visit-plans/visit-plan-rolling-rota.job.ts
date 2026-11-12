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
import { CarerExtraHoursService } from '../employee-hours-approvals/carer-extra-hours.service';
import { EmployeeHoursApprovalsService } from '../employee-hours-approvals/employee-hours-approvals.service';
import { ServiceUserTimebankLedgerService } from '../service-user-hours/service-user-timebank-ledger.service';
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
    @Optional() private readonly carerExtraHours?: CarerExtraHoursService,
    @Optional() private readonly hoursApprovals?: EmployeeHoursApprovalsService,
    @Optional() private readonly timebankLedger?: ServiceUserTimebankLedgerService,
  ) {}

  /** Carer requests back within the weekly hours are approved (never fails the run). */
  private async approveCarerRequestsBackWithinLimit(): Promise<number> {
    if (!this.carerExtraHours) return 0;
    try {
      // Visit requests that can no longer happen move to Expired first.
      await this.hoursApprovals?.expireStaleRequests();
      // Timebank: visits cancelled, weeks that need less and finished weeks give their time back.
      await this.timebankLedger?.settleAll();
      return (await this.carerExtraHours.approveBackWithinLimit()).approved.length;
    } catch (err) {
      this.logger.warn(`Rolling rota: hours requests check failed: ${(err as Error).message}`);
      return 0;
    }
  }

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
    const weeklyHoursWarnings: string[] = [];

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
          { restoreDeletedJobs: false, source: 'rolling' },
        );
      } catch (error) {
        if (
          error instanceof BadRequestException &&
          /no active visit plans/i.test(error.message)
        ) {
          this.logger.log(
            'Rolling rota: no active visit plans — nothing to generate',
          );
          const hoursRequestsApproved = await this.approveCarerRequestsBackWithinLimit();
          return jobSkipped('No active visit plans', { ...base, hoursRequestsApproved });
        }
        throw error;
      }
      const totals = response.data.totals;
      visitsCreated += totals.visitsCreated;
      visitsSkipped += totals.visitsSkipped;
      visitsWithPatternWarnings += totals.visitsWithPatternWarnings;
      visitsWithRotaConflicts += totals.visitsWithRotaConflicts;
      weeklyHoursWarnings.push(...(totals.weeklyHoursWarnings ?? []));
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
    const hoursRequestsApproved = await this.approveCarerRequestsBackWithinLimit();
    // Plans over a service user's weekly contracted hours (Settings → Dom Rules decides warn or skip).
    for (const warning of [...new Set(weeklyHoursWarnings)].slice(0, MAX_LISTED)) {
      this.logger.warn(`Rolling rota: ${warning}`);
    }
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
      weeklyHoursWarnings: [...new Set(weeklyHoursWarnings)].slice(0, MAX_LISTED),
      hoursRequestsApproved,
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
