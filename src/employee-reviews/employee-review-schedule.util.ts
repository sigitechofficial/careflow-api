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
): T {
  return { ...review, status: deriveReviewStatus(review, now) ?? review.status };
}
