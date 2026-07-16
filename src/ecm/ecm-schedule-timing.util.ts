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
): ScheduleTimingFlags {
  const beforeDueTime = changedAt.getTime() <= previousStart.getTime();
  const msBeforeDue = previousStart.getTime() - changedAt.getTime();
  const lateNotice =
    beforeDueTime && msBeforeDue >= 0 && msBeforeDue < lateNoticeThresholdMs;
  const retrospective = changedAt.getTime() > previousStart.getTime();
  const sameDay =
    previousStart.toISOString().slice(0, 10) === newStart.toISOString().slice(0, 10) &&
    previousStart.toISOString().slice(0, 10) === changedAt.toISOString().slice(0, 10);

  return { beforeDueTime, lateNotice, retrospective, sameDay };
}

export function suggestChangeClass(flags: ScheduleTimingFlags): string {
  if (flags.retrospective) return 'RETROSPECTIVE';
  if (flags.lateNotice) return 'LATE_NOTICE';
  if (flags.sameDay) return 'SAME_DAY';
  return 'PLANNED';
}
