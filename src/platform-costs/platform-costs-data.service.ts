import { Injectable } from '@nestjs/common';
import type { PlatformCostSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  isoDate,
  linearMonthEndForecast,
  monthOf,
  parseIsoDate,
  round2,
  type CostRow,
} from './platform-costs-aggregation.util';
import { SETTINGS_ID, type SyncKind } from './platform-costs.constants';

export type BudgetView = {
  name: string;
  amount: number;
  timeGrain: string;
  currentSpend: number;
  percentUsed: number;
  forecastPercent: number | null;
  thresholds: Array<{ percent: number; type: string; reached: boolean }>;
};

/** Shared DB reads for the Azure Pricing feature (never calls Azure). */
@Injectable()
export class PlatformCostsDataService {
  constructor(private readonly prisma: PrismaService) {}

  async loadRows(fromIso: string, toIso: string): Promise<CostRow[]> {
    const rows = await this.prisma.azureCostDaily.findMany({
      where: { date: { gte: parseIsoDate(fromIso), lte: parseIsoDate(toIso) } },
      select: {
        date: true,
        resourceGroup: true,
        serviceName: true,
        resourceId: true,
        meterCategory: true,
        cost: true,
      },
    });
    return rows.map((r) => ({
      date: isoDate(r.date),
      resourceGroup: r.resourceGroup,
      serviceName: r.serviceName,
      resourceId: r.resourceId,
      meterCategory: r.meterCategory,
      cost: r.cost.toNumber(),
    }));
  }

  async dataThrough(): Promise<string | null> {
    const agg = await this.prisma.azureCostDaily.aggregate({
      _max: { date: true },
    });
    return agg._max.date ? isoDate(agg._max.date) : null;
  }

  async lastSuccess(kind: SyncKind): Promise<Date | null> {
    const run = await this.prisma.azureSyncRun.findFirst({
      where: { kind, status: 'success' },
      orderBy: { startedAt: 'desc' },
      select: { finishedAt: true, startedAt: true },
    });
    return run ? (run.finishedAt ?? run.startedAt) : null;
  }

  async getSettings(): Promise<PlatformCostSettings> {
    return this.prisma.platformCostSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
  }

  /** Latest Azure forecast for the month, else a linear projection from stored rows. */
  async forecastMonthEnd(
    month: string,
    rows: CostRow[],
    dataThrough: string | null,
  ): Promise<number> {
    const snap = await this.prisma.azureForecastSnapshot.findFirst({
      where: { month },
      orderBy: { capturedAt: 'desc' },
    });
    const linear = linearMonthEndForecast(rows, month, dataThrough);
    if (!snap) return linear;
    if (snap.source === 'linear') return linear;
    // Never forecast below what has already been spent.
    const mtd = rows
      .filter((r) => monthOf(r.date) === month)
      .reduce((acc, r) => acc + r.cost, 0);
    return round2(Math.max(snap.forecastTotal.toNumber(), mtd));
  }

  async budgetView(
    monthToDate: number,
    forecast: number | null,
  ): Promise<BudgetView | null> {
    const latest = await this.prisma.azureBudgetSnapshot.findFirst({
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true },
    });
    if (!latest) return null;
    // All budgets captured in the latest snapshot batch (same sync, within a minute).
    const batch = await this.prisma.azureBudgetSnapshot.findMany({
      where: {
        capturedAt: { gte: new Date(latest.capturedAt.getTime() - 60_000) },
      },
      orderBy: [{ name: 'asc' }],
    });
    const b =
      batch.find((x) => x.timeGrain.toLowerCase() === 'monthly') ?? batch[0];
    if (!b) return null;
    const amount = b.amount.toNumber();
    // Azure's budget currentSpend lags; never show less than our month-to-date actuals.
    const currentSpend = Math.max(b.currentSpend.toNumber(), monthToDate);
    const percentUsed = amount > 0 ? (currentSpend / amount) * 100 : 0;
    const forecastPercent =
      amount > 0 && forecast !== null ? (forecast / amount) * 100 : null;
    const thresholds = (
      Array.isArray(b.thresholds) ? b.thresholds : []
    ) as Array<{
      percent?: number;
      type?: string;
    }>;
    return {
      name: b.name,
      amount: round2(amount),
      timeGrain: b.timeGrain,
      currentSpend: round2(currentSpend),
      percentUsed: round2(percentUsed),
      forecastPercent:
        forecastPercent === null ? null : round2(forecastPercent),
      thresholds: thresholds.map((t) => {
        const percent = Number(t.percent ?? 0);
        const type = String(t.type ?? 'Actual');
        const basis = type.toLowerCase().startsWith('forecast')
          ? forecastPercent
          : percentUsed;
        return { percent, type, reached: basis !== null && basis >= percent };
      }),
    };
  }

  async userLabels(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    const map = new Map<string, string>();
    if (!unique.length) return map;
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      map.set(u.id, name || u.email);
    }
    return map;
  }
}
