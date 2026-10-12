/**
 * Per-carer attendance verification records (R-16).
 *
 * One row per visit job and carer holds what `visit-time-trust.util` decides. Every change locks
 * that one row, merges into it and appends a history entry in the same transaction, so:
 *   - two carers completing the same double-up write to different rows and cannot overwrite each
 *     other's evidence;
 *   - an office correction and a completion for the same carer, or two office corrections, are
 *     applied one after the other, each seeing the other's result;
 *   - the same device request delivered twice is recorded once (clientEventId).
 *
 * Records written before this table existed live in the job metadata
 * (employeeApp.attendanceTimesByEmployee). They are still read, and are copied into a row, with a
 * LEGACY_IMPORT history entry, the first time that carer's record is written. The metadata itself
 * is left as it is: it is historical evidence.
 */
import { Prisma } from '@prisma/client';
import {
  attendanceTimeTrustFor,
  mergeCompletion,
  mergeOfficeTime,
  type OfficeTimeInput,
  type StoredAttendanceTimeTrust,
  type TrustedCompletionTimes,
} from './visit-time-trust.util';

type Tx = Prisma.TransactionClient;
type Db = Tx & { $transaction?: unknown };

export type AttendanceVerificationKind =
  | 'COMPLETION'
  | 'LATE_CLOCK_OUT'
  | 'OFFICE_TIME'
  | 'LEGACY_IMPORT';

export type AttendanceVerification = StoredAttendanceTimeTrust & {
  /** Number of evidence changes recorded for this carer on this job. 0 = read from job metadata. */
  version: number;
};

