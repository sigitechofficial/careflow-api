import { expectedInWindow } from './supervision.service';

describe('expectedInWindow (held vs expected per carer)', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const since = new Date(now.getTime() - 365 * 86_400_000);

  it('expects a full year for someone who started long ago', () => {
    expect(expectedInWindow(90, null, new Date('2020-01-01T00:00:00Z'), since, now)).toBe(4);
  });

  it('expects nothing yet from a new starter whose first supervision is not due', () => {
    expect(expectedInWindow(90, null, new Date('2026-10-01T00:00:00Z'), since, now)).toBe(0);
  });

  it('counts a first-due offset (spot check within 30 days of starting)', () => {
    expect(expectedInWindow(90, 30, new Date('2026-10-01T00:00:00Z'), since, now)).toBe(1);
  });

  it('pro-rates someone part way through their first year', () => {
    // started 200 days ago: due at day 90 and day 180
    const start = new Date(now.getTime() - 200 * 86_400_000);
    expect(expectedInWindow(90, null, start, since, now)).toBe(2);
  });

  it('falls back to a year of intervals without a start date', () => {
    expect(expectedInWindow(90, null, null, since, now)).toBe(4);
    expect(expectedInWindow(365, null, null, since, now)).toBe(1);
  });
});
