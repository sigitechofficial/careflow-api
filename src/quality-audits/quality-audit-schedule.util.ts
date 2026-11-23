/**
 * Audit schedules: due dates, the window an audit may be done in, and compliance levels.
 * Pure functions on calendar days ("YYYY-MM-DD", UTC), so the service, the screens and the tests share
 * one calculation.
 */

export const AUDIT_FREQUENCIES = [
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
] as const;
export type AuditFrequency = (typeof AUDIT_FREQUENCIES)[number];

const MONTHS: Record<Exclude<AuditFrequency, 'WEEKLY'>, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  BIANNUAL: 6,
  ANNUAL: 12,
};

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const dayString = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + days);
  return dayString(d);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (toDate(to).getTime() - toDate(from).getTime()) / 86_400_000,
  );
}

/** The n-th due date of a series (n = 0 is the first). Months keep the first date's day, or the month's last day. */
export function nthDueDate(
  first: string,
  frequency: AuditFrequency,
  n: number,
): string {
  if (frequency === 'WEEKLY') return addDays(first, 7 * n);
  const d = toDate(first);
  const day = d.getUTCDate();
  const monthIndex = d.getUTCMonth() + MONTHS[frequency] * n;
  const year = d.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return dayString(new Date(Date.UTC(year, month, Math.min(day, lastDay))));
}

/** The first due date of the series after `after` (or the first one when `after` is null). */
export function nextDueDate(
  first: string,
  frequency: AuditFrequency,
  after: string | null,
): string {
  if (after === null || after < first) return first;
  // Start near the answer, then step forward.
  const span = frequency === 'WEEKLY' ? 7 : MONTHS[frequency] * 28;
  let n = Math.max(0, Math.floor(daysBetween(first, after) / span) - 1);
  let due = nthDueDate(first, frequency, n);
  while (due <= after) due = nthDueDate(first, frequency, ++n);
  return due;
}

/** Due dates of the series from `from` to `to`, both included. */
export function dueDatesBetween(
  first: string,
  frequency: AuditFrequency,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  let due = nextDueDate(first, frequency, addDays(from, -1));
  while (due <= to && out.length < 500) {
    out.push(due);
    due = nextDueDate(first, frequency, due);
  }
  return out;
}

/** Where an open audit (due or in progress) is against its window. */
export type AuditTiming = {
  /** First day it may be completed, its due date, and the last day before it is missed. */
  opensOn: string;
  dueDate: string;
  closesOn: string;
  /** UPCOMING: before the window; DUE: in the window up to the due date; OVERDUE: after the due date
   *  but before it is missed; MISSED: after the window. */
  state: 'UPCOMING' | 'DUE' | 'OVERDUE' | 'MISSED';
  /** Days until the due date (negative once past). */
  daysToDue: number;
  /** Days left before it is missed (negative once missed). */
  daysToClose: number;
};

export function auditTiming(
  dueDate: string,
  earlyDays: number,
  lateDays: number,
  today: string,
): AuditTiming {
  const opensOn = addDays(dueDate, -earlyDays);
  const closesOn = addDays(dueDate, lateDays);
  const state =
    today < opensOn
      ? 'UPCOMING'
      : today <= dueDate
        ? 'DUE'
        : today <= closesOn
          ? 'OVERDUE'
          : 'MISSED';
  return {
    opensOn,
    dueDate,
    closesOn,
    state,
    daysToDue: daysBetween(today, dueDate),
    daysToClose: daysBetween(today, closesOn),
  };
}

export const COMPLIANCE_LEVELS = [
  'COMPLIANT',
  'PARTIALLY_COMPLIANT',
  'NOT_COMPLIANT',
] as const;
export type ComplianceLevel = (typeof COMPLIANCE_LEVELS)[number];

/** The bands: 90% or more compliant, 75% or more partially compliant, below that not compliant. */
export const COMPLIANCE_BANDS = { compliant: 90, partially: 75 } as const;

export function complianceLevel(
  percent: number | null,
): ComplianceLevel | null {
  if (percent === null) return null;
  if (percent >= COMPLIANCE_BANDS.compliant) return 'COMPLIANT';
  if (percent >= COMPLIANCE_BANDS.partially) return 'PARTIALLY_COMPLIANT';
  return 'NOT_COMPLIANT';
}

/** "2026-11" for each month from `fromMonth` for `count` months. */
export function monthsFrom(fromMonth: string, count: number): string[] {
  const [y, m] = fromMonth.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}
