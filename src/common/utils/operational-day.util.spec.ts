import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  dayKeyInTimeZone,
  operationalTodayIso,
} from './operational-day.util';

describe('operationalTodayIso', () => {
  it('uses Europe/London, not Asia/Karachi', () => {
    const now = new Date('2026-08-06T21:05:00.000Z');
    expect(operationalTodayIso(now, DEFAULT_OPERATIONAL_TIMEZONE)).toBe('2026-08-06');
    expect(operationalTodayIso(now, 'Asia/Karachi')).toBe('2026-08-07');
  });
});

describe('dayKeyInTimeZone', () => {
  it('maps late UTC instant to next London calendar day in BST', () => {
    const instant = new Date('2026-08-06T23:30:00.000Z');
    expect(dayKeyInTimeZone(instant, 'Europe/London')).toBe('2026-08-07');
  });
});
