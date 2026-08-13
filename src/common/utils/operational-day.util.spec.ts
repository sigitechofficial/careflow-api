import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  dayKeyInTimeZone,
  formatHmInTimeZone,
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

describe('formatHmInTimeZone', () => {
  it('formats Europe/London winter (GMT) clock face', () => {
    // 2026-01-15 14:30 UTC == 14:30 London (GMT)
    expect(formatHmInTimeZone(new Date('2026-01-15T14:30:00.000Z'), 'Europe/London')).toBe(
      '14:30',
    );
  });

  it('formats Europe/London summer (BST) clock face', () => {
    // 2026-07-15 14:30 UTC == 15:30 London (BST, UTC+1)
    expect(formatHmInTimeZone(new Date('2026-07-15T14:30:00.000Z'), 'Europe/London')).toBe(
      '15:30',
    );
  });
});
