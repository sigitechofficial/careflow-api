import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformCostsAzureGateway } from './platform-costs-azure.gateway';
import { PlatformCostsDataService } from './platform-costs-data.service';
import { PlatformCostsAnomalyService } from './platform-costs-anomaly.service';
import {
  addMonths,
  isoDate,
  linearMonthEndForecast,
  monthEnd,
  monthOf,
  monthStart,
  parseIsoDate,
  sumCost,
} from './platform-costs-aggregation.util';
import {
  retailPriceFilters,
  retailPriceKey,
  type RetailPriceItem,
} from './azure/azure-retail-prices.client';
import {
  MANUAL_SYNC_WINDOW_MS,
  STALE_RUNNING_MS,
  type SyncKind,
  type SyncTrigger,
} from './platform-costs.constants';

/** Seconds until another manual sync is allowed (0 = allowed now). */
export function manualSyncRetryAfterSeconds(
  lastManualStartedAt: Date | null,
  now: Date = new Date(),
  windowMs: number = MANUAL_SYNC_WINDOW_MS,
): number {
  if (!lastManualStartedAt) return 0;
  const remaining = lastManualStartedAt.getTime() + windowMs - now.getTime();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

type RunResult = { rows: number };

/**
 * Pulls data from Azure (read-only) into the `platform` schema. Every run writes an
 * AzureSyncRun row; failures are recorded there and logged, never thrown into the scheduler.
 *
 * TODO(job-lock): single replica today. With >1 API replica, guard the scheduled runs with a
 * Postgres advisory lock (pg_try_advisory_lock) so only one replica syncs.
 */
@Injectable()
export class PlatformCostsSyncService {
  private readonly logger = new Logger(PlatformCostsSyncService.name);
  private readonly inFlight = new Set<SyncKind>();
  private manualInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly azure: PlatformCostsAzureGateway,
    private readonly data: PlatformCostsDataService,
    private readonly anomalies: PlatformCostsAnomalyService,
  ) {}

  get enabled(): boolean {
    return this.azure.enabled;
  }

  /** Mark "running" rows left behind by a restart as failed so they don't block anything. */
  async failAbandonedRuns(now = new Date()): Promise<number> {
    const res = await this.prisma.azureSyncRun.updateMany({
      where: {
        status: 'running',
        startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) },
      },
      data: {
        status: 'failed',
        finishedAt: now,
        error: 'Abandoned (process stopped during sync)',
      },
    });
    return res.count;
  }

  /** True when there is no successful run of `kind` within `intervalMs`. */
  async isDue(
    kind: SyncKind,
    intervalMs: number,
    now = new Date(),
  ): Promise<boolean> {
    const last = await this.data.lastSuccess(kind);
    return !last || now.getTime() - last.getTime() >= intervalMs;
  }

  private async createRun(
    kind: SyncKind,
    trigger: SyncTrigger,
    userId?: string | null,
  ) {
    return this.prisma.azureSyncRun.create({
      data: {
        kind,
        trigger,
        status: 'running',
        triggeredById: userId ?? undefined,
      },
      select: { id: true },
    });
  }

  /** Execute one sync kind inside a sync-run row. Never throws. */
  async run(
    kind: SyncKind,
    trigger: SyncTrigger,
    userId?: string | null,
    existingRunId?: string,
  ): Promise<{ runId: string; status: 'success' | 'failed'; error?: string }> {
    const runId =
      existingRunId ?? (await this.createRun(kind, trigger, userId)).id;
    if (this.inFlight.has(kind)) {
      await this.finishRun(
        runId,
        'failed',
        0,
        `A ${kind} sync is already running`,
      );
      return { runId, status: 'failed', error: 'already running' };
    }
    this.inFlight.add(kind);
    try {
      const { rows } = await this.execute(kind);
      await this.finishRun(runId, 'success', rows, null);
      return { runId, status: 'success' };
    } catch (err) {
      const message = this.safeError(err);
      this.logger.error(`Azure ${kind} sync failed: ${message}`);
      await this.finishRun(runId, 'failed', 0, message).catch(() => undefined);
      return { runId, status: 'failed', error: message };
    } finally {
      this.inFlight.delete(kind);
    }
  }

  private async finishRun(
    id: string,
    status: 'success' | 'failed',
    rows: number,
    error: string | null,
  ) {
    await this.prisma.azureSyncRun.update({
      where: { id },
      data: { status, finishedAt: new Date(), rowsUpserted: rows, error },
    });
  }

  private safeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    // Never persist bearer tokens or long payloads.
    return raw
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
      .slice(0, 1000);
  }

  private async execute(kind: SyncKind): Promise<RunResult> {
    if (!this.enabled)
      throw new Error('Azure cost sync is disabled (AZURE_COST_ENABLED=false)');
    const cfg = this.azure.settings;
    if (!cfg.scope)
      throw new Error(
        'AZURE_COST_SUBSCRIPTION_ID / AZURE_COST_SCOPE is not configured',
      );
    switch (kind) {
      case 'costs':
        return this.syncCosts();
      case 'forecast':
        return this.syncForecast();
      case 'budgets':
        return this.syncBudgets();
      case 'prices':
        return this.syncPrices();
      case 'advisor':
        return this.syncAdvisor();
      default:
        throw new Error(`Unknown sync kind ${String(kind)}`);
    }
  }

  /** Daily cost rows for the previous + current month (replace-in-window = upsert + corrections). */
  async syncCosts(now = new Date()): Promise<RunResult> {
    const cfg = this.azure.settings;
    const month = monthOf(now);
    const from = monthStart(addMonths(month, -1));
    const to = isoDate(now);
    const rows = await this.azure
      .costManagement()
      .queryDailyCosts(cfg.scope, from, to, cfg.resourceGroups);

    await this.prisma.$transaction(
      async (tx) => {
        await tx.azureCostDaily.deleteMany({
          where: { date: { gte: parseIsoDate(from), lte: parseIsoDate(to) } },
        });
        if (rows.length) {
          await tx.azureCostDaily.createMany({
            data: rows.map((r) => ({
              date: parseIsoDate(r.date),
              resourceGroup: r.resourceGroup,
              serviceName: r.serviceName,
              resourceId: r.resourceId,
              meterCategory: r.meterCategory,
              cost: new Prisma.Decimal(r.cost.toFixed(6)),
              currency: r.currency,
            })),
            skipDuplicates: true,
          });
        }
      },
      { timeout: 60_000 },
    );
    return { rows: rows.length };
  }

  async syncForecast(now = new Date()): Promise<RunResult> {
    const cfg = this.azure.settings;
    const month = monthOf(now);
    let source: 'azure' | 'linear' = 'azure';
    let actual = 0;
    let total = 0;
    const result = await this.azure
      .costManagement()
      .forecast(
        cfg.scope,
        monthStart(month),
        monthEnd(month),
        cfg.resourceGroups,
      );
    if (result.hasForecastRows) {
      actual = result.actualToDate;
      total = result.forecastTotal;
    } else {
      // Not enough history for Azure's model yet — project from our stored daily rows.
      source = 'linear';
      const rows = await this.data.loadRows(
        monthStart(addMonths(month, -1)),
        monthEnd(month),
      );
      const through = await this.data.dataThrough();
      actual = sumCost(rows.filter((r) => monthOf(r.date) === month));
      total = linearMonthEndForecast(rows, month, through);
    }
    await this.prisma.azureForecastSnapshot.create({
      data: {
        month,
        actualToDate: new Prisma.Decimal(actual.toFixed(6)),
        forecastTotal: new Prisma.Decimal(total.toFixed(6)),
        source,
        currency: result.currency ?? cfg.currency,
      },
    });
    return { rows: 1 };
  }

  async syncBudgets(): Promise<RunResult> {
    const cfg = this.azure.settings;
    const subId = this.azure.subscriptionId();
    if (!subId) throw new Error('Subscription id is not configured');
    const budgets = await this.azure
      .costManagement()
      .listBudgets(subId, cfg.resourceGroups);
    const capturedAt = new Date();
    if (budgets.length) {
      await this.prisma.azureBudgetSnapshot.createMany({
        data: budgets.map((b) => ({
          budgetId: b.budgetId,
          name: b.name,
          amount: new Prisma.Decimal(b.amount.toFixed(2)),
          timeGrain: b.timeGrain,
          currentSpend: new Prisma.Decimal(b.currentSpend.toFixed(6)),
          forecastSpend:
            b.forecastSpend === null
              ? null
              : new Prisma.Decimal(b.forecastSpend.toFixed(6)),
          currency: b.currency ?? cfg.currency,
          thresholds: b.thresholds,
          periodStart: b.periodStart ? parseIsoDate(b.periodStart) : null,
          periodEnd: b.periodEnd ? parseIsoDate(b.periodEnd) : null,
          capturedAt,
        })),
      });
    }
    // Keep 90 days of snapshots.
    await this.prisma.azureBudgetSnapshot.deleteMany({
      where: {
        capturedAt: { lt: new Date(capturedAt.getTime() - 90 * 86_400_000) },
      },
    });
    await this.prisma.azureForecastSnapshot.deleteMany({
      where: {
        capturedAt: { lt: new Date(capturedAt.getTime() - 400 * 86_400_000) },
      },
    });
    return { rows: budgets.length };
  }

  async syncPrices(): Promise<RunResult> {
    const cfg = this.azure.settings;
    const client = this.azure.retailPrices();
    const byKey = new Map<string, RetailPriceItem>();
    for (const filter of retailPriceFilters(cfg.region)) {
      const items = await client.fetchAll(cfg.currency, filter);
      for (const item of items) byKey.set(retailPriceKey(item), item);
    }
    if (!byKey.size)
      throw new Error(
        'Retail Prices API returned no items; keeping the previous catalogue',
      );
    const refreshedAt = new Date();
    const data = [...byKey.entries()].map(([priceKey, i]) => ({
      priceKey,
      meterId: i.meterId,
      skuId: i.skuId ?? null,
      serviceName: i.serviceName,
      serviceFamily: i.serviceFamily ?? null,
      productName: i.productName,
      skuName: i.skuName,
      armSkuName: i.armSkuName || null,
      meterName: i.meterName,
      unitOfMeasure: i.unitOfMeasure,
      unitPrice: new Prisma.Decimal(String(i.unitPrice ?? 0)),
      retailPrice: new Prisma.Decimal(String(i.retailPrice ?? 0)),
      tierMinimumUnits: new Prisma.Decimal(String(i.tierMinimumUnits ?? 0)),
      currency: i.currencyCode || cfg.currency,
      armRegionName: i.armRegionName ?? '',
      location: i.location ?? null,
      type: i.type,
      isPrimaryMeterRegion: i.isPrimaryMeterRegion ?? null,
      effectiveStartDate: i.effectiveStartDate
        ? new Date(i.effectiveStartDate)
        : null,
      refreshedAt,
    }));
    await this.prisma.$transaction(
      async (tx) => {
        await tx.azureRetailPrice.deleteMany({
          where: { currency: cfg.currency },
        });
        await tx.azureRetailPrice.createMany({ data, skipDuplicates: true });
      },
      { timeout: 60_000 },
    );
    return { rows: data.length };
  }

  async syncAdvisor(): Promise<RunResult> {
    const subId = this.azure.subscriptionId();
    if (!subId) throw new Error('Subscription id is not configured');
    const recs = await this.azure
      .costManagement()
      .listCostRecommendations(subId);
    const refreshedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.azureAdvisorRecommendation.deleteMany({});
      if (recs.length) {
        await tx.azureAdvisorRecommendation.createMany({
          data: recs
            .filter((r) => r.recommendationId)
            .map((r) => ({
              recommendationId: r.recommendationId,
              impact: r.impact,
              problem: r.problem,
              solution: r.solution,
              resourceId: r.resourceId,
              resourceName: r.resourceName,
              annualSavings:
                r.annualSavings === null
                  ? null
                  : new Prisma.Decimal(r.annualSavings.toFixed(2)),
              currency: r.currency,
              refreshedAt,
            })),
          skipDuplicates: true,
        });
      }
    });
    return { rows: recs.length };
  }

  /** costs → forecast → budgets → anomaly check (the 6-hourly pipeline). */
  async runCostsPipeline(
    trigger: SyncTrigger,
    userId?: string | null,
    costsRunId?: string,
  ) {
    const costs = await this.run('costs', trigger, userId, costsRunId);
    await this.run('forecast', trigger, userId);
    await this.run('budgets', trigger, userId);
    if (costs.status === 'success') {
      try {
        await this.anomalies.detectAndNotify();
      } catch (err) {
        this.logger.error(`Anomaly detection failed: ${this.safeError(err)}`);
      }
    }
    return costs;
  }

  /**
   * Manual "sync now": every kind, at most once per 5 minutes (checked against persisted
   * manual sync runs, so the limit survives restarts). Returns immediately; poll /sync-runs.
   */
  async triggerManualSync(
    userId: string,
  ): Promise<{ runId: string; status: string }> {
    if (!this.enabled) {
      throw new ConflictException(
        'Azure cost sync is disabled. Set AZURE_COST_ENABLED=true on the API to enable it.',
      );
    }
    if (this.manualInFlight) {
      throw new HttpException(
        'A manual sync is already in progress. Please wait for it to finish.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.manualInFlight = true;
    let costsRunId: string;
    try {
      const last = await this.prisma.azureSyncRun.findFirst({
        where: { trigger: 'manual' },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });
      const retryAfter = manualSyncRetryAfterSeconds(last?.startedAt ?? null);
      if (retryAfter > 0) {
        throw new HttpException(
          `Manual sync is limited to once every 5 minutes. Try again in ${retryAfter} seconds.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      costsRunId = (await this.createRun('costs', 'manual', userId)).id;
    } catch (err) {
      this.manualInFlight = false;
      throw err;
    }

    void (async () => {
      try {
        await this.runCostsPipeline('manual', userId, costsRunId);
        await this.run('prices', 'manual', userId);
        await this.run('advisor', 'manual', userId);
      } catch (err) {
        this.logger.error(`Manual Azure sync failed: ${this.safeError(err)}`);
      } finally {
        this.manualInFlight = false;
      }
    })();

    return { runId: costsRunId, status: 'running' };
  }
}
