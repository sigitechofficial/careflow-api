import {
  addDays,
  dailyTotals,
  round2,
  type CostRow,
} from './platform-costs-aggregation.util';

export type AnomalySettings = {
  /** e.g. 50 → day must exceed the 7-day average by more than 50 %. */
  thresholdPercent: number;
  /** Absolute increase over the baseline must also be at least this (major units). */
  minDailyIncrease: number;
};

export type DetectedAnomaly = {
  date: string;
  cost: number;
  baseline: number;
  increasePercent: number;
  topDriver: string | null;
};

export const ANOMALY_BASELINE_DAYS = 7;
/** Need at least this many prior days with data before a day can be judged. */
export const ANOMALY_MIN_BASELINE_DAYS = 3;

/**
 * Rule: cost(D) > avg(previous 7 days) × (1 + threshold%) AND cost(D) − avg ≥ minDailyIncrease.
 * The baseline uses the 7 calendar days before D that fall on/after the first day with data
 * (days with no rows count as 0 once history exists); at least 3 such days are required.
 * Top driver = the service whose cost rose most vs its own baseline.
 */
export function detectAnomalies(
  rows: CostRow[],
  datesToCheck: string[],
  settings: AnomalySettings,
): DetectedAnomaly[] {
  if (!rows.length) return [];
  const totals = dailyTotals(rows);
  const firstDate = [...totals.keys()].sort()[0];
  const byServiceDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let m = byServiceDay.get(r.serviceName);
    if (!m) byServiceDay.set(r.serviceName, (m = new Map()));
    m.set(r.date, (m.get(r.date) ?? 0) + r.cost);
  }

  const out: DetectedAnomaly[] = [];
  for (const date of [...new Set(datesToCheck)].sort()) {
    const cost = totals.get(date);
    if (cost === undefined) continue;
    const window: string[] = [];
    for (let i = 1; i <= ANOMALY_BASELINE_DAYS; i++) {
      const d = addDays(date, -i);
      if (d >= firstDate) window.push(d);
    }
    if (window.length < ANOMALY_MIN_BASELINE_DAYS) continue;
    const baseline =
      window.reduce((acc, d) => acc + (totals.get(d) ?? 0), 0) / window.length;
    const increase = cost - baseline;
    const thresholdFactor = 1 + settings.thresholdPercent / 100;
    if (!(cost > baseline * thresholdFactor)) continue;
    if (increase < settings.minDailyIncrease) continue;

    let topDriver: string | null = null;
    let topDelta = -Infinity;
    for (const [service, days] of byServiceDay) {
      const svcCost = days.get(date) ?? 0;
      const svcBase =
        window.reduce((acc, d) => acc + (days.get(d) ?? 0), 0) / window.length;
      const delta = svcCost - svcBase;
      if (delta > topDelta) {
        topDelta = delta;
        topDriver = service;
      }
    }

    out.push({
      date,
      cost: round2(cost),
      baseline: round2(baseline),
      increasePercent: baseline > 0 ? round2((increase / baseline) * 100) : 100,
      topDriver,
    });
  }
  return out;
}
