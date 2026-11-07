import { Prisma } from '@prisma/client';

/**
 * Staff reminders for policies they still need to read and acknowledge (job
 * `policy-acknowledgement-reminders`). Same threshold model as supervision reminders: the latest
 * threshold crossed is returned, so a day the job did not run is caught up once, and each kind is
 * sent once per acknowledgement row (claimed in PolicyAcknowledgement.metadata.reminders).
 *
 *   3 days before the due date ......... DUE_IN_3   (days left 3, 2 or 1)
 *   on the due date ..................... DUE_TODAY
 *   1 day overdue ....................... OVERDUE_1  (overdue 1–7 days)
 *   then every 7 days while overdue ..... OVERDUE_8, OVERDUE_15, OVERDUE_22, …
 */

const DAY_MS = 86_400_000;

export const POLICY_REMINDER_DAYS_BEFORE = 3;
export const POLICY_REMINDER_OVERDUE_EVERY_DAYS = 7;

export type PolicyReminder = {
  /** Claimed once per acknowledgement row. */
  kind: string;
  /** Days until due (negative = overdue). */
  days: number;
  overdue: boolean;
};

/** Whole days from `today` to `due` (both YYYY-MM-DD); negative when overdue. */
export function daysUntil(dueIsoDate: string, todayIsoDate: string): number {
  return Math.round((Date.parse(`${dueIsoDate}T00:00:00Z`) - Date.parse(`${todayIsoDate}T00:00:00Z`)) / DAY_MS);
}

export function policyReminderDue(days: number): PolicyReminder | null {
  if (days > POLICY_REMINDER_DAYS_BEFORE) return null;
  if (days > 0) return { kind: `DUE_IN_${POLICY_REMINDER_DAYS_BEFORE}`, days, overdue: false };
  if (days === 0) return { kind: 'DUE_TODAY', days, overdue: false };
  const overdueDays = -days;
  const step = 1 + POLICY_REMINDER_OVERDUE_EVERY_DAYS * Math.floor((overdueDays - 1) / POLICY_REMINDER_OVERDUE_EVERY_DAYS);
  return { kind: `OVERDUE_${step}`, days, overdue: true };
}

/** "due in 3 days", "due today", "overdue by 8 days". */
export function policyDueText(days: number): string {
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days > 1) return `due in ${days} days`;
  return `overdue by ${-days} day${days === -1 ? '' : 's'}`;
}

/** Monday (YYYY-MM-DD) of the ISO week containing `isoDate`: the weekly manager summary key. */
export function isoWeekKey(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(date.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Reminder state kept in PolicyAcknowledgement.metadata:
 * { notifiedAt?, dueAt?, reminders: { [kind]: { at, pushed, notified } } }.
 */
export type AcknowledgementReminderMetadata = {
  notifiedAt?: string;
  dueAt?: string | null;
  reminders?: Record<string, { at: string; pushed?: boolean; notified?: boolean }>;
  [key: string]: unknown;
};

export function readReminderMetadata(value: Prisma.JsonValue | null | undefined): AcknowledgementReminderMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const meta = value as AcknowledgementReminderMetadata;
  const reminders = meta.reminders && typeof meta.reminders === 'object' && !Array.isArray(meta.reminders) ? meta.reminders : {};
  return { ...meta, reminders };
}

export function reminderAlreadySent(metadata: Prisma.JsonValue | null | undefined, kind: string): boolean {
  return Boolean(readReminderMetadata(metadata).reminders?.[kind]);
}

export function withReminder(
  metadata: Prisma.JsonValue | null | undefined,
  kind: string,
  entry: { at: string; pushed?: boolean; notified?: boolean },
): AcknowledgementReminderMetadata {
  const meta = readReminderMetadata(metadata);
  return { ...meta, reminders: { ...(meta.reminders ?? {}), [kind]: entry } };
}

export function withoutReminder(
  metadata: Prisma.JsonValue | null | undefined,
  kind: string,
): AcknowledgementReminderMetadata {
  const meta = readReminderMetadata(metadata);
  const reminders = { ...(meta.reminders ?? {}) };
  delete reminders[kind];
  return { ...meta, reminders };
}
