import type { AzureArmClient } from './azure-arm.client';

export const COST_MANAGEMENT_API_VERSION = '2023-11-01';
export const BUDGETS_API_VERSION = '2023-05-01';
export const ADVISOR_API_VERSION = '2023-01-01';

type QueryColumn = { name: string; type?: string };
export type QueryResult = {
  properties?: {
    columns?: QueryColumn[];
    rows?: unknown[][];
    nextLink?: string | null;
  };
};

export type CostQueryRow = {
  date: string;
  resourceGroup: string;
  serviceName: string;
  resourceId: string;
  meterCategory: string;
  cost: number;
  currency: string;
};

export type ForecastResult = {
  actualToDate: number;
  forecastTotal: number;
  hasForecastRows: boolean;
  currency: string | null;
};

export type BudgetThreshold = {
  percent: number;
  type: string;
  enabled: boolean;
};

export type BudgetInfo = {
  budgetId: string;
  name: string;
  amount: number;
  timeGrain: string;
  currentSpend: number;
  forecastSpend: number | null;
  currency: string | null;
  thresholds: BudgetThreshold[];
  periodStart: string | null;
  periodEnd: string | null;
};

export type AdvisorRecommendationInfo = {
  recommendationId: string;
  impact: string;
  problem: string;
  solution: string;
  resourceId: string | null;
  resourceName: string | null;
  annualSavings: number | null;
  currency: string | null;
};

/** 20260929 | "2026-09-29T00:00:00" → "2026-09-29" */
export function usageDateToIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const s = String(Math.trunc(value));
    if (/^\d{8}$/.test(s))
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return null;
  }
  if (typeof value === 'string') {
    if (/^\d{8}$/.test(value))
      return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  return null;
}

/** Scalar query cell as a string ('' for missing / non-scalar). */
function cell(row: unknown[], i: number): string {
  if (i < 0) return '';
  const v = row[i];
  return typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
    ? String(v)
    : '';
}

