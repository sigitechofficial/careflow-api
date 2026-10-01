import type { PrismaClient } from '@prisma/client';

/**
 * Staff-safety facts the system already holds, so the lone-worker factors are not asked by hand when
 * the answer is on record (visit plan, DOM Care, SOS events, incidents). Values are null when the
 * system has nothing to say (e.g. a brand-new service user with no visit plan yet).
 */
export type LoneWorkerSystemFacts = {
  isNewServiceUser: boolean | null;
  /** Most carers planned on any enabled visit (visit plan), else DOM Care. */
  plannedCarersPerVisit: number | null;
  plannedCarersSource: 'visit_plan' | 'dom_care' | null;
  hasNightOrLateVisits: boolean | null;
  longestVisitMinutes: number | null;
  sosEventCount: number;
  safeguardingIncidentCount: number;
};

const NEW_SERVICE_USER_DAYS = 28;
/** Visits at least this long count as "long duration" (extended time alone). */
export const LONG_VISIT_MINUTES = 90;

function minutesOf(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 20:00–07:00 counts as a night / early / late visit. */
function isOutOfHours(start: number | null): boolean {
  return start != null && (start >= 20 * 60 || start < 7 * 60);
}

export async function buildLoneWorkerSystemFacts(
  prisma: PrismaClient,
  serviceUserId: string,
  now = new Date(),
): Promise<LoneWorkerSystemFacts> {
  const [su, plan, dom, sosEventCount, safeguardingIncidentCount] = await Promise.all([
    prisma.serviceUser.findUnique({ where: { id: serviceUserId }, select: { serviceStartDate: true } }),
    prisma.serviceUserVisitPlan.findFirst({
      where: { serviceUserId, status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' },
      select: {
        slots: {
          where: { isEnabled: true },
          select: { plannedStartTime: true, durationMinutes: true, requiredCarers: true, nightDuty: true },
        },
      },
    }),
    prisma.serviceUserDomCare.findUnique({ where: { serviceUserId }, select: { numberOfCarers: true } }),
    prisma.ecmException.count({ where: { kind: 'CARER_SOS', scheduledJob: { serviceUserId } } }),
    prisma.incident.count({
      where: {
        primaryServiceUserId: serviceUserId,
        deletedAt: null,
        OR: [{ category: { key: 'SAFEGUARDING' } }, { carerSafeguardingConcern: true }],
      },
    }),
  ]);

  const start = su?.serviceStartDate ?? null;
  const isNewServiceUser =
    start == null ? null : now.getTime() - start.getTime() < NEW_SERVICE_USER_DAYS * 24 * 60 * 60 * 1000;

  const slots = plan?.slots ?? [];
  const planCarers = slots.length ? Math.max(...slots.map((s) => s.requiredCarers ?? 1)) : null;
  const plannedCarersPerVisit = planCarers ?? dom?.numberOfCarers ?? null;
  const plannedCarersSource = planCarers != null ? 'visit_plan' : dom?.numberOfCarers != null ? 'dom_care' : null;
  const hasNightOrLateVisits = slots.length
    ? slots.some((s) => s.nightDuty !== 'NONE' || isOutOfHours(minutesOf(s.plannedStartTime)))
    : null;
  const longestVisitMinutes = slots.length ? Math.max(...slots.map((s) => s.durationMinutes ?? 0)) || null : null;

  return {
    isNewServiceUser,
    plannedCarersPerVisit,
    plannedCarersSource,
    hasNightOrLateVisits,
    longestVisitMinutes,
    sosEventCount,
    safeguardingIncidentCount,
  };
}

