import type { CostGroupBy } from './platform-costs.constants';

/** Minimal shape of a stored daily cost row (cost as a plain number in major units). */
export type CostRow = {
  date: string; // YYYY-MM-DD
  resourceGroup: string;
  serviceName: string;
  resourceId: string;
  meterCategory: string;
  cost: number;
};

export type GroupedCostRow = {
  key: string;
  label: string;
  cost: number;
  share: number;
  resourceGroup?: string;
  service?: string;
};

export type DailyCost = { date: string; cost: number };

/** Money/percent output: 2 dp, no -0. */
export function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysBetweenInclusive(fromIso: string, toIso: string): number {
  return (
    Math.round(
      (parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) /
        86_400_000,
    ) + 1
  );
}

/** YYYY-MM of an ISO date or Date (UTC — Azure billing months are UTC). */
export function monthOf(value: string | Date): string {
  return (typeof value === 'string' ? value : isoDate(value)).slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Last path segment of an ARM resource id (display label). */
export function resourceNameFromId(resourceId: string): string {
  if (!resourceId) return '(no resource)';
  const parts = resourceId.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? resourceId;
}

export function sumCost(rows: Array<{ cost: number }>): number {
  return rows.reduce((acc, r) => acc + r.cost, 0);
}

export function filterRange(
  rows: CostRow[],
  fromIso: string,
  toIso: string,
): CostRow[] {
  return rows.filter((r) => r.date >= fromIso && r.date <= toIso);
}

/** Group key of a row for `groupBy` (matches GroupedCostRow.key). */
export function groupKey(r: CostRow, groupBy: CostGroupBy): string {
  switch (groupBy) {
    case 'resource':
      return r.resourceId || `(no resource) ${r.serviceName}`;
    case 'resourceGroup':
      return r.resourceGroup || '(none)';
    case 'meter':
      return r.meterCategory;
    case 'service':
    default:
      return r.serviceName;
  }
}

/** Group rows by service / resource / resource group / meter category; sorted by cost desc. */
export function groupCosts(
  rows: CostRow[],
  groupBy: CostGroupBy,
): GroupedCostRow[] {
  const total = sumCost(rows);
  const map = new Map<
    string,
    GroupedCostRow & { raw: number; svc?: Map<string, number> }
  >();
  for (const r of rows) {
    const key = groupKey(r, groupBy);
    const extra: Partial<GroupedCostRow> = {};
    let label = key;
    if (groupBy === 'resource') {
      label = r.resourceId ? resourceNameFromId(r.resourceId) : key;
      extra.resourceGroup = r.resourceGroup;
      extra.service = r.serviceName;
    }
    let entry = map.get(key);
    if (entry) entry.raw += r.cost;
    else
      map.set(
        key,
        (entry = { key, label, cost: 0, share: 0, raw: r.cost, ...extra }),
      );
    if (groupBy === 'resource') {
      // A resource can bill under several services (e.g. Storage + Bandwidth): label it with
      // the service that carries most of its cost.
      entry.svc ??= new Map();
      entry.svc.set(
        r.serviceName,
        (entry.svc.get(r.serviceName) ?? 0) + r.cost,
      );
    }
  }
  return [...map.values()]
    .sort((a, b) => b.raw - a.raw || a.label.localeCompare(b.label))
    .map(({ raw, svc, ...rest }) => ({
      ...rest,
      ...(svc
        ? { service: [...svc.entries()].sort((a, b) => b[1] - a[1])[0][0] }
        : {}),
      cost: round2(raw),
      share: total > 0 ? round2((raw / total) * 100) : 0,
    }));
}

/** Zero-filled daily totals for [from, to]. */
export function dailySeries(
  rows: CostRow[],
  fromIso: string,
  toIso: string,
): DailyCost[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.date, (totals.get(r.date) ?? 0) + r.cost);
  const out: DailyCost[] = [];
  if (fromIso > toIso) return out;
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) {
    out.push({ date: d, cost: round2(totals.get(d) ?? 0) });
  }
  return out;
}

