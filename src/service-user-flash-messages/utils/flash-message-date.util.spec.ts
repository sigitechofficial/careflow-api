import {
  endOfUtcDisplayDay,
  isDisplayUntilExpired,
  isDisplayUntilOnOrAfterToday,
  parseDisplayUntilInput,
  startOfUtcDay,
} from './flash-message-date.util';

describe('flash-message-date.util', () => {
  it('parses YYYY-MM-DD to end of UTC day', () => {
    const d = parseDisplayUntilInput('2026-05-15');
    expect(d.toISOString()).toBe('2026-05-15T23:59:59.999Z');
  });

  it('rejects invalid calendar dates', () => {
    expect(() => parseDisplayUntilInput('2026-02-30')).toThrow();
  });

  it('treats display-until day as inclusive', () => {
    const displayUntil = parseDisplayUntilInput('2026-05-15');
    const duringDay = new Date('2026-05-15T12:00:00.000Z');
    const afterDay = new Date('2026-05-16T00:00:00.001Z');
    expect(isDisplayUntilExpired(displayUntil, duringDay)).toBe(false);
    expect(isDisplayUntilExpired(displayUntil, afterDay)).toBe(true);
  });

  it('allows today and future display-until dates', () => {
    const today = startOfUtcDay(new Date('2026-05-15T10:00:00.000Z'));
    const displayUntil = endOfUtcDisplayDay(today);
    expect(isDisplayUntilOnOrAfterToday(displayUntil, today)).toBe(true);
    const yesterday = endOfUtcDisplayDay(new Date('2026-05-14T10:00:00.000Z'));
    expect(isDisplayUntilOnOrAfterToday(yesterday, today)).toBe(false);
  });
});
