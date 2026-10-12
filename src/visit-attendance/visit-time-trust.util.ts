/**
 * Attendance time trust (VW-02).
 *
 * The carer app may report a start and finish time when a visit is completed. Those are evidence,
 * not facts: the server keeps what it observed itself (the check-in it recorded, the moment the
 * completion arrived) next to what the device reported, and decides which becomes the recorded
 * attendance.
 *
 *   start  – the server-recorded check-in whenever there is one. A reported start is used only
 *            when no check-in was recorded, and is then flagged for office review.
 *   finish – the reported finish when it is no more than the tolerance before the completion
 *            reached the server; otherwise it is still used (offline visits sync late) but flagged
 *            for office review. A finish in the future is refused.
 *
 * A flag holds the visit for a person to approve; it does not refuse pay.
 */

export type VisitTimeSource = 'SERVER' | 'CARER_REPORTED' | 'NONE';

export type TrustedCompletionTimes = {
  start: Date | null;
  end: Date;
  startSource: VisitTimeSource;
  endSource: VisitTimeSource;
  /** True when a carer-reported time the server could not corroborate became the record. */
  needsReview: boolean;
  /** Plain-language reasons shown to the reviewer. */
  reviewReasons: string[];
  evidence: {
    serverReceivedAt: string;
    serverCheckInAt: string | null;
    reportedStart: string | null;
    reportedEnd: string | null;
  };
};

/** Default gap allowed between a reported finish and the server receiving the completion. */
export const DEFAULT_TIME_TRUST_TOLERANCE_MINUTES = 15;

/** A device clock slightly ahead of the server is not a future time. */
const FUTURE_SLACK_MS = 2 * 60_000;

export class FutureVisitTimeError extends Error {}

const parse = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const minutesApart = (a: Date, b: Date) => Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);

export function resolveTrustedCompletionTimes(input: {
  serverNow: Date;
  serverCheckInAt?: Date | null;
  reportedStart?: string | Date | null;
  reportedEnd?: string | Date | null;
  toleranceMinutes?: number;
}): TrustedCompletionTimes {
  const tolerance = input.toleranceMinutes ?? DEFAULT_TIME_TRUST_TOLERANCE_MINUTES;
  const now = input.serverNow;
  const checkIn = input.serverCheckInAt ?? null;
  const reportedStart = parse(input.reportedStart);
  const reportedEnd = parse(input.reportedEnd);
  const reviewReasons: string[] = [];

  if (reportedEnd && reportedEnd.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    throw new FutureVisitTimeError('The finish time cannot be in the future.');
  }
  if (reportedStart && reportedStart.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    throw new FutureVisitTimeError('The start time cannot be in the future.');
  }

  let end = now;
  let endSource: VisitTimeSource = 'SERVER';
  if (reportedEnd) {
    end = reportedEnd.getTime() > now.getTime() ? now : reportedEnd;
    endSource = 'CARER_REPORTED';
    const gap = minutesApart(now, reportedEnd);
    if (gap > tolerance) {
      reviewReasons.push(
        `Finish time was reported by the carer ${gap} minutes before the server received the completion.`,
      );
    }
  }

  let start: Date | null = null;
  let startSource: VisitTimeSource = 'NONE';
  if (checkIn) {
    start = checkIn;
    startSource = 'SERVER';
  } else if (reportedStart) {
    start = reportedStart;
    startSource = 'CARER_REPORTED';
    reviewReasons.push('Start time was reported by the carer; no check-in was recorded.');
  }

  if (start && start.getTime() >= end.getTime()) {
    reviewReasons.push('The recorded start is not before the finish.');
  }

  return {
    start,
    end,
    startSource,
    endSource,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    evidence: {
      serverReceivedAt: now.toISOString(),
      serverCheckInAt: checkIn?.toISOString() ?? null,
      reportedStart: reportedStart?.toISOString() ?? null,
      reportedEnd: reportedEnd?.toISOString() ?? null,
    },
  };
}

/** Shape stored on the job metadata (employeeApp.attendanceTimes) and read by visit reconciliation. */
export type StoredAttendanceTimeTrust = {
  needsReview: boolean;
  reviewReasons: string[];
  startSource: VisitTimeSource;
  endSource: VisitTimeSource;
  evidence: TrustedCompletionTimes['evidence'];
  /** Set when the office has verified or corrected the times. */
  verifiedAt?: string | null;
  verifiedByUserId?: string | null;
};

/** Reasons still awaiting office review for a job's metadata, or [] when there is nothing to review. */
export function unverifiedTimeReasons(jobMetadata: unknown): string[] {
  const meta = jobMetadata as { employeeApp?: { attendanceTimes?: StoredAttendanceTimeTrust } } | null;
  const trust = meta?.employeeApp?.attendanceTimes;
  if (!trust || !trust.needsReview || trust.verifiedAt) return [];
  return Array.isArray(trust.reviewReasons) ? trust.reviewReasons.filter((r) => typeof r === 'string') : [];
}
