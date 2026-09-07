import type { PrismaClient } from '@prisma/client';
import { ensureVisitRefsForScheduledVisitIds } from './visit-ref-allocate.util';

type Db = Pick<
  PrismaClient,
  | 'visitReconciliation'
  | 'scheduledVisit'
  | 'serviceUser'
  | 'scheduleArea'
  | 'scheduledJob'
  | 'organisationGeneralSettings'
> & {
  $queryRaw: PrismaClient['$queryRaw'];
};

/**
 * Load EMONITORED visit references (VIS-[BRANCH]-YYYYMMDD-NNNN) keyed by scheduled visit id.
 * Allocates and persists on ScheduledVisit when missing so schedule workspace shows refs
 * before visit reconciliation exists.
 */
export async function loadVisitRefsByScheduledVisitIds(
  db: Db,
  scheduledVisitIds: string[],
): Promise<Map<string, string>> {
  return ensureVisitRefsForScheduledVisitIds(db, scheduledVisitIds);
}

export function primaryScheduledVisitId(job: {
  visits?: Array<{ id?: string | null }> | null;
}): string | null {
  const id = job.visits?.[0]?.id?.trim();
  return id || null;
}

export function withVisitRef<
  T extends { id?: string; visits?: Array<{ id?: string | null }> | null },
>(
  job: T,
  visitRefByScheduledVisit: Map<string, string>,
  visitRefByScheduledJob?: Map<string, string>,
): T & { visitRef: string | null } {
  for (const visit of job.visits ?? []) {
    const visitId = visit.id?.trim();
    if (!visitId) continue;
    const fromVisit = visitRefByScheduledVisit.get(visitId);
    if (fromVisit) return { ...job, visitRef: fromVisit };
  }
  const jobId = job.id?.trim();
  const fromJob = jobId && visitRefByScheduledJob ? visitRefByScheduledJob.get(jobId) : null;
  return {
    ...job,
    visitRef: fromJob ?? null,
  };
}

/** Earliest visitRef per scheduled job (fallback when visit ids are missing on the payload). */
export async function loadVisitRefsByScheduledJobIds(
  db: Db,
  scheduledJobIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(scheduledJobIds.map((id) => id?.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  const fromVisits = await db.scheduledVisit.findMany({
    where: {
      scheduledJobId: { in: unique },
      deletedAt: null,
      visitRef: { not: null },
    },
    select: { scheduledJobId: true, visitRef: true, scheduledStartDateTime: true },
    orderBy: { scheduledStartDateTime: 'asc' },
  });
  for (const row of fromVisits) {
    const ref = row.visitRef?.trim();
    if (!ref || map.has(row.scheduledJobId)) continue;
    map.set(row.scheduledJobId, ref);
  }

  const missingJobIds = unique.filter((id) => !map.has(id));
  if (missingJobIds.length) {
    const rows = await db.visitReconciliation.findMany({
      where: { scheduledJobId: { in: missingJobIds } },
      select: { scheduledJobId: true, visitRef: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const row of rows) {
      const ref = row.visitRef?.trim();
      if (!ref || map.has(row.scheduledJobId)) continue;
      map.set(row.scheduledJobId, ref);
    }
  }

  return map;
}

export async function attachVisitRefsToJobs<
  T extends { id?: string; visits?: Array<{ id?: string | null }> | null },
>(db: Db, jobs: T[]): Promise<Array<T & { visitRef: string | null }>> {
  if (!jobs.length) return [];
  const visitIds = jobs.flatMap((job) =>
    (job.visits ?? [])
      .map((v) => v.id?.trim())
      .filter((id): id is string => Boolean(id)),
  );
  const jobIds = jobs.map((job) => job.id?.trim()).filter((id): id is string => Boolean(id));
  const [refByVisit, refByJob] = await Promise.all([
    loadVisitRefsByScheduledVisitIds(db, visitIds),
    loadVisitRefsByScheduledJobIds(db, jobIds),
  ]);
  return jobs.map((job) => withVisitRef(job, refByVisit, refByJob));
}
