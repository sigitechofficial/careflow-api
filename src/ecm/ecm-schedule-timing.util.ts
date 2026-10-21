import { dayKeyInTimeZone } from '../common/utils/operational-day.util';

/**
 * Schedule-change timing flags (BE1.26 / BE1.27 helpers).
 * Late-notice default: change within 2 hours of previous due start.
 */
export const LATE_NOTICE_THRESHOLD_MS = 2 * 60 * 60_000;

export type ScheduleTimingFlags = {
  beforeDueTime: boolean;
  lateNotice: boolean;
  retrospective: boolean;
  sameDay: boolean;
};

export function deriveScheduleTimingFlags(
  previousStart: Date,
  changedAt: Date,
  newStart: Date,
  lateNoticeThresholdMs = LATE_NOTICE_THRESHOLD_MS,
  /** Organisation timezone — "same day" means the same org-local calendar day. */
  timeZone: string = 'UTC',
): ScheduleTimingFlags {
  const beforeDueTime = changedAt.getTime() <= previousStart.getTime();
  const msBeforeDue = previousStart.getTime() - changedAt.getTime();
  const lateNotice =
    beforeDueTime && msBeforeDue >= 0 && msBeforeDue < lateNoticeThresholdMs;
  const retrospective = changedAt.getTime() > previousStart.getTime();
  const previousDay = dayKeyInTimeZone(previousStart, timeZone);
  const sameDay =
    previousDay === dayKeyInTimeZone(newStart, timeZone) &&
    previousDay === dayKeyInTimeZone(changedAt, timeZone);

  return { beforeDueTime, lateNotice, retrospective, sameDay };
}

export function suggestChangeClass(flags: ScheduleTimingFlags): string {
  if (flags.retrospective) return 'RETROSPECTIVE';
  if (flags.lateNotice) return 'LATE_NOTICE';
  if (flags.sameDay) return 'SAME_DAY';
  return 'PLANNED';
}
