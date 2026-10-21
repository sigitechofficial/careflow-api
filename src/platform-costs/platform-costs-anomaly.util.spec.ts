import { detectAnomalies } from './platform-costs-anomaly.util';
import type { CostRow } from './platform-costs-aggregation.util';

function day(n: number) {
  return `2026-09-${String(n).padStart(2, '0')}`;
}
function r(date: string, serviceName: string, cost: number): CostRow {
  return {
    date,
    resourceGroup: 'rg',
    serviceName,
    resourceId: 'x',
    meterCategory: serviceName,
    cost,
  };
}

const settings = { thresholdPercent: 50, minDailyIncrease: 1 };

describe('detectAnomalies', () => {
  const steady: CostRow[] = [];
  for (let d = 1; d <= 7; d++) {
    steady.push(
      r(day(d), 'Azure Database for PostgreSQL', 1.5),
      r(day(d), 'Container Registry', 0.5),
    );
  }

  it('flags a day above avg × (1 + threshold) with a large enough increase', () => {
    const rows = [
      ...steady,
      r(day(8), 'Azure Database for PostgreSQL', 1.5),
      r(day(8), 'Log Analytics', 2.5),
      r(day(8), 'Container Registry', 0.5),
    ];
    const out = detectAnomalies(rows, [day(8)], settings);
    expect(out).toEqual([
      {
        date: day(8),
        cost: 4.5,
        baseline: 2,
        increasePercent: 125,
        topDriver: 'Log Analytics',
      },
    ]);
  });

  it('does not flag when the relative threshold is not exceeded', () => {
    const rows = [...steady, r(day(8), 'Azure Database for PostgreSQL', 2.9)];
    // 2.9 + 0 = 2.9 < 2 × 1.5 = 3
    expect(detectAnomalies(rows, [day(8)], settings)).toEqual([]);
  });

  it('does not flag when the absolute increase is below the minimum', () => {
    const tiny: CostRow[] = [];
    for (let d = 1; d <= 7; d++) tiny.push(r(day(d), 'S', 0.1));
    tiny.push(r(day(8), 'S', 0.5)); // +400 % but only +0.40
    expect(detectAnomalies(tiny, [day(8)], settings)).toEqual([]);
    expect(
      detectAnomalies(tiny, [day(8)], {
        thresholdPercent: 50,
        minDailyIncrease: 0.3,
      }),
    ).toHaveLength(1);
  });

  it('requires at least 3 days of history', () => {
    const rows = [r(day(1), 'S', 1), r(day(2), 'S', 1), r(day(3), 'S', 10)];
    expect(detectAnomalies(rows, [day(3)], settings)).toEqual([]);
    const more = [...rows.slice(0, 2), r(day(3), 'S', 1), r(day(4), 'S', 10)];
    expect(detectAnomalies(more, [day(4)], settings)).toHaveLength(1);
  });

  it('counts missing days inside the history window as zero', () => {
    const rows = [r(day(1), 'S', 2), r(day(5), 'S', 2), r(day(8), 'S', 3)];
    // window 1..7 → (2 + 2) / 7 = 0.571; 3 > 0.857 and +2.43 ≥ 1
    const out = detectAnomalies(rows, [day(8)], settings);
    expect(out[0].baseline).toBe(0.57);
  });

  it('ignores dates without data and de-duplicates dates', () => {
    expect(detectAnomalies(steady, [day(9), day(9)], settings)).toEqual([]);
  });
});