export const DAILY_GROUPS_TOP_N = 6;
export const OTHER_GROUP_KEY = 'Other';

export type DailyCostWithGroups = DailyCost & {
  groups: Record<string, number>;
};

/**
 * Zero-filled daily totals with a per-group split: the top `topN` groups by total cost over the
 * range keep their own key (= GroupedCostRow.key); everything else is summed under "Other".
 */
export function dailySeriesByGroup(
  rows: CostRow[],
  fromIso: string,
  toIso: string,
  groupBy: CostGroupBy,
  topN = DAILY_GROUPS_TOP_N,
): DailyCostWithGroups[] {
  const top = new Set(
    groupCosts(rows, groupBy)
      .slice(0, topN)
      .map((g) => g.key),
  );
  const perDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = groupKey(r, groupBy);
    const bucket = top.has(k) ? k : OTHER_GROUP_KEY;
    let m = perDay.get(r.date);
    if (!m) perDay.set(r.date, (m = new Map()));
    m.set(bucket, (m.get(bucket) ?? 0) + r.cost);
  }
  return dailySeries(rows, fromIso, toIso).map((d) => {
    const groups: Record<string, number> = {};
    for (const [k, v] of perDay.get(d.date) ?? []) groups[k] = round2(v);
    return { ...d, groups };
  });
}

/** Unrounded daily totals map. */
export function dailyTotals(rows: CostRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.date, (totals.get(r.date) ?? 0) + r.cost);
  return totals;
}

export type MonthComparison = {
  monthToDate: number;
  lastMonthTotal: number;
  lastMonthSamePeriod: number;
  changeVsLastMonthPercent: number | null;
};

/**
 * Month-to-date vs the same days of the previous month. "Same period" = day 1 … the day of
 * `dataThrough` (clamped to the previous month's length); 0 days when no data this month.
 */
export function compareWithLastMonth(
  rows: CostRow[],
  month: string,
  dataThrough: string | null,
): MonthComparison {
  const prev = addMonths(month, -1);
  const mtd = sumCost(filterRange(rows, monthStart(month), monthEnd(month)));
  const lastMonthTotal = sumCost(
    filterRange(rows, monthStart(prev), monthEnd(prev)),
  );
  let samePeriod = 0;
  if (dataThrough && monthOf(dataThrough) === month) {
    const day = Math.min(Number(dataThrough.slice(8, 10)), daysInMonth(prev));
    samePeriod = sumCost(
      filterRange(
        rows,
        monthStart(prev),
        `${prev}-${String(day).padStart(2, '0')}`,
      ),
    );
  }
  return {
    monthToDate: round2(mtd),
    lastMonthTotal: round2(lastMonthTotal),
    lastMonthSamePeriod: round2(samePeriod),
    changeVsLastMonthPercent:
      samePeriod > 0 ? round2(((mtd - samePeriod) / samePeriod) * 100) : null,
  };
}

/**
 * Linear month-end projection used when Azure's forecast has too little history:
 * month-to-date + (average of the last up-to-7 data days) × remaining days.
 */
export function linearMonthEndForecast(
  rows: CostRow[],
  month: string,
  dataThrough: string | null,
): number {
  const mtd = sumCost(filterRange(rows, monthStart(month), monthEnd(month)));
  if (!dataThrough) return round2(mtd);
  const totals = dailyTotals(rows);
  const window: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(dataThrough, -i);
    if (totals.has(d)) window.push(totals.get(d) ?? 0);
  }
  const avg = window.length
    ? window.reduce((a, b) => a + b, 0) / window.length
    : 0;
  const through = monthOf(dataThrough) === month ? dataThrough : null;
  const remaining = through
    ? daysBetweenInclusive(through, monthEnd(month)) - 1
    : dataThrough < monthStart(month)
      ? daysInMonth(month)
      : 0;
  return round2(mtd + avg * Math.max(0, remaining));
}

export function csvEscape(value: unknown): string {
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : '';
  const s =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : JSON.stringify(value);
  // Neutralise spreadsheet formula injection (text cells only).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return (
    [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') +
    '\r\n'
  );
}
