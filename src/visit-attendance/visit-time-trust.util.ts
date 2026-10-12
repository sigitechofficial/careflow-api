/**
 * Attendance time trust (VW-02, VW-15, R-03, R-04).
 *
 * Three parties can say when a carer started and finished a visit: the server (the check-in it
 * recorded, the moment the completion arrived), the carer's device, and the office. They are kept
 * side by side as evidence, per carer, and one of them becomes the recorded attendance:
 *
 *   start  – an office-verified start if there is one; otherwise the server-recorded check-in;
 *            otherwise the start the carer reported, which is then flagged for office review.
 *   finish – an office-verified finish if there is one; otherwise the finish the carer reported when
 *            it is no more than the tolerance before the completion reached the server; a reported
 *            finish further back is still used (offline visits sync late) but flagged for review.
 *            A finish in the future is refused.
 *
 * A conflict between an office-verified time and what the carer then reports is never resolved
 * silently: the office time stays the record and the difference is flagged.
 *
 * A flag holds that carer's pay for a person to approve. It does not refuse pay, and it does not
 * touch another carer on the same visit.
 */

export type VisitTimeSource = 'SERVER' | 'CARER_REPORTED' | 'OFFICE' | 'NONE';

export type TrustedCompletionTimes = {
  start: Date | null;
  end: Date;
  startSource: VisitTimeSource;
  endSource: VisitTimeSource;
  /** True when the recorded times need a person to look at them before pay is approved. */
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

/** A time the office entered for one carer, with who entered it and why. */
export type OfficeAttendanceTimes = {
  start?: string | null;
  end?: string | null;
  byUserId: string;
  at: string;
  reason?: string | null;
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
  /** Times the office verified for this carer before the visit was completed. */
  officeStart?: string | Date | null;
  officeEnd?: string | Date | null;
  toleranceMinutes?: number;
}): TrustedCompletionTimes {
  const tolerance = input.toleranceMinutes ?? DEFAULT_TIME_TRUST_TOLERANCE_MINUTES;
  const now = input.serverNow;
  const checkIn = input.serverCheckInAt ?? null;
  const reportedStart = parse(input.reportedStart);
  const reportedEnd = parse(input.reportedEnd);
  const officeStart = parse(input.officeStart);
  const officeEnd = parse(input.officeEnd);
  const reviewReasons: string[] = [];

  if (reportedEnd && reportedEnd.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    throw new FutureVisitTimeError('The finish time cannot be in the future.');
  }
  if (reportedStart && reportedStart.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    throw new FutureVisitTimeError('The start time cannot be in the future.');
  }

  let end = now;
  let endSource: VisitTimeSource = 'SERVER';
  if (officeEnd) {
    end = officeEnd;
    endSource = 'OFFICE';
    if (reportedEnd && minutesApart(reportedEnd, officeEnd) > tolerance) {
      reviewReasons.push(
        `The office recorded the finish, and the carer then reported a finish ${minutesApart(reportedEnd, officeEnd)} minutes away from it.`,
      );
    }
  } else if (reportedEnd) {
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
  if (officeStart) {
    start = officeStart;
    startSource = 'OFFICE';
  } else if (checkIn) {
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

/**
 * One carer's time-trust record. Stored on the job metadata under
 * employeeApp.attendanceTimesByEmployee[employeeId] and read by visit reconciliation.
 *
 * The record is per carer: on a double-up visit one carer's unverified time holds that carer's
 * pay for review and leaves the other carer's pay alone (R-03).
 */
export type StoredAttendanceTimeTrust = {
  needsReview: boolean;
  reviewReasons: string[];
  startSource: VisitTimeSource;
  endSource: VisitTimeSource;
  evidence: TrustedCompletionTimes['evidence'] | null;
  /** Times the office entered for this carer (kept whether or not the visit is completed yet). */
  office?: OfficeAttendanceTimes | null;
  /** Set when the office has verified or corrected this carer's times after completion. */
  verifiedAt?: string | null;
  verifiedByUserId?: string | null;
};

type JobMetadataWithTrust = Record<string, unknown> & {
  employeeApp?: Record<string, unknown> & {
    attendanceTimesByEmployee?: Record<string, StoredAttendanceTimeTrust>;
    /** Visit-wide record written before trust was kept per carer. */
    attendanceTimes?: StoredAttendanceTimeTrust;
  };
};

const asMetadata = (jobMetadata: unknown): JobMetadataWithTrust =>
  jobMetadata && typeof jobMetadata === 'object' ? (jobMetadata as JobMetadataWithTrust) : {};

const EMPTY_TRUST: StoredAttendanceTimeTrust = {
  needsReview: false,
  reviewReasons: [],
  startSource: 'NONE',
  endSource: 'NONE',
  evidence: null,
};

/** This carer's record, or undefined when nothing has been recorded for them. */
export function attendanceTimeTrustFor(
  jobMetadata: unknown,
  employeeId: string,
): StoredAttendanceTimeTrust | undefined {
  return asMetadata(jobMetadata).employeeApp?.attendanceTimesByEmployee?.[employeeId];
}

function withRecord(
  jobMetadata: unknown,
  employeeId: string,
  record: StoredAttendanceTimeTrust,
): Record<string, unknown> {
  const meta = asMetadata(jobMetadata);
  const employeeApp = meta.employeeApp ?? {};
  return {
    ...meta,
    employeeApp: {
      ...employeeApp,
      attendanceTimesByEmployee: { ...(employeeApp.attendanceTimesByEmployee ?? {}), [employeeId]: record },
    },
  };
}

/**
 * Job metadata with the outcome of this carer's completion recorded. Office times already entered
 * for the carer are kept. Other carers' records are untouched.
 */
export function withAttendanceTimeTrust(
  jobMetadata: unknown,
  employeeId: string,
  times: TrustedCompletionTimes,
): Record<string, unknown> {
  const previous = attendanceTimeTrustFor(jobMetadata, employeeId);
  return withRecord(jobMetadata, employeeId, {
    needsReview: times.needsReview,
    reviewReasons: times.reviewReasons,
    startSource: times.startSource,
    endSource: times.endSource,
    evidence: times.evidence,
    office: previous?.office ?? null,
    verifiedAt: null,
    verifiedByUserId: null,
  });
}

/**
 * Job metadata with an office-entered start or finish for this carer.
 * `verified` marks the carer's times as checked by the office (used when the visit is already
 * completed, where the corrected time is applied straight away). Before completion the time is
 * only recorded here and is taken into account when the visit completes.
 */
export function withOfficeAttendanceTime(
  jobMetadata: unknown,
  employeeId: string,
  input: {
    eventType: 'CHECK_IN' | 'CHECK_OUT';
    occurredAt: Date;
    byUserId: string;
    reason?: string | null;
    verified: boolean;
    at?: Date;
  },
): Record<string, unknown> {
  const at = (input.at ?? new Date()).toISOString();
  const previous = attendanceTimeTrustFor(jobMetadata, employeeId) ?? EMPTY_TRUST;
  const office: OfficeAttendanceTimes = {
    start: previous.office?.start ?? null,
    end: previous.office?.end ?? null,
    byUserId: input.byUserId,
    at,
    reason: input.reason ?? null,
  };
  if (input.eventType === 'CHECK_IN') office.start = input.occurredAt.toISOString();
  else office.end = input.occurredAt.toISOString();
  return withRecord(jobMetadata, employeeId, {
    ...previous,
    office,
    ...(input.verified ? { verifiedAt: at, verifiedByUserId: input.byUserId } : {}),
  });
}

/**
 * Reasons this carer's times still await office review, or [] when there is nothing to review.
 * A carer with an own record is judged on it alone. Without `employeeId`, or for a visit recorded
 * before trust was kept per carer, the visit-wide record applies.
 */
export function unverifiedTimeReasons(jobMetadata: unknown, employeeId?: string | null): string[] {
  const employeeApp = asMetadata(jobMetadata).employeeApp;
  const mine = employeeId ? employeeApp?.attendanceTimesByEmployee?.[employeeId] : undefined;
  const trust = mine ?? employeeApp?.attendanceTimes;
  if (!trust || !trust.needsReview || trust.verifiedAt) return [];
  return Array.isArray(trust.reviewReasons) ? trust.reviewReasons.filter((r) => typeof r === 'string') : [];
}
