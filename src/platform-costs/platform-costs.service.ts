import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExportType, Prisma, ScheduledVisitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PlatformCostsAzureGateway } from './platform-costs-azure.gateway';
import { PlatformCostsDataService } from './platform-costs-data.service';
import {
  addDays,
  addMonths,
  compareWithLastMonth,
  dailySeries,
  dailySeriesByGroup,
  daysBetweenInclusive,
  filterRange,
  groupCosts,
  isoDate,
  monthEnd,
  monthOf,
  monthStart,
  parseIsoDate,
  round2,
  sumCost,
  toCsv,
  whisperSpend,
} from './platform-costs-aggregation.util';
import {
  BASELINE_INPUT,
  PriceBook,
  estimateMonthly,
  isEstimatorMeter,
  type EstimateInput,
  type PriceRow,
} from './platform-costs-estimator';
import type {
  AnomaliesQueryDto,
  CostBreakdownQueryDto,
  EstimateRequestDto,
  PricesQueryDto,
  UpdatePlatformCostSettingsDto,
} from './dto/platform-costs.dto';
import { SETTINGS_ID, type CostGroupBy } from './platform-costs.constants';

export const MAX_RANGE_DAYS = 400;

/** Null when the divisor is 0 (contract). */
export function perUnit(total: number, count: number): number | null {
  return count > 0 ? round2(total / count) : null;
}

