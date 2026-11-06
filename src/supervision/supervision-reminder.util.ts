import type { SupervisionSettings } from '../organisation-general-settings/supervision-settings.util';

const DAY_MS = 86_400_000;

/** Whole days from `today` to `due` (both YYYY-MM-DD); negative when overdue. */
export function daysUntil(dueIsoDate: string, todayIsoDate: string): number {
  return Math.round((Date.parse(`${dueIsoDate}T00:00:00Z`) - Date.parse(`${todayIsoDate}T00:00:00Z`)) / DAY_MS);
}

export type DueReminder = {
  /** Stored on SupervisionReminderLog with the due date, so each one is sent once. */
  kind: string;
  /** Days until due (negative = overdue). */
  days: number;
  /** Before the due date (a session already booked by then makes it unnecessary). */
  beforeDue: boolean;
  escalation: boolean;
};

/**
 * Reminders due today for one review. Each configured offset is a threshold: the latest one
 * crossed is returned, so a day the job did not run is caught up once, and a review that is
 * already long overdue gets one reminder rather than one per missed offset. Escalation to
 * branch managers is separate and sent once per due date.
 */
export function remindersDue(
  days: number,
  settings: Pick<SupervisionSettings, 'reminderDaysBefore' | 'reminderDaysAfter' | 'escalateAfterDays'>,
): DueReminder[] {
  const out: DueReminder[] = [];
  if (days >= 0) {
    const crossed = settings.reminderDaysBefore.filter((d) => d >= days);
    if (crossed.length) {
      const threshold = Math.min(...crossed);
      out.push({ kind: threshold === 0 ? 'DUE_TODAY' : `DUE_IN_${threshold}`, days, beforeDue: true, escalation: false });
    }
    return out;
  }
  const overdue = -days;
  const crossed = settings.reminderDaysAfter.filter((d) => d <= overdue);
  if (crossed.length) {
    out.push({ kind: `OVERDUE_${Math.max(...crossed)}`, days, beforeDue: false, escalation: false });
  }
  if (settings.escalateAfterDays > 0 && overdue >= settings.escalateAfterDays) {
    out.push({ kind: 'ESCALATION', days, beforeDue: false, escalation: true });
  }
  return out;
}

/** "due in 7 days", "due today", "overdue by 3 days". */
export function dueText(days: number): string {
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days > 1) return `due in ${days} days`;
  return `overdue by ${-days} day${days === -1 ? '' : 's'}`;
}

/**
 * Who hears about it. The named supervisor gets reminders; branch managers get them when no one
 * is named (so a carer is never forgotten), on every reminder when the setting asks, and always
 * on escalation. The carer is pushed except for escalations.
 */
export function reminderAudience(
  reminder: Pick<DueReminder, 'escalation'>,
  settings: Pick<SupervisionSettings, 'notifySupervisor' | 'notifyCarer' | 'managersOnAllReminders'>,
  hasNamedSupervisor: boolean,
): { supervisor: boolean; managers: boolean; carer: boolean } {
  if (reminder.escalation) return { supervisor: hasNamedSupervisor, managers: true, carer: false };
  return {
    supervisor: settings.notifySupervisor && hasNamedSupervisor,
    managers: settings.managersOnAllReminders || (settings.notifySupervisor && !hasNamedSupervisor),
    carer: settings.notifyCarer,
  };
}
