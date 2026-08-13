import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  operationalTodayIso,
} from '../common/utils/operational-day.util';

export type RotaHorizonMode = 'FIXED_DAYS' | 'CALENDAR_MONTH';

/** @deprecated Prefer DEFAULT_OPERATIONAL_TIMEZONE — fallback only. */
export const ROTA_ROLLING_TIMEZONE = DEFAULT_OPERATIONAL_TIMEZONE;

export const DEFAULT_ROTA_HORIZON_DAYS = 28;
export const DEFAULT_AUTO_EXTEND_ROTA_RUN_HOUR = 12;

export function parseRotaHorizonMode(value: string | null | undefined): RotaHorizonMode {
  return value === 'CALENDAR_MONTH' ? 'CALENDAR_MONTH' : 'FIXED_DAYS';
}

export function formatIsoDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function currentHourInTimeZone(date: Date, timeZone: string): number {
  const hourPart = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date).find((part) => part.type === 'hour');
  return Number(hourPart?.value ?? 0);
}

export function parseIsoDateUtc(isoDate: string): Date | null {
  const trimmed = isoDate?.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = parseIsoDateUtc(isoDate);
  if (!date) return isoDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function endOfMonthIsoDate(isoDate: string): string {
  const date = parseIsoDateUtc(isoDate);
  if (!date) return isoDate;
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

export function operationalRotaTodayIsoDate(
  now = new Date(),
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  return operationalTodayIso(now, timeZone);
}

/** @deprecated Prefer operationalRotaTodayIsoDate(now, orgTimezone). */
export function londonTodayIsoDate(now = new Date()): string {
  return operationalRotaTodayIsoDate(now, ROTA_ROLLING_TIMEZONE);
}

/** Day at the far edge of the rolling window (today + horizonDays). */
export function resolveRollingRotaDayToGenerate(todayIso: string, horizonDays: number): string {
  return addDaysToIsoDate(todayIso, horizonDays);
}

export function resolveInitialRotaToDate(
  fromDate: string,
  mode: RotaHorizonMode,
  horizonDays: number,
): string {
  if (mode === 'CALENDAR_MONTH') {
    return endOfMonthIsoDate(fromDate);
  }
  return addDaysToIsoDate(fromDate, horizonDays - 1);
}

export function clampRotaHorizonDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ROTA_HORIZON_DAYS;
  return Math.min(90, Math.max(1, Math.round(value)));
}

export function clampAutoExtendRotaRunHour(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUTO_EXTEND_ROTA_RUN_HOUR;
  return Math.min(23, Math.max(0, Math.round(value)));
}
