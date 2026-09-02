import type { PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'visitReconciliation'>;

/**
 * Load EMONITORED visit references (VIS-[BRANCH]-YYYYMMDD-NNNN) keyed by scheduled visit id.
 * When multiple reconciliation rows exist for one visit, the earliest ref wins (immutable).
 */
export async function loadVisitRefsByScheduledVisitIds(
  db: Db,
  scheduledVisitIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(scheduledVisitIds.map((id) => id?.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  const rows = await db.visitReconciliation.findMany({
    where: { scheduledVisitId: { in: unique } },
    select: { scheduledVisitId: true, visitRef: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const row of rows) {
    const ref = row.visitRef?.trim();
    if (!ref || map.has(row.scheduledVisitId)) continue;
    map.set(row.scheduledVisitId, ref);
  }
  return map;
}

export function primaryScheduledVisitId(job: {
  visits?: Array<{ id?: string | null }> | null;
}): string | null {
  const id = job.visits?.[0]?.id?.trim();
  return id || null;
}

export function withVisitRef<T extends { visits?: Array<{ id?: string | null }> | null }>(
  job: T,
  visitRefByScheduledVisit: Map<string, string>,
): T & { visitRef: string | null } {
  const visitId = primaryScheduledVisitId(job);
  return {
    ...job,
    visitRef: visitId ? visitRefByScheduledVisit.get(visitId) ?? null : null,
  };
}

export async function attachVisitRefsToJobs<
  T extends { visits?: Array<{ id?: string | null }> | null },
>(db: Db, jobs: T[]): Promise<Array<T & { visitRef: string | null }>> {
  if (!jobs.length) return [];
  const visitIds = jobs
    .map((job) => primaryScheduledVisitId(job))
    .filter((id): id is string => Boolean(id));
  const refMap = await loadVisitRefsByScheduledVisitIds(db, visitIds);
  return jobs.map((job) => withVisitRef(job, refMap));
}
