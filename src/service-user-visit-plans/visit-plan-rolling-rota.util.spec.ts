import {
  addDaysToIsoDate,
  currentHourInTimeZone,
  endOfMonthIsoDate,
  resolveInitialRotaToDate,
  resolveRollingRotaDayToGenerate,
  operationalRotaTodayIsoDate,
  ROTA_ROLLING_TIMEZONE,
} from './visit-plan-rolling-rota.util';
import { DEFAULT_OPERATIONAL_TIMEZONE } from '../common/utils/operational-day.util';

describe('visit-plan-rolling-rota.util', () => {
  it('resolves rolling day as today plus horizon days', () => {
    expect(resolveRollingRotaDayToGenerate('2026-06-01', 30)).toBe('2026-07-01');
    expect(resolveRollingRotaDayToGenerate('2026-06-01', 28)).toBe('2026-06-29');
  });

  it('resolves initial fixed-days horizon inclusively from fromDate', () => {
    expect(resolveInitialRotaToDate('2026-06-15', 'FIXED_DAYS', 28)).toBe('2026-07-12');
  });

  it('resolves initial calendar-month horizon to month end', () => {
    expect(resolveInitialRotaToDate('2026-06-15', 'CALENDAR_MONTH', 28)).toBe('2026-06-30');
    expect(resolveInitialRotaToDate('2026-02-10', 'CALENDAR_MONTH', 28)).toBe('2026-02-28');
  });

  it('adds days in UTC', () => {
    expect(addDaysToIsoDate('2026-06-15', 1)).toBe('2026-06-16');
  });

  it('reads hour in Europe/London (GMT and BST)', () => {
    const noonUtc = new Date('2026-01-15T12:00:00.000Z');
    expect(currentHourInTimeZone(noonUtc, 'Europe/London')).toBe(12);
    expect(currentHourInTimeZone(new Date('2026-07-15T12:00:00.000Z'), 'Europe/London')).toBe(13);
  });

  it('reads hour in the organisation timezone, not a fixed one (Asia/Karachi)', () => {
    expect(currentHourInTimeZone(new Date('2026-01-15T12:00:00.000Z'), 'Asia/Karachi')).toBe(17);
  });

  it('ROTA_ROLLING_TIMEZONE is only the last-resort fallback (DEFAULT_OPERATIONAL_TIMEZONE)', () => {
    expect(ROTA_ROLLING_TIMEZONE).toBe(DEFAULT_OPERATIONAL_TIMEZONE);
  });

  it('operational rota today follows the org timezone at a late-evening instant', () => {
    const lateLondon = new Date('2026-07-15T22:30:00.000Z'); // 23:30 BST / 03:30 PKT next day
    expect(operationalRotaTodayIsoDate(lateLondon, 'Europe/London')).toBe('2026-07-15');
    expect(operationalRotaTodayIsoDate(lateLondon, 'Asia/Karachi')).toBe('2026-07-16');
  });

  it('endOfMonthIsoDate handles month boundaries', () => {
    expect(endOfMonthIsoDate('2026-06-01')).toBe('2026-06-30');
  });
});
