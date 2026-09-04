import { Prisma, type PrismaClient } from '@prisma/client';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';
import {
  formatVisitRef,
  isCanonicalVisitRef,
  normalizeVisitRefBranchCode,
  visitRefDayKey,
} from '../billing/visit-reconciliation.util';

type Db = Pick<
  PrismaClient,
  | 'scheduledVisit'
  | 'visitReconciliation'
  | 'serviceUser'
  | 'scheduleArea'
  | 'scheduledJob'
  | 'organisationGeneralSettings'
> & {
  $queryRaw: PrismaClient['$queryRaw'];
  $executeRaw?: PrismaClient['$executeRaw'];
};

type VisitRefTarget = {
  id: string;
  scheduledJobId: string;
  serviceUserId: string;
  scheduledStartDateTime: Date;
  visitRef?: string | null;
};

async function loadOperationalTimezone(db: Db): Promise<string> {
  const row = await db.organisationGeneralSettings.findFirst({
    select: { timezone: true },
  });
  const tz = row?.timezone?.trim();
  return tz || DEFAULT_OPERATIONAL_TIMEZONE;
}

export async function resolveVisitRefBranchCode(
  db: Db,
  visit: { scheduledJobId: string; serviceUserId: string },
): Promise<string> {
  const su = await db.serviceUser.findFirst({
    where: { id: visit.serviceUserId, deletedAt: null },
    select: {
      locationId: true,
      serviceUserArea: {
        select: {
          scheduleArea: {
            select: { visitRefCode: true, code: true, name: true },
          },
        },
      },
    },
  });

  type BranchBits = {
    visitRefCode: string | null;
    code: string | null;
    name?: string | null;
  };

  let fromSuLocation: BranchBits | null = null;
  if (su?.locationId) {
    fromSuLocation = await db.scheduleArea.findFirst({
      where: { locationId: su.locationId, deletedAt: null, isActive: true },
      select: { visitRefCode: true, code: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  const fromSuArea = su?.serviceUserArea?.scheduleArea ?? null;
  const job = await db.scheduledJob.findFirst({
    where: { id: visit.scheduledJobId },
    select: {
      scheduleArea: { select: { visitRefCode: true, code: true, name: true } },
    },
  });
  const fromJob = job?.scheduleArea ?? null;

  const pick = (...candidates: Array<BranchBits | null | undefined>) => {
    for (const c of candidates) {
      if (!c) continue;
      const raw = c.visitRefCode?.trim() || c.code?.trim() || c.name?.trim() || '';
      if (!raw) continue;
      const normalized = normalizeVisitRefBranchCode(raw);
      if (normalized !== 'GEN') return normalized;
    }
    return normalizeVisitRefBranchCode(null);
  };

  return pick(fromSuLocation, fromSuArea, fromJob);
}

async function allocateVisitRef(
  db: Db,
  branchCode: string,
  dayKey: string,
): Promise<string> {
  const rows = await db.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
    INSERT INTO "billing"."VisitReferenceSequence" ("branchCode", "dayKey", "lastValue", "updatedAt")
    VALUES (${branchCode}, ${dayKey}, 1, now())
    ON CONFLICT ("branchCode", "dayKey")
    DO UPDATE SET "lastValue" = "VisitReferenceSequence"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"
  `);
  const value = rows[0]?.lastValue ?? 1;
  return formatVisitRef(branchCode, dayKey, value);
}

async function persistScheduledVisitRef(
  db: Db,
  scheduledVisitId: string,
  visitRef: string,
): Promise<void> {
  try {
    await db.scheduledVisit.update({
      where: { id: scheduledVisitId },
      data: { visitRef },
    });
  } catch (err) {
    // Unique race: another writer allocated first — keep whichever is already stored.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return;
    }
    throw err;
  }
}

/**
 * Resolve the immutable EMONITORED visit reference for a scheduled visit.
 * Prefer existing ScheduledVisit.visitRef / VisitReconciliation.visitRef; otherwise allocate once.
 */
export async function ensureScheduledVisitRef(
  db: Db,
  visit: VisitRefTarget,
  timeZone?: string,
): Promise<string> {
  const existingOnVisit = visit.visitRef?.trim() || '';
  if (existingOnVisit && isCanonicalVisitRef(existingOnVisit)) {
    return existingOnVisit;
  }

  const recon = await db.visitReconciliation.findFirst({
    where: { scheduledVisitId: visit.id },
    select: { visitRef: true },
    orderBy: { createdAt: 'asc' },
  });
  const existingReconRef = recon?.visitRef?.trim() || '';
  const isLegacyGen = /^VIS-GEN-\d{8}-\d{4}$/.test(existingReconRef);
  const needsRepair =
    !existingReconRef || isLegacyGen || !isCanonicalVisitRef(existingReconRef);

  if (existingReconRef && !needsRepair) {
    if (existingReconRef !== existingOnVisit) {
      await persistScheduledVisitRef(db, visit.id, existingReconRef);
    }
    return existingReconRef;
  }

  if (existingOnVisit && !needsRepair && isCanonicalVisitRef(existingOnVisit)) {
    return existingOnVisit;
  }

  const branchCode = await resolveVisitRefBranchCode(db, visit);
  if (isLegacyGen && branchCode === 'GEN') {
    if (existingReconRef && existingReconRef !== existingOnVisit) {
      await persistScheduledVisitRef(db, visit.id, existingReconRef);
    }
    return existingReconRef || existingOnVisit;
  }

  const tz = timeZone ?? (await loadOperationalTimezone(db));
  const dayKey =
    isLegacyGen && /^\d{8}$/.test(existingReconRef.slice(8, 16))
      ? existingReconRef.slice(8, 16)
      : visitRefDayKey(dayKeyInTimeZone(visit.scheduledStartDateTime, tz));

  const nextRef = await allocateVisitRef(db, branchCode, dayKey);

  await persistScheduledVisitRef(db, visit.id, nextRef);

  if (existingReconRef && nextRef !== existingReconRef) {
    await db.visitReconciliation.updateMany({
      where: { scheduledVisitId: visit.id, visitRef: existingReconRef },
      data: { visitRef: nextRef },
    });
  }

  return nextRef;
}

/**
 * Ensure every visit id has a persisted visitRef; returns map scheduledVisitId → visitRef.
 */
export async function ensureVisitRefsForScheduledVisitIds(
  db: Db,
  scheduledVisitIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(scheduledVisitIds.map((id) => id?.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  const visits = await db.scheduledVisit.findMany({
    where: { id: { in: unique }, deletedAt: null },
    select: {
      id: true,
      scheduledJobId: true,
      serviceUserId: true,
      scheduledStartDateTime: true,
      visitRef: true,
    },
  });

  const timeZone = await loadOperationalTimezone(db);
  for (const visit of visits) {
    const existing = visit.visitRef?.trim();
    if (existing && isCanonicalVisitRef(existing)) {
      map.set(visit.id, existing);
      continue;
    }
    const ref = await ensureScheduledVisitRef(db, visit, timeZone);
    if (ref) map.set(visit.id, ref);
  }
  return map;
}
