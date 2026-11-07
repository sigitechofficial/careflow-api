import type { Prisma } from '@prisma/client';

/**
 * Settings → Supervision (docs/SUPERVISION_MODULE_PLAN.md, phases 2 and 3). Stored as JSON on
 * the organisation settings row; unknown keys are dropped on the next save.
 */
export type SupervisionSettings = {
  /** A session is only Completed once every carer has signed (or commented). */
  requireCarerSignature: boolean;
  /** Carers can say they do not agree with the record, with a comment. */
  allowCarerDisagree: boolean;
  /** Confidential notes section on sessions (visible with supervision.read_confidential). */
  confidentialNotesEnabled: boolean;
  /** Every required question on the session form must be answered before the supervisor signs. */
  requireFormAnswers: boolean;

  /** Daily supervision-due reminders (job `supervision-reminders`). */
  remindersEnabled: boolean;
  /** Hour of day (0–23, organisation timezone) the reminders go out. */
  reminderHour: number;
  /** A review shows as Due soon this many days before it is due. */
  dueSoonDays: number;
  /** Remind this many days before the due date (0 = on the day). */
  reminderDaysBefore: number[];
  /** Remind again this many days after the due date while still not done. */
  reminderDaysAfter: number[];
  /** Overdue by this many days → branch managers are told too (0 = never). */
  escalateAfterDays: number;
  /** Remind the carer's named supervisor. */
  notifySupervisor: boolean;
  /** Push a reminder to the carer's phone. */
  notifyCarer: boolean;
  /** Branch managers get every reminder, not only escalations (they always do when no supervisor is named). */
  managersOnAllReminders: boolean;
  /** Email staff reminders as well as the in-app notification. */
  emailReminders: boolean;
  /** Completing a session books the next one on its due date. */
  autoScheduleNext: boolean;
};

export const DEFAULT_SUPERVISION_SETTINGS: SupervisionSettings = {
  requireCarerSignature: true,
  allowCarerDisagree: true,
  confidentialNotesEnabled: true,
  requireFormAnswers: true,
  remindersEnabled: true,
  reminderHour: 8,
  dueSoonDays: 14,
  reminderDaysBefore: [14, 7, 1, 0],
  reminderDaysAfter: [1, 7, 14],
  escalateAfterDays: 7,
  notifySupervisor: true,
  notifyCarer: true,
  managersOnAllReminders: false,
  emailReminders: true,
  autoScheduleNext: false,
};

export const MAX_REMINDER_OFFSETS = 8;
export const MAX_REMINDER_OFFSET_DAYS = 365;

function intInRange(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** Unique whole days in range, largest first; falls back when nothing valid is given. */
function dayList(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const days = [
    ...new Set(
      v.filter(
        (d): d is number =>
          typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= MAX_REMINDER_OFFSET_DAYS,
      ),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, MAX_REMINDER_OFFSETS);
  return days;
}

export function parseSupervisionSettings(
  value: Prisma.JsonValue | null | undefined,
): SupervisionSettings {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const d = DEFAULT_SUPERVISION_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    requireCarerSignature: bool(raw.requireCarerSignature, d.requireCarerSignature),
    allowCarerDisagree: bool(raw.allowCarerDisagree, d.allowCarerDisagree),
    confidentialNotesEnabled: bool(raw.confidentialNotesEnabled, d.confidentialNotesEnabled),
    requireFormAnswers: bool(raw.requireFormAnswers, d.requireFormAnswers),
    remindersEnabled: bool(raw.remindersEnabled, d.remindersEnabled),
    reminderHour: intInRange(raw.reminderHour, 0, 23, d.reminderHour),
    dueSoonDays: intInRange(raw.dueSoonDays, 1, 90, d.dueSoonDays),
    reminderDaysBefore: dayList(raw.reminderDaysBefore, d.reminderDaysBefore),
    reminderDaysAfter: dayList(raw.reminderDaysAfter, d.reminderDaysAfter).filter((n) => n > 0),
    escalateAfterDays: intInRange(raw.escalateAfterDays, 0, MAX_REMINDER_OFFSET_DAYS, d.escalateAfterDays),
    notifySupervisor: bool(raw.notifySupervisor, d.notifySupervisor),
    notifyCarer: bool(raw.notifyCarer, d.notifyCarer),
    managersOnAllReminders: bool(raw.managersOnAllReminders, d.managersOnAllReminders),
    emailReminders: bool(raw.emailReminders, d.emailReminders),
    autoScheduleNext: bool(raw.autoScheduleNext, d.autoScheduleNext),
  };
}
