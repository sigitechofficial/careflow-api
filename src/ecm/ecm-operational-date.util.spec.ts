import {
  localVisitDateFromStart,
  plannedStartOnOperationalDate,
} from './ecm-evaluation.mapper';

describe('plannedStartOnOperationalDate', () => {
  it('matches London calendar day for morning UTC visits', () => {
    const start = new Date('2026-08-07T07:00:00.000Z');
    expect(plannedStartOnOperationalDate(start, '2026-08-07')).toBe(true);
    expect(plannedStartOnOperationalDate(start, '2026-08-06')).toBe(false);
    expect(formatScheduleDate(localVisitDateFromStart(start))).toBe('2026-08-07');
  });

  it('does not use a bare UTC day when London date differs near midnight', () => {
    // 23:30 UTC on 6 Aug is still 7 Aug early morning in BST (UTC+1)
    const start = new Date('2026-08-06T23:30:00.000Z');
    expect(plannedStartOnOperationalDate(start, '2026-08-07')).toBe(true);
    expect(plannedStartOnOperationalDate(start, '2026-08-06')).toBe(false);
  });
});

function formatScheduleDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
