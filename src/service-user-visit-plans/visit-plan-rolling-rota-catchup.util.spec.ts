import {
  ROTA_CATCHUP_MAX_CHUNK_DAYS,
  chunkIsoDateRange,
  resolveRollingRotaCatchUpWindow,
  summarisePlanResults,
} from './visit-plan-rolling-rota-catchup.util';

const daysInclusive = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000 +
  1;

describe('resolveRollingRotaCatchUpWindow', () => {
  it('FIXED_DAYS: today .. today + horizon', () => {
    expect(
      resolveRollingRotaCatchUpWindow('2026-10-02', 'FIXED_DAYS', 28),
    ).toEqual({
      fromDate: '2026-10-02',
      toDate: '2026-10-30',
    });
  });

  it('FIXED_DAYS clamps the horizon to 1..90', () => {
    expect(
      resolveRollingRotaCatchUpWindow('2026-10-02', 'FIXED_DAYS', 500).toDate,
    ).toBe('2026-12-31');
    expect(
      resolveRollingRotaCatchUpWindow('2026-10-02', 'FIXED_DAYS', 0).toDate,
    ).toBe('2026-10-03');
  });

  it('CALENDAR_MONTH: today .. end of the month containing today + horizon', () => {
    expect(
      resolveRollingRotaCatchUpWindow('2026-10-02', 'CALENDAR_MONTH', 28),
    ).toEqual({
      fromDate: '2026-10-02',
      toDate: '2026-10-31',
    });
    expect(
      resolveRollingRotaCatchUpWindow('2026-10-20', 'CALENDAR_MONTH', 28),
    ).toEqual({
      fromDate: '2026-10-20',
      toDate: '2026-11-30',
    });
    expect(
      resolveRollingRotaCatchUpWindow('2026-12-15', 'CALENDAR_MONTH', 28)
        .toDate,
    ).toBe('2027-01-31');
  });
});

describe('chunkIsoDateRange', () => {
  it('returns a single chunk for short windows', () => {
    expect(chunkIsoDateRange('2026-10-02', '2026-10-30')).toEqual([
      { fromDate: '2026-10-02', toDate: '2026-10-30' },
    ]);
    expect(chunkIsoDateRange('2026-10-02', '2026-10-02')).toEqual([
      { fromDate: '2026-10-02', toDate: '2026-10-02' },
    ]);
  });

  it('splits long windows into contiguous chunks of at most 31 days', () => {
    const chunks = chunkIsoDateRange('2026-10-02', '2026-12-31');
    expect(chunks).toEqual([
      { fromDate: '2026-10-02', toDate: '2026-11-01' },
      { fromDate: '2026-11-02', toDate: '2026-12-02' },
      { fromDate: '2026-12-03', toDate: '2026-12-31' },
    ]);
    for (const c of chunks) {
      expect(daysInclusive(c.fromDate, c.toDate)).toBeLessThanOrEqual(
        ROTA_CATCHUP_MAX_CHUNK_DAYS,
      );
    }
    const total = chunks.reduce(
      (s, c) => s + daysInclusive(c.fromDate, c.toDate),
      0,
    );
    expect(total).toBe(daysInclusive('2026-10-02', '2026-12-31'));
  });

  it('covers the maximum CALENDAR_MONTH window (90-day horizon) without gaps', () => {
    const w = resolveRollingRotaCatchUpWindow(
      '2026-01-31',
      'CALENDAR_MONTH',
      90,
    );
    const chunks = chunkIsoDateRange(w.fromDate, w.toDate);
    expect(chunks[0].fromDate).toBe(w.fromDate);
    expect(chunks[chunks.length - 1].toDate).toBe(w.toDate);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(daysInclusive(chunks[i - 1].toDate, chunks[i].fromDate)).toBe(2);
    }
  });

  it('returns no chunks for invalid ranges', () => {
    expect(chunkIsoDateRange('2026-10-05', '2026-10-01')).toEqual([]);
    expect(chunkIsoDateRange('bad', '2026-10-01')).toEqual([]);
  });
});

describe('summarisePlanResults', () => {
  it('collapses per-chunk results to one status per plan', () => {
    const s = summarisePlanResults([
      { planId: 'a', status: 'success' },
      { planId: 'a', status: 'success' },
      { planId: 'b', status: 'success' },
      { planId: 'b', status: 'failed', error: 'boom' },
      { planId: 'c', status: 'skipped', skipReason: 'not ready' },
      { planId: 'c', status: 'skipped' },
    ]);
    expect(s).toEqual({
      processed: 3,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      failures: [{ planId: 'b', error: 'boom' }],
    });
  });
});
