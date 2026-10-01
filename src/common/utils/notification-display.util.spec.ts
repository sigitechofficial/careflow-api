import {
  formatNotificationCalendarDay,
  formatNotificationDate,
  formatNotificationDateTime,
} from './notification-display.util';

describe('notification-display.util', () => {
  const london = { timeZone: 'Europe/London', dateFormat: 'DD_MM_YYYY' as const };

  it('formats date + time in the org timezone (BST)', () => {
    expect(formatNotificationDateTime(new Date('2026-09-28T13:00:00Z'), london)).toBe(
      '28/09/2026 at 14:00',
    );
  });

  it('uses the org timezone for the calendar day near midnight', () => {
    expect(formatNotificationDate(new Date('2026-09-28T23:30:00Z'), london)).toBe('29/09/2026');
  });

  it('follows the org date display format', () => {
    const us = { ...london, dateFormat: 'MM_DD_YYYY' as const };
    expect(formatNotificationDate(new Date('2026-09-28T10:00:00Z'), us)).toBe('09/28/2026');
  });

  it('keeps stored calendar days (UTC midnight) on the same day', () => {
    expect(formatNotificationCalendarDay(new Date('2026-10-02T00:00:00Z'), london)).toBe(
      '02/10/2026',
    );
  });
});