type Row = {
  id: string;
  startSource: string;
  endSource: string;
  needsReview: boolean;
  reviewReasons: unknown;
  serverReceivedAt: Date | null;
  serverCheckInAt: Date | null;
  reportedStart: Date | null;
  reportedEnd: Date | null;
  officeStart: Date | null;
  officeEnd: Date | null;
  officeByUserId: string | null;
  officeAt: Date | null;
  officeReason: string | null;
  verifiedAt: Date | null;
  verifiedByUserId: string | null;
  version: number;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const date = (v: string | null | undefined) => (v ? new Date(v) : null);

function fromRow(row: Row): AttendanceVerification {
  const hasEvidence = row.serverReceivedAt != null;
  const hasOffice = row.officeAt != null && row.officeByUserId != null;
  return {
    needsReview: row.needsReview,
    reviewReasons: Array.isArray(row.reviewReasons)
      ? (row.reviewReasons as unknown[]).filter(
          (r): r is string => typeof r === 'string',
        )
      : [],
    startSource: row.startSource as StoredAttendanceTimeTrust['startSource'],
    endSource: row.endSource as StoredAttendanceTimeTrust['endSource'],
    evidence: hasEvidence
      ? {
          serverReceivedAt: (row.serverReceivedAt as Date).toISOString(),
          serverCheckInAt: iso(row.serverCheckInAt),
          reportedStart: iso(row.reportedStart),
          reportedEnd: iso(row.reportedEnd),
        }
      : null,
    office: hasOffice
      ? {
          start: iso(row.officeStart),
          end: iso(row.officeEnd),
          byUserId: row.officeByUserId as string,
          at: (row.officeAt as Date).toISOString(),
          reason: row.officeReason,
        }
      : null,
    verifiedAt: iso(row.verifiedAt),
    verifiedByUserId: row.verifiedByUserId,
    version: row.version,
  };
}

function toColumns(record: StoredAttendanceTimeTrust) {
  return {
    startSource: record.startSource,
    endSource: record.endSource,
    needsReview: record.needsReview,
    reviewReasons: record.reviewReasons as Prisma.InputJsonValue,
    serverReceivedAt: date(record.evidence?.serverReceivedAt),
    serverCheckInAt: date(record.evidence?.serverCheckInAt),
    reportedStart: date(record.evidence?.reportedStart),
    reportedEnd: date(record.evidence?.reportedEnd),
    officeStart: date(record.office?.start),
    officeEnd: date(record.office?.end),
    officeByUserId: record.office?.byUserId ?? null,
    officeAt: date(record.office?.at),
    officeReason: record.office?.reason ?? null,
    verifiedAt: date(record.verifiedAt),
    verifiedByUserId: record.verifiedByUserId ?? null,
  };
}

/** This carer's record: the row when there is one, else what older job metadata holds. */
export async function findAttendanceVerification(
  db: Tx,
  scheduledJobId: string,
  employeeId: string,
  legacyJobMetadata?: unknown,
): Promise<AttendanceVerification | undefined> {
  const row = await db.visitAttendanceVerification.findUnique({
    where: { scheduledJobId_employeeId: { scheduledJobId, employeeId } },
  });
  if (row) return fromRow(row);
  const legacy = attendanceTimeTrustFor(legacyJobMetadata, employeeId);
  return legacy ? { ...legacy, version: 0 } : undefined;
}

type ChangeInput = {
  scheduledJobId: string;
  employeeId: string;
  jobAllocationId?: string | null;
  kind: AttendanceVerificationKind;
  /** Identity the device gave the request; the same identity is recorded once. */
  clientEventId?: string | null;
  actorEmployeeId?: string | null;
  actorUserId?: string | null;
  /**
   * Decides the new state from the locked current state. Runs inside the transaction, so what it
   * reads cannot change under it. `payload` is what the history entry keeps.
   */
  merge: (previous: StoredAttendanceTimeTrust | undefined) => {
    next: StoredAttendanceTimeTrust;
    payload: Record<string, unknown>;
  };
};

export type AttendanceVerificationChange = {
  record: AttendanceVerification;
  /** False when this request had already been recorded (same clientEventId). */
  applied: boolean;
};

async function changeInTransaction(
  tx: Tx,
  input: ChangeInput,
): Promise<AttendanceVerificationChange> {
  const where = {
    scheduledJobId: input.scheduledJobId,
    employeeId: input.employeeId,
  };

  // Make sure the row exists, without failing when another request creates it at the same moment.
  const created = await tx.visitAttendanceVerification.createMany({
    data: [{ ...where, jobAllocationId: input.jobAllocationId ?? null }],
    skipDuplicates: true,
  });
  // Lock this carer's row: a second writer for the same carer waits here and then sees our result.
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "scheduling"."VisitAttendanceVerification"
    WHERE "scheduledJobId" = ${input.scheduledJobId}::uuid AND "employeeId" = ${input.employeeId}::uuid
    FOR UPDATE`;
  const id = locked[0].id;
  let row = await tx.visitAttendanceVerification.findUniqueOrThrow({
    where: { id },
  });

  // A record kept in job metadata before this table existed is brought in first, as it stood.
  if (created.count === 1 || row.version === 0) {
    const job = await tx.scheduledJob.findUnique({
      where: { id: input.scheduledJobId },
      select: { metadata: true },
    });
    const legacy = attendanceTimeTrustFor(job?.metadata, input.employeeId);
    if (legacy && row.version === 0) {
      row = await tx.visitAttendanceVerification.update({
        where: { id },
        data: { ...toColumns(legacy), version: 1 },
      });
      await tx.visitAttendanceVerificationEntry.create({
        data: {
          verificationId: id,
          kind: 'LEGACY_IMPORT',
          version: 1,
          payload: legacy,
        },
      });
    }
  }

  const clientEventId = input.clientEventId?.trim() || null;
  if (clientEventId) {
    const seen = await tx.visitAttendanceVerificationEntry.findUnique({
      where: {
        verificationId_clientEventId: { verificationId: id, clientEventId },
      },
      select: { id: true },
    });
    if (seen) return { record: fromRow(row), applied: false };
  }

  const previous = row.version === 0 ? undefined : fromRow(row);
  const { next, payload } = input.merge(previous);
  const version = row.version + 1;
  const updated = await tx.visitAttendanceVerification.update({
    where: { id },
    data: {
      ...toColumns(next),
      version,
      ...(input.jobAllocationId
        ? { jobAllocationId: input.jobAllocationId }
        : {}),
    },
  });
  await tx.visitAttendanceVerificationEntry.create({
    data: {
      verificationId: id,
      kind: input.kind,
      version,
      clientEventId,
      actorEmployeeId: input.actorEmployeeId ?? null,
      actorUserId: input.actorUserId ?? null,
      payload: payload as Prisma.InputJsonValue,
    },
  });
  return { record: fromRow(updated), applied: true };
}

/** Runs the change in the caller's transaction, or in one of its own. */
function change(
  db: Db,
  input: ChangeInput,
): Promise<AttendanceVerificationChange> {
  const root = db as unknown as {
    $transaction?: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  };
  if (typeof root.$transaction === 'function')
    return root.$transaction((tx) => changeInTransaction(tx, input));
  return changeInTransaction(db, input);
}

/**
 * Records a carer's completion (or late clock-out).
 *
 * `resolve` receives the office times as they stand under the row lock and returns the trusted
 * times, so an office entry made a moment earlier is always taken into account. Office times
 * already entered are kept. A request already recorded (same clientEventId) changes nothing; the
 * times are still returned so the caller can answer the device the same way.
 */
export async function recordAttendanceCompletion(
  db: Db,
  input: {
    scheduledJobId: string;
    employeeId: string;
    jobAllocationId?: string | null;
    resolve: (
      office: StoredAttendanceTimeTrust['office'],
    ) => TrustedCompletionTimes;
    clientEventId?: string | null;
    kind?: 'COMPLETION' | 'LATE_CLOCK_OUT';
  },
): Promise<AttendanceVerificationChange & { times: TrustedCompletionTimes }> {
  let times: TrustedCompletionTimes | undefined;
  const result = await change(db, {
    scheduledJobId: input.scheduledJobId,
    employeeId: input.employeeId,
    jobAllocationId: input.jobAllocationId,
    kind: input.kind ?? 'COMPLETION',
    clientEventId: input.clientEventId,
    actorEmployeeId: input.employeeId,
    merge: (previous) => {
      const resolved = input.resolve(previous?.office ?? null);
      times = resolved;
      return {
        next: mergeCompletion(previous, resolved),
        payload: {
          start: resolved.start?.toISOString() ?? null,
          end: resolved.end.toISOString(),
          startSource: resolved.startSource,
          endSource: resolved.endSource,
          needsReview: resolved.needsReview,
          reviewReasons: resolved.reviewReasons,
          evidence: resolved.evidence,
        },
      };
    },
  });
  // A repeated request is not merged; resolve it against the stored office times all the same.
  return {
    ...result,
    times: times ?? input.resolve(result.record.office ?? null),
  };
}

/** Records an office-entered start or finish for one carer. */
export function recordOfficeAttendanceTime(
  db: Db,
  input: {
    scheduledJobId: string;
    employeeId: string;
    jobAllocationId?: string | null;
  } & OfficeTimeInput,
): Promise<AttendanceVerificationChange> {
  const at = input.at ?? new Date();
  return change(db, {
    scheduledJobId: input.scheduledJobId,
    employeeId: input.employeeId,
    jobAllocationId: input.jobAllocationId,
    kind: 'OFFICE_TIME',
    actorUserId: input.byUserId,
    merge: (previous) => ({
      next: mergeOfficeTime(previous, { ...input, at }),
      payload: {
        eventType: input.eventType,
        occurredAt: input.occurredAt.toISOString(),
        reason: input.reason ?? null,
        verified: input.verified,
        at: at.toISOString(),
      },
    }),
  });
}

/**
 * Reasons this carer's times still await office review, with the evidence version they belong to.
 * A carer with an own record (row or per-carer metadata) is judged on it alone; a visit recorded
 * before trust was kept per carer falls back to its visit-wide record.
 */
export async function attendanceReviewState(
  db: Tx,
  scheduledJobId: string,
  employeeId: string | null | undefined,
  legacyJobMetadata?: unknown,
): Promise<{ reasons: string[]; version: number }> {
  const mine = employeeId
    ? await findAttendanceVerification(
        db,
        scheduledJobId,
        employeeId,
        legacyJobMetadata,
      )
    : undefined;
  const legacyVisitWide = (
    legacyJobMetadata as {
      employeeApp?: { attendanceTimes?: StoredAttendanceTimeTrust };
    } | null
  )?.employeeApp?.attendanceTimes;
  const trust = mine ?? legacyVisitWide;
  const version = mine?.version ?? 0;
  if (!trust || !trust.needsReview || trust.verifiedAt)
    return { reasons: [], version };
  return {
    reasons: Array.isArray(trust.reviewReasons)
      ? trust.reviewReasons.filter((r) => typeof r === 'string')
      : [],
    version,
  };
}
