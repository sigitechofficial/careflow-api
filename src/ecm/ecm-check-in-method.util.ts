import type { PrismaClient } from '@prisma/client';
import { attendanceEventMethodLabel } from './ecm-attendance-method.util';

/** How a visit was clocked in, for the ECM table and reports. */
export type VisitCheckInMethodCode = 'GPS' | 'NFC' | 'QR' | 'MANUAL' | 'OFFICE' | 'NONE';

export type VisitCheckInMethod = { code: VisitCheckInMethodCode; label: string };

export type CheckInMethodCounts = {
  gps: number;
  nfc: number;
  qr: number;
  /** Carer chose Manual in the app. */
  manualCarer: number;
  /** Office recorded attendance in admin. */
  office: number;
  /** No check-in yet (missed / not started). */
  none: number;
};

/** Carer-app check-in record for one carer (`metadata.employeeApp.checkIns[id]`, else `checkIn`). */
export function carerAppCheckIn(
  metadata: unknown,
  employeeId: string,
): { method: string | null; nfcTagLabel: string | null } | null {
  const app = (metadata as { employeeApp?: Record<string, unknown> } | null)?.employeeApp;
  if (!app || typeof app !== 'object') return null;
  const perCarer = (app.checkIns as Record<string, unknown> | undefined)?.[employeeId];
  const raw = (perCarer ?? app.checkIn) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { method: str(raw.method), nfcTagLabel: str(raw.nfcTagLabel) };
}

/**
 * Method of the visit's first CHECK_IN event. Carer-app Manual is stored as
 * MOBILE_GPS in the attendance log, so the check-in record decides app methods.
 */
export function resolveVisitCheckInMethod(input: {
  checkIn: { verificationMethod: string; employeeId: string } | null;
  metadata: unknown;
}): VisitCheckInMethod {
  const ev = input.checkIn;
  if (!ev) return { code: 'NONE', label: 'Not clocked in' };
  if (String(ev.verificationMethod).toUpperCase() === 'MANUAL_OFFICE') {
    return { code: 'OFFICE', label: 'Office (manual)' };
  }
  const app = carerAppCheckIn(input.metadata, ev.employeeId);
  const appMethod = app?.method?.toUpperCase() ?? null;
  const stored = String(ev.verificationMethod).toUpperCase();
  const code: VisitCheckInMethodCode =
    appMethod === 'NFC' || stored === 'NFC'
      ? 'NFC'
      : appMethod === 'QR' || stored === 'QR'
        ? 'QR'
        : appMethod === 'MANUAL'
          ? 'MANUAL'
          : 'GPS';
  return {
    code,
    label: attendanceEventMethodLabel({
      verificationMethod: ev.verificationMethod,
      appCheckInMethod: appMethod,
      nfcTagLabel: app?.nfcTagLabel,
    }),
  };
}

export function countCheckInMethods(methods: Iterable<VisitCheckInMethod>): CheckInMethodCounts {
  const counts: CheckInMethodCounts = { gps: 0, nfc: 0, qr: 0, manualCarer: 0, office: 0, none: 0 };
  for (const m of methods) {
    if (m.code === 'GPS') counts.gps++;
    else if (m.code === 'NFC') counts.nfc++;
    else if (m.code === 'QR') counts.qr++;
    else if (m.code === 'MANUAL') counts.manualCarer++;
    else if (m.code === 'OFFICE') counts.office++;
    else counts.none++;
  }
  return counts;
}

type Db = Pick<PrismaClient, 'visitAttendanceEvent' | 'scheduledJob'>;

/** One query for CHECK_IN events + one for metadata of the jobs that have one. */
export async function loadCheckInMethodsByJobIds(
  db: Db,
  jobIds: string[],
): Promise<Map<string, VisitCheckInMethod>> {
  const result = new Map<string, VisitCheckInMethod>();
  const unique = [...new Set(jobIds)];
  if (unique.length === 0) return result;
  const events = await db.visitAttendanceEvent.findMany({
    where: { scheduledJobId: { in: unique }, eventType: 'CHECK_IN' },
    orderBy: { occurredAt: 'asc' },
    select: { scheduledJobId: true, verificationMethod: true, employeeId: true },
  });
  const firstByJob = new Map<string, { verificationMethod: string; employeeId: string }>();
  for (const ev of events) {
    if (!firstByJob.has(ev.scheduledJobId)) firstByJob.set(ev.scheduledJobId, ev);
  }
  const withEvents = [...firstByJob.keys()];
  const jobs = withEvents.length
    ? await db.scheduledJob.findMany({
        where: { id: { in: withEvents } },
        select: { id: true, metadata: true },
      })
    : [];
  const metaByJob = new Map(jobs.map((j) => [j.id, j.metadata]));
  for (const id of unique) {
    result.set(
      id,
      resolveVisitCheckInMethod({ checkIn: firstByJob.get(id) ?? null, metadata: metaByJob.get(id) }),
    );
  }
  return result;
}
