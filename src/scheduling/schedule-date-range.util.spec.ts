import {
  operationalScheduleDayBounds,
  operationalScheduleWeekBounds,
  weekdayIndexInTimeZone,
} from './schedule-date-range.util';

describe('operationalScheduleDayBounds', () => {
  it('uses organisation timezone instants, not UTC midnight', () => {
    const { start, end, date } = operationalScheduleDayBounds(
      '2026-09-14',
      'Asia/Karachi',
    );
    expect(date).toBe('2026-09-14');
    // Karachi UTC+5: 14 Sep 00:00 = 13 Sep 19:00Z
    expect(start.toISOString()).toBe('2026-09-13T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-14T18:59:59.999Z');
  });
});

describe('operationalScheduleWeekBounds', () => {
  it('spans Monday–Sunday in organisation timezone', () => {
    const bounds = operationalScheduleWeekBounds('2026-09-16', 'Asia/Karachi');
    expect(bounds.weekStartLabel).toBe('2026-09-14');
    expect(bounds.weekEndLabel).toBe('2026-09-20');
    expect(bounds.weekStart.toISOString()).toBe('2026-09-13T19:00:00.000Z');
    expect(bounds.weekEnd.toISOString()).toBe('2026-09-20T18:59:59.999Z');
  });
});

describe('weekdayIndexInTimeZone', () => {
  it('uses the operational calendar day, not UTC weekday', () => {
    // Monday 00:30 Karachi = Sunday 19:30 UTC
    const instant = new Date('2026-09-13T19:30:00.000Z');
    expect(weekdayIndexInTimeZone(instant, 'Asia/Karachi')).toBe(1);
    expect(instant.getUTCDay()).toBe(0);
  });
});