/** Read side of Azure Pricing — always answers from the database, never from Azure. */
@Injectable()
export class PlatformCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly azure: PlatformCostsAzureGateway,
    private readonly data: PlatformCostsDataService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private get currency(): string {
    return this.azure.settings.currency;
  }

  private async envelope() {
    const [lastSynced, dataThrough] = await Promise.all([
      this.data.lastSuccess('costs'),
      this.data.dataThrough(),
    ]);
    return {
      enabled: this.azure.enabled,
      currency: this.currency,
      lastSyncedAt: lastSynced ? lastSynced.toISOString() : null,
      dataThrough,
    };
  }

  // ── Overview ────────────────────────────────────────────────────────────────
  async overview(now = new Date()) {
    const env = await this.envelope();
    const month = monthOf(now);
    const today = isoDate(now);
    const trendTo =
      env.dataThrough && env.dataThrough > today ? env.dataThrough : today;
    const trendFrom = addDays(trendTo, -29);
    const rangeFrom = [monthStart(addMonths(month, -1)), trendFrom].sort()[0];
    const rows = await this.data.loadRows(rangeFrom, monthEnd(month));
    const monthRows = filterRange(rows, monthStart(month), monthEnd(month));
    const cmp = compareWithLastMonth(rows, month, env.dataThrough);
    const forecast = await this.data.forecastMonthEnd(
      month,
      rows,
      env.dataThrough,
    );
    const budget = await this.data.budgetView(cmp.monthToDate, forecast.total);
    const openAnomalies = await this.prisma.azureCostAnomaly.count({
      where: { status: 'open' },
    });

    return {
      ...env,
      monthToDate: cmp.monthToDate,
      forecastMonthEnd: forecast.total,
      forecastSource: forecast.source,
      lastMonthTotal: cmp.lastMonthTotal,
      lastMonthSamePeriod: cmp.lastMonthSamePeriod,
      changeVsLastMonthPercent: cmp.changeVsLastMonthPercent,
      budget,
      dailyTrend: dailySeries(rows, trendFrom, trendTo),
      byService: groupCosts(monthRows, 'service').map(
        ({ key, label, cost, share }) => ({
          key,
          label,
          cost,
          share,
        }),
      ),
      topResources: groupCosts(monthRows, 'resource')
        .slice(0, 10)
        .map((r) => ({
          key: r.key,
          label: r.label,
          resourceGroup: r.resourceGroup ?? '',
          service: r.service ?? '',
          cost: r.cost,
          share: r.share,
        })),
      openAnomalies,
      whisper: whisperSpend(rows, month),
    };
  }

  // ── Breakdown / export ──────────────────────────────────────────────────────
  resolveRange(q: CostBreakdownQueryDto, now = new Date()) {
    const month = monthOf(now);
    const from = q.from ?? monthStart(month);
    const to = q.to ?? (q.from ? monthEnd(monthOf(q.from)) : isoDate(now));
    if (from > to)
      throw new BadRequestException('from must be on or before to');
    if (daysBetweenInclusive(from, to) > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range cannot exceed ${MAX_RANGE_DAYS} days`,
      );
    }
    const groupBy: CostGroupBy = q.groupBy ?? 'service';
    return { from, to, groupBy };
  }

  async breakdown(q: CostBreakdownQueryDto) {
    const { from, to, groupBy } = this.resolveRange(q);
    const env = await this.envelope();
    const rows = await this.data.loadRows(from, to);
    return {
      currency: env.currency,
      from,
      to,
      groupBy,
      total: round2(sumCost(rows)),
      rows: groupCosts(rows, groupBy),
      daily: dailySeriesByGroup(rows, from, to, groupBy),
      lastSyncedAt: env.lastSyncedAt,
      dataThrough: env.dataThrough,
      enabled: env.enabled,
    };
  }

  async exportCsv(
    q: CostBreakdownQueryDto,
    userId: string,
    meta: RequestAuditMeta,
  ) {
    const { from, to, groupBy } = this.resolveRange(q);
    const rows = await this.data.loadRows(from, to);
    const grouped = groupCosts(rows, groupBy);
    const header =
      groupBy === 'resource'
        ? [
            'resourceId',
            'resourceName',
            'resourceGroup',
            'service',
            `cost_${this.currency}`,
            'sharePercent',
          ]
        : [groupBy, `cost_${this.currency}`, 'sharePercent'];
    const body = grouped.map((r) =>
      groupBy === 'resource'
        ? [
            r.key,
            r.label,
            r.resourceGroup ?? '',
            r.service ?? '',
            r.cost,
            r.share,
          ]
        : [r.label, r.cost, r.share],
    );
    body.push(
      groupBy === 'resource'
        ? ['TOTAL', '', '', '', round2(sumCost(rows)), 100]
        : ['TOTAL', round2(sumCost(rows)), 100],
    );
    const csv = toCsv(header, body);
    const filename = `azure-costs_${groupBy}_${from}_${to}.csv`;

    await this.auditLogs.logExport({
      userId,
      module: AuditModule.PLATFORM_COSTS,
      exportType: ExportType.CSV,
      filters: { from, to, groupBy },
      fileName: filename,
      recordCount: grouped.length,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.PLATFORM_COSTS,
      action: 'platform_costs_csv_exported',
      recordType: 'AzureCostDaily',
      description: `Exported Azure costs by ${groupBy} (${from} → ${to})`,
      metadata: { from, to, groupBy, rows: grouped.length },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { csv, filename };
  }

  // ── Prices ──────────────────────────────────────────────────────────────────
  private async usedServiceNames(): Promise<Set<string>> {
    const since = parseIsoDate(addDays(isoDate(new Date()), -90));
    const svc = await this.prisma.azureCostDaily.findMany({
      where: { date: { gte: since } },
      distinct: ['serviceName'],
      select: { serviceName: true },
    });
    return new Set(svc.map((s) => s.serviceName.toLowerCase()));
  }

  async prices(q: PricesQueryDto) {
    const where: Prisma.AzureRetailPriceWhereInput = {
      currency: this.currency,
    };
    if (q.service)
      where.serviceName = { equals: q.service, mode: 'insensitive' };
    const [rows, used, refreshed] = await Promise.all([
      this.prisma.azureRetailPrice.findMany({
        where,
        orderBy: [
          { serviceName: 'asc' },
          { productName: 'asc' },
          { skuName: 'asc' },
          { meterName: 'asc' },
          { tierMinimumUnits: 'asc' },
        ],
      }),
      this.usedServiceNames(),
      this.data.lastSuccess('prices'),
    ]);
    const items = rows
      .map((r) => ({
        id: r.id,
        serviceName: r.serviceName,
        productName: r.productName,
        skuName: r.skuName,
        meterName: r.meterName,
        unitOfMeasure: r.unitOfMeasure,
        unitPrice: r.unitPrice.toNumber(),
        retailPrice: r.retailPrice.toNumber(),
        armRegionName: r.armRegionName,
        effectiveStartDate: r.effectiveStartDate
          ? isoDate(r.effectiveStartDate)
          : null,
        type: r.type,
        tierMinimumUnits: r.tierMinimumUnits.toNumber(),
        // Service billed to us in the last 90 days, or a meter the estimator prices for our
        // architecture (covers services fully inside a free grant, e.g. Container Apps).
        usedByUs:
          used.has(r.serviceName.toLowerCase()) ||
          isEstimatorMeter(r, this.azure.settings.region),
      }))
      .filter((i) => !q.usedOnly || i.usedByUs);
    return {
      currency: this.currency,
      region: this.azure.settings.region,
      refreshedAt: refreshed ? refreshed.toISOString() : null,
      items,
    };
  }

  // ── Estimator ───────────────────────────────────────────────────────────────
  private async priceBook(): Promise<PriceBook> {
    const rows = await this.prisma.azureRetailPrice.findMany({
      where: { currency: this.currency, type: 'Consumption' },
      select: {
        serviceName: true,
        productName: true,
        skuName: true,
        meterName: true,
        unitOfMeasure: true,
        retailPrice: true,
        tierMinimumUnits: true,
        armRegionName: true,
      },
    });
    const priceRows: PriceRow[] = rows.map((r) => ({
      ...r,
      retailPrice: r.retailPrice.toNumber(),
      tierMinimumUnits: r.tierMinimumUnits.toNumber(),
    }));
    return new PriceBook(priceRows, this.azure.settings.region);
  }

  async baselineEstimate() {
    const book = await this.priceBook();
    const est = estimateMonthly(BASELINE_INPUT, book);
    return {
      currency: this.currency,
      inputs: { ...BASELINE_INPUT },
      monthlyTotal: est.monthlyTotal,
      lines: est.lines,
      assumptions: est.assumptions,
    };
  }

  async scenarioEstimate(dto: EstimateRequestDto) {
    const input: EstimateInput = { ...BASELINE_INPUT };
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined && v !== null && k in input)
        (input as Record<string, unknown>)[k] = v;
    }
    const baseline = estimateMonthly(BASELINE_INPUT, await this.priceBook());
    const scenario = estimateMonthly(input, await this.priceBook());
    const lines = scenario.lines.map((s) => {
      const b = baseline.lines.find((l) => l.key === s.key);
      const base = b?.monthly ?? 0;
      return {
        key: s.key,
        label: s.label,
        baseline: base,
        scenario: s.monthly,
        difference: round2(s.monthly - base),
        note: s.note,
      };
    });
    return {
      currency: this.currency,
      baselineMonthly: baseline.monthlyTotal,
      scenarioMonthly: scenario.monthlyTotal,
      difference: round2(scenario.monthlyTotal - baseline.monthlyTotal),
      lines,
      assumptions: scenario.assumptions,
    };
  }

  // ── Recommendations ─────────────────────────────────────────────────────────
  async recommendations() {
    const [rows, refreshed] = await Promise.all([
      this.prisma.azureAdvisorRecommendation.findMany({
        orderBy: [{ annualSavings: 'desc' }],
      }),
      this.data.lastSuccess('advisor'),
    ]);
    const rank = (i: string) =>
      ({ high: 0, medium: 1, low: 2 })[i.toLowerCase()] ?? 3;
    return {
      refreshedAt: refreshed ? refreshed.toISOString() : null,
      items: rows
        .map((r) => ({
          id: r.id,
          impact: r.impact,
          problem: r.problem,
          solution: r.solution,
          resourceId: r.resourceId,
          resourceName: r.resourceName,
          annualSavings: r.annualSavings
            ? round2(r.annualSavings.toNumber())
            : null,
          currency: r.currency ?? this.currency,
        }))
        .sort((a, b) => rank(a.impact) - rank(b.impact)),
    };
  }

  // ── Unit economics ──────────────────────────────────────────────────────────
  /**
   * Business volumes for a calendar month (UTC):
   * - active service users: not deleted, isActive, service started on/before month end and
   *   not ended/deceased before month start;
   * - active carers: employees not deleted, isActive, employment not started after month end
   *   and not ended before month start;
   * - completed visits: ScheduledVisit status COMPLETED with scheduled start in the month.
   */
  async businessVolumes(month: string) {
    const start = parseIsoDate(monthStart(month));
    const endExclusive = parseIsoDate(monthStart(addMonths(month, 1)));
    const [activeServiceUsers, activeCarers, completedVisits] =
      await Promise.all([
        this.prisma.serviceUser.count({
          where: {
            deletedAt: null,
            isActive: true,
            AND: [
              {
                OR: [
                  { serviceStartDate: null },
                  { serviceStartDate: { lt: endExclusive } },
                ],
              },
              {
                OR: [
                  { serviceEndDate: null },
                  { serviceEndDate: { gte: start } },
                ],
              },
              { OR: [{ dateOfDeath: null }, { dateOfDeath: { gte: start } }] },
            ],
          },
        }),
        this.prisma.employee.count({
          where: {
            deletedAt: null,
            isActive: true,
            OR: [
              { employment: { is: null } },
              {
                employment: {
                  is: {
                    AND: [
                      {
                        OR: [
                          { startDate: null },
                          { startDate: { lt: endExclusive } },
                        ],
                      },
                      { OR: [{ endDate: null }, { endDate: { gte: start } }] },
                    ],
                  },
                },
              },
            ],
          },
        }),
        this.prisma.scheduledVisit.count({
          where: {
            deletedAt: null,
            status: ScheduledVisitStatus.COMPLETED,
            scheduledStartDateTime: { gte: start, lt: endExclusive },
          },
        }),
      ]);
    return { activeServiceUsers, activeCarers, completedVisits };
  }

  async unitEconomics(monthParam?: string, now = new Date()) {
    const month = monthParam ?? monthOf(now);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
    const rows = await this.data.loadRows(
      monthStart(months[0]),
      monthEnd(month),
    );
    const history = [];
    let current: {
      totalCost: number;
      activeServiceUsers: number;
      activeCarers: number;
      completedVisits: number;
    } | null = null;
    for (const m of months) {
      const total = round2(
        sumCost(filterRange(rows, monthStart(m), monthEnd(m))),
      );
      const v = await this.businessVolumes(m);
      history.push({
        month: m,
        totalCost: total,
        costPerServiceUser: perUnit(total, v.activeServiceUsers),
        costPerCarer: perUnit(total, v.activeCarers),
        costPerVisit: perUnit(total, v.completedVisits),
      });
      if (m === month) current = { totalCost: total, ...v };
    }
    const c = current!;
    return {
      currency: this.currency,
      month,
      totalCost: c.totalCost,
      activeServiceUsers: c.activeServiceUsers,
      activeCarers: c.activeCarers,
      completedVisits: c.completedVisits,
      costPerServiceUser: perUnit(c.totalCost, c.activeServiceUsers),
      costPerCarer: perUnit(c.totalCost, c.activeCarers),
      costPerVisit: perUnit(c.totalCost, c.completedVisits),
      history,
    };
  }

  // ── Anomalies ───────────────────────────────────────────────────────────────
  private async anomalyItems(
    rows: Prisma.AzureCostAnomalyGetPayload<Record<string, never>>[],
  ) {
    const labels = await this.data.userLabels(
      rows.map((r) => r.acknowledgedById),
    );
    return rows.map((r) => ({
      id: r.id,
      date: isoDate(r.date),
      cost: round2(r.cost.toNumber()),
      baseline: round2(r.baseline.toNumber()),
      increasePercent: round2(r.increasePercent.toNumber()),
      topDriver: r.topDriver,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.toISOString() : null,
      acknowledgedBy: r.acknowledgedById
        ? (labels.get(r.acknowledgedById) ?? null)
        : null,
    }));
  }

  async anomalies(q: AnomaliesQueryDto) {
    const status = q.status ?? 'open';
    const rows = await this.prisma.azureCostAnomaly.findMany({
      where: status === 'all' ? {} : { status },
      orderBy: { date: 'desc' },
      take: 500,
    });
    return { items: await this.anomalyItems(rows) };
  }

  async acknowledgeAnomaly(id: string, userId: string, meta: RequestAuditMeta) {
    const existing = await this.prisma.azureCostAnomaly.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Anomaly not found');
    const row =
      existing.status === 'acknowledged'
        ? existing
        : await this.prisma.azureCostAnomaly.update({
            where: { id },
            data: {
              status: 'acknowledged',
              acknowledgedAt: new Date(),
              acknowledgedById: userId,
            },
          });
    if (existing.status !== 'acknowledged') {
      await this.auditLogs.logAudit({
        userId,
        module: AuditModule.PLATFORM_COSTS,
        action: 'platform_costs_anomaly_acknowledged',
        recordType: 'AzureCostAnomaly',
        recordId: id,
        description: `Acknowledged Azure cost anomaly for ${isoDate(existing.date)}`,
        oldValues: { status: existing.status },
        newValues: { status: 'acknowledged' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    return (await this.anomalyItems([row]))[0];
  }

  // ── Settings ────────────────────────────────────────────────────────────────
  private async settingsView(
    s: Awaited<ReturnType<PlatformCostsDataService['getSettings']>>,
  ) {
    const labels = await this.data.userLabels([s.updatedById]);
    return {
      anomalyThresholdPercent: s.anomalyThresholdPercent,
      anomalyMinDailyIncrease: round2(s.anomalyMinDailyIncrease.toNumber()),
      monthlyReportEnabled: s.monthlyReportEnabled,
      monthlyReportRecipients: s.monthlyReportRecipients,
      updatedAt: s.updatedAt.toISOString(),
      updatedBy: s.updatedById ? (labels.get(s.updatedById) ?? null) : null,
    };
  }

  async getSettings() {
    return this.settingsView(await this.data.getSettings());
  }

  async updateSettings(
    dto: UpdatePlatformCostSettingsDto,
    userId: string,
    meta: RequestAuditMeta,
  ) {
    const before = await this.data.getSettings();
    const data: Prisma.PlatformCostSettingsUpdateInput = {
      updatedById: userId,
    };
    if (dto.anomalyThresholdPercent !== undefined)
      data.anomalyThresholdPercent = dto.anomalyThresholdPercent;
    if (dto.anomalyMinDailyIncrease !== undefined) {
      data.anomalyMinDailyIncrease = new Prisma.Decimal(
        dto.anomalyMinDailyIncrease.toFixed(2),
      );
    }
    if (dto.monthlyReportEnabled !== undefined)
      data.monthlyReportEnabled = dto.monthlyReportEnabled;
    if (dto.monthlyReportRecipients !== undefined) {
      data.monthlyReportRecipients = normaliseRecipients(
        dto.monthlyReportRecipients,
      );
    }
    const after = await this.prisma.platformCostSettings.update({
      where: { id: SETTINGS_ID },
      data,
    });
    const oldView = await this.settingsView(before);
    const newView = await this.settingsView(after);
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.PLATFORM_COSTS,
      action: 'platform_costs_settings_updated',
      recordType: 'PlatformCostSettings',
      description: 'Updated Azure Pricing settings',
      oldValues: { ...oldView, updatedAt: undefined, updatedBy: undefined },
      newValues: { ...newView, updatedAt: undefined, updatedBy: undefined },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return newView;
  }

  // ── Sync runs ───────────────────────────────────────────────────────────────
  async syncRuns(limit = 20) {
    const rows = await this.prisma.azureSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        trigger: r.trigger,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        rowsUpserted: r.rowsUpserted,
        error: r.error,
      })),
    };
  }

  async auditManualSync(userId: string, runId: string, meta: RequestAuditMeta) {
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.PLATFORM_COSTS,
      action: 'platform_costs_manual_sync',
      recordType: 'AzureSyncRun',
      recordId: runId,
      description: 'Triggered a manual Azure cost sync',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}

/** Lower-case, trim, de-duplicate. */
export function normaliseRecipients(list: string[]): string[] {
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}
