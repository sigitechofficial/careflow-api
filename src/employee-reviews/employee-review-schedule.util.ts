/**
 * Staff review (supervision, appraisal, probation…) due dates and status.
 * The API is the single source: next due comes from the review type interval, and status is
 * worked out from the dates every time, so it never goes stale in the database.
 */

export type EmployeeReviewStatus = 'SCHEDULED' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED';

/** A review counts as "due soon" this many days before its next due date. */
export const REVIEW_DUE_SOON_DAYS = 14;

const DAY_MS = 86_400_000;

function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Last done + interval days (calendar days, UTC). Null when either is missing. */
export function computeReviewNextDue(
  lastDone: Date | null | undefined,
  intervalDays: number | null | undefined,
): Date | null {
  if (!lastDone || intervalDays == null || !Number.isFinite(intervalDays) || intervalDays < 1) {
    return null;
  }
  return new Date(lastDone.getTime() + Math.round(intervalDays) * DAY_MS);
}

/**
 * OVERDUE once the due day has passed, DUE_SOON within the warning window, SCHEDULED before
 * that. A review with no next due (a one-off such as Return to Work) is COMPLETED once done.
 */
export function deriveReviewStatus(
  review: { lastDone?: Date | null; nextDue?: Date | null },
  now: Date = new Date(),
  dueSoonDays: number = REVIEW_DUE_SOON_DAYS,
): EmployeeReviewStatus | null {
  if (review.nextDue) {
    const due = utcDayStart(review.nextDue);
    const today = utcDayStart(now);
    if (due < today) return 'OVERDUE';
    if (due - today <= dueSoonDays * DAY_MS) return 'DUE_SOON';
    return 'SCHEDULED';
  }
  return review.lastDone ? 'COMPLETED' : null;
}

/** Same row with its status worked out for today. */
export function withDerivedReviewStatus<T extends { lastDone: Date | null; nextDue: Date | null; status: string | null }>(
  review: T,
  now: Date = new Date(),
  dueSoonDays: number = REVIEW_DUE_SOON_DAYS,
): T {
  return { ...review, status: deriveReviewStatus(review, now, dueSoonDays) ?? review.status };
}

// ─── Schedules (ReviewType.scheduleKind) ────────────────────────────────────────────────────

/** The parts of a review type that decide when it is due and who for. */
export type ReviewSchedule = {
  scheduleKind: 'REPEATING' | 'MILESTONES' | 'EVENT';
  defaultIntervalDays: number | null;
  firstDueAfterStartDays: number | null;
  milestoneDays: number[];
  audience: 'ALL_STAFF' | 'NMC_REGISTRANTS';
};

export const REVIEW_SCHEDULE_SELECT = {
  scheduleKind: true,
  defaultIntervalDays: true,
  firstDueAfterStartDays: true,
  milestoneDays: true,
  audience: true,
} as const;

function addDays(d: Date, days: number): Date {
  return new Date(utcDayStart(d) + Math.round(days) * DAY_MS);
}

/** Whether the review type is for this member of staff (NMC types: staff with an NMC PIN). */
export function reviewAppliesTo(
  schedule: Pick<ReviewSchedule, 'audience'>,
  staff: { nmcPinNumber?: string | null },
): boolean {
  return schedule.audience === 'ALL_STAFF' || Boolean(staff.nmcPinNumber?.trim());
}

/**
 * Next due date after a review done on `lastDone` (null = none done yet).
 * - REPEATING: last done + interval; the first one is due `firstDueAfterStartDays` (else the
 *   interval) after the start date.
 * - MILESTONES: the next milestone after the start date not yet covered. A review covers every
 *   milestone whose window has opened (halfway from the previous milestone), so a review held a
 *   little early or late counts for the milestone it was meant for. Null after the last one.
 * - EVENT: nothing until one is recorded; then last done + interval when the type has one (e.g.
 *   a performance plan every 14 days).
 */
export function scheduledNextDue(
  schedule: ReviewSchedule,
  input: { lastDone: Date | null; startDate: Date | null },
): Date | null {
  const interval = schedule.defaultIntervalDays && schedule.defaultIntervalDays > 0 ? schedule.defaultIntervalDays : null;
  const { lastDone, startDate } = input;
  switch (schedule.scheduleKind) {
    case 'REPEATING':
      if (!interval) return null;
      if (lastDone) return addDays(lastDone, interval);
      return startDate ? addDays(startDate, schedule.firstDueAfterStartDays ?? interval) : null;
    case 'EVENT':
      return lastDone && interval ? addDays(lastDone, interval) : null;
    case 'MILESTONES': {
      if (!startDate) return null;
      const days = [...new Set(schedule.milestoneDays.filter((d) => d > 0))].sort((a, b) => a - b);
      const done = lastDone ? utcDayStart(lastDone) : null;
      let previous = 0;
      for (const d of days) {
        const opens = utcDayStart(startDate) + ((previous + d) / 2) * DAY_MS;
        if (done === null || done < opens) return addDays(startDate, d);
        previous = d;
      }
      return null;
    }
  }
}

/**
 * The due date to show and remind on. Milestones always follow the schedule (policy dates from
 * the start date); otherwise a date on the record (set by hand or by the last review) wins, and a
 * repeating review with no record yet is due from the start date.
 */
export function effectiveNextDue(
  schedule: ReviewSchedule,
  tracker: { lastDone: Date | null; nextDue: Date | null } | null,
  startDate: Date | null,
): Date | null {
  if (schedule.scheduleKind === 'MILESTONES') {
    return scheduledNextDue(schedule, { lastDone: tracker?.lastDone ?? null, startDate });
  }
  if (tracker) return tracker.nextDue ?? scheduledNextDue(schedule, { lastDone: tracker.lastDone, startDate });
  return schedule.scheduleKind === 'REPEATING' ? scheduledNextDue(schedule, { lastDone: null, startDate }) : null;
}