function colIndex(columns: QueryColumn[], ...names: string[]): number {
  const lower = columns.map((c) => c.name.toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Parse Cost Management query rows (Daily, grouped by ResourceGroupName/ServiceName/ResourceId/
 * MeterCategory), keep only the configured resource groups (case-insensitive) and merge
 * duplicates on the unique key.
 */
export function parseCostQueryRows(
  result: QueryResult,
  resourceGroups: string[],
): CostQueryRow[] {
  const columns = result.properties?.columns ?? [];
  const rows = result.properties?.rows ?? [];
  const iCost = colIndex(columns, 'Cost', 'PreTaxCost', 'CostUSD');
  const iDate = colIndex(columns, 'UsageDate');
  const iRg = colIndex(columns, 'ResourceGroupName', 'ResourceGroup');
  const iSvc = colIndex(columns, 'ServiceName');
  const iRes = colIndex(columns, 'ResourceId');
  const iMeter = colIndex(columns, 'MeterCategory');
  const iCur = colIndex(columns, 'Currency', 'BillingCurrency');
  if (iCost < 0 || iDate < 0) return [];

  const allowed = new Set(resourceGroups.map((g) => g.toLowerCase()));
  const merged = new Map<string, CostQueryRow>();
  for (const row of rows) {
    const date = usageDateToIso(row[iDate]);
    if (!date) continue;
    const resourceGroup = cell(row, iRg).toLowerCase();
    if (allowed.size && !allowed.has(resourceGroup)) continue;
    const cost = Number(row[iCost]);
    if (!Number.isFinite(cost)) continue;
    const r: CostQueryRow = {
      date,
      resourceGroup,
      serviceName: cell(row, iSvc) || 'Unknown',
      resourceId: cell(row, iRes).toLowerCase(),
      meterCategory: cell(row, iMeter) || 'Unknown',
      cost,
      currency: cell(row, iCur) || 'GBP',
    };
    const key = [
      r.date,
      r.resourceGroup,
      r.serviceName,
      r.resourceId,
      r.meterCategory,
    ].join('\u0000');
    const prev = merged.get(key);
    if (prev) prev.cost += r.cost;
    else merged.set(key, r);
  }
  return [...merged.values()];
}

export function parseForecastRows(result: QueryResult): ForecastResult {
  const columns = result.properties?.columns ?? [];
  const rows = result.properties?.rows ?? [];
  const iCost = colIndex(columns, 'Cost', 'PreTaxCost');
  const iStatus = colIndex(columns, 'CostStatus');
  const iCur = colIndex(columns, 'Currency');
  let actual = 0;
  let total = 0;
  let hasForecastRows = false;
  let currency: string | null = null;
  for (const row of rows) {
    const cost = Number(row[iCost]);
    if (!Number.isFinite(cost)) continue;
    const status = iStatus >= 0 ? cell(row, iStatus) : 'Forecast';
    if (cell(row, iCur)) currency = cell(row, iCur);
    total += cost;
    if (status.toLowerCase() === 'actual') actual += cost;
    else hasForecastRows = true;
  }
  return {
    actualToDate: actual,
    forecastTotal: total,
    hasForecastRows,
    currency,
  };
}

type RawBudget = {
  id?: string;
  name?: string;
  properties?: {
    amount?: number;
    timeGrain?: string;
    currentSpend?: { amount?: number; unit?: string };
    forecastSpend?: { amount?: number; unit?: string };
    timePeriod?: { startDate?: string; endDate?: string };
    notifications?: Record<
      string,
      {
        enabled?: boolean;
        threshold?: number;
        thresholdType?: string;
        operator?: string;
      }
    >;
  };
};

/** Map budgets; notification contact e-mails/roles/groups are deliberately dropped. */
export function parseBudgets(payload: { value?: RawBudget[] }): BudgetInfo[] {
  return (payload.value ?? []).map((b) => {
    const p = b.properties ?? {};
    const thresholds: BudgetThreshold[] = Object.values(p.notifications ?? {})
      .map((n) => ({
        percent: Number(n.threshold ?? 0),
        type: n.thresholdType ?? 'Actual',
        enabled: n.enabled !== false,
      }))
      .filter((t) => Number.isFinite(t.percent) && t.percent > 0)
      .sort((a, b) => a.percent - b.percent || a.type.localeCompare(b.type));
    return {
      budgetId: b.id ?? b.name ?? '',
      name: b.name ?? 'budget',
      amount: Number(p.amount ?? 0),
      timeGrain: p.timeGrain ?? 'Monthly',
      currentSpend: Number(p.currentSpend?.amount ?? 0),
      forecastSpend:
        p.forecastSpend?.amount === undefined ||
        p.forecastSpend?.amount === null
          ? null
          : Number(p.forecastSpend.amount),
      currency: p.currentSpend?.unit ?? null,
      thresholds,
      periodStart: p.timePeriod?.startDate?.slice(0, 10) ?? null,
      periodEnd: p.timePeriod?.endDate?.slice(0, 10) ?? null,
    };
  });
}

type RawAdvisor = {
  name?: string;
  id?: string;
  properties?: {
    impact?: string;
    impactedValue?: string;
    shortDescription?: { problem?: string; solution?: string };
    resourceMetadata?: { resourceId?: string };
    extendedProperties?: Record<string, string | undefined>;
  };
};

export function parseAdvisor(payload: {
  value?: RawAdvisor[];
}): AdvisorRecommendationInfo[] {
  return (payload.value ?? []).map((r) => {
    const p = r.properties ?? {};
    const ext = p.extendedProperties ?? {};
    const savingsRaw = ext.annualSavingsAmount ?? ext.savingsAmount;
    const savings = savingsRaw === undefined ? NaN : Number(savingsRaw);
    const resourceId = p.resourceMetadata?.resourceId ?? null;
    return {
      recommendationId: r.name ?? r.id ?? '',
      impact: p.impact ?? 'Low',
      problem: p.shortDescription?.problem ?? '',
      solution: p.shortDescription?.solution ?? '',
      resourceId,
      resourceName:
        p.impactedValue ??
        (resourceId ? (resourceId.split('/').pop() ?? null) : null),
      annualSavings: Number.isFinite(savings) ? savings : null,
      currency: ext.savingsCurrency ?? null,
    };
  });
}

/** Read-only Cost Management / Consumption / Advisor calls. */
export class AzureCostManagementApi {
  constructor(private readonly arm: AzureArmClient) {}

  /** ActualCost, daily, grouped by RG / service / resource / meter category (follows nextLink). */
  async queryDailyCosts(
    scope: string,
    fromIso: string,
    toIso: string,
    resourceGroups: string[],
  ): Promise<CostQueryRow[]> {
    const body = {
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from: `${fromIso}T00:00:00Z`, to: `${toIso}T23:59:59Z` },
      dataset: {
        granularity: 'Daily',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        grouping: [
          { type: 'Dimension', name: 'ResourceGroupName' },
          { type: 'Dimension', name: 'ServiceName' },
          { type: 'Dimension', name: 'ResourceId' },
          { type: 'Dimension', name: 'MeterCategory' },
        ],
      },
    };
    const all: CostQueryRow[] = [];
    let url: string | null =
      `${scope}/providers/Microsoft.CostManagement/query?api-version=${COST_MANAGEMENT_API_VERSION}`;
    let pages = 0;
    while (url && pages < 50) {
      const result: QueryResult = await this.arm.postQuery<QueryResult>(
        url,
        body,
      );
      all.push(...parseCostQueryRows(result, resourceGroups));
      url = result.properties?.nextLink || null;
      pages += 1;
    }
    // Pages may split one key across pages; merge again.
    return parseCostQueryRows(
      {
        properties: {
          columns: [
            { name: 'Cost' },
            { name: 'UsageDate' },
            { name: 'ResourceGroupName' },
            { name: 'ServiceName' },
            { name: 'ResourceId' },
            { name: 'MeterCategory' },
            { name: 'Currency' },
          ],
          rows: all.map((r) => [
            r.cost,
            r.date,
            r.resourceGroup,
            r.serviceName,
            r.resourceId,
            r.meterCategory,
            r.currency,
          ]),
        },
      },
      resourceGroups,
    );
  }

  async forecast(
    scope: string,
    fromIso: string,
    toIso: string,
    resourceGroups: string[],
  ): Promise<ForecastResult> {
    const body: Record<string, unknown> = {
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from: `${fromIso}T00:00:00Z`, to: `${toIso}T23:59:59Z` },
      includeActualCost: true,
      includeFreshPartialCost: false,
      dataset: {
        granularity: 'Daily',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        ...(resourceGroups.length && !/\/resourcegroups\//i.test(scope)
          ? {
              filter: {
                dimensions: {
                  name: 'ResourceGroupName',
                  operator: 'In',
                  values: resourceGroups,
                },
              },
            }
          : {}),
      },
    };
    const result = await this.arm.postQuery<QueryResult>(
      `${scope}/providers/Microsoft.CostManagement/forecast?api-version=${COST_MANAGEMENT_API_VERSION}`,
      body,
    );
    return parseForecastRows(result);
  }

  /** Budgets at the subscription scope (includes RG budgets); falls back to each RG scope. */
  async listBudgets(
    subscriptionId: string,
    resourceGroups: string[],
  ): Promise<BudgetInfo[]> {
    const sub = `/subscriptions/${subscriptionId}`;
    const found = new Map<string, BudgetInfo>();
    const atSub = await this.arm.get<{ value?: RawBudget[] }>(
      `${sub}/providers/Microsoft.Consumption/budgets?api-version=${BUDGETS_API_VERSION}`,
    );
    for (const b of parseBudgets(atSub)) found.set(b.budgetId.toLowerCase(), b);
    if (!found.size) {
      for (const rg of resourceGroups) {
        const atRg = await this.arm.get<{ value?: RawBudget[] }>(
          `${sub}/resourceGroups/${encodeURIComponent(rg)}/providers/Microsoft.Consumption/budgets?api-version=${BUDGETS_API_VERSION}`,
        );
        for (const b of parseBudgets(atRg))
          found.set(b.budgetId.toLowerCase(), b);
      }
    }
    return [...found.values()];
  }

  async listCostRecommendations(
    subscriptionId: string,
  ): Promise<AdvisorRecommendationInfo[]> {
    const filter = encodeURIComponent("Category eq 'Cost'");
    let url: string | null =
      `/subscriptions/${subscriptionId}/providers/Microsoft.Advisor/recommendations?api-version=${ADVISOR_API_VERSION}&$filter=${filter}`;
    const out: AdvisorRecommendationInfo[] = [];
    let pages = 0;
    while (url && pages < 20) {
      const page: { value?: RawAdvisor[]; nextLink?: string | null } =
        await this.arm.get(url);
      out.push(...parseAdvisor(page));
      url = page.nextLink || null;
      pages += 1;
    }
    return out;
  }
}
