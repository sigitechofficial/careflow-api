import {
  addDaysToIsoDate,
  currentHourInTimeZone,
  endOfMonthIsoDate,
  resolveInitialRotaToDate,
  resolveRollingRotaDayToGenerate,
  ROTA_ROLLING_TIMEZONE,
} from './visit-plan-rolling-rota.util';

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

  it('reads hour in Europe/London', () => {
    const noonUtc = new Date('2026-01-15T12:00:00.000Z');
    expect(currentHourInTimeZone(noonUtc, ROTA_ROLLING_TIMEZONE)).toBe(12);
  });

  it('endOfMonthIsoDate handles month boundaries', () => {
    expect(endOfMonthIsoDate('2026-06-01')).toBe('2026-06-30');
  });
});
