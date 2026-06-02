import {
  parseMonthList,
  resolveChartRange,
} from './medication-chart-range.util';

describe('medication-chart-range.util', () => {
  it('resolves full calendar month', () => {
    const r = resolveChartRange({ month: '2026-05' });
    expect(r.lastDay).toBe(31);
    expect(r.periodStart).toBe('2026-05-01');
    expect(r.periodEnd).toBe('2026-05-31');
    expect(r.daySpecs).toHaveLength(31);
  });

  it('resolves custom date range', () => {
    const r = resolveChartRange({
      dateFrom: '2026-05-10',
      dateTo: '2026-05-15',
    });
    expect(r.daySpecs).toHaveLength(6);
    expect(r.daySpecs[0]!.date).toBe('2026-05-10');
    expect(r.periodLabel).toContain('May');
  });

  it('parses month list with limit', () => {
    expect(parseMonthList('2026-01,2026-02')).toEqual(['2026-01', '2026-02']);
  });
});
