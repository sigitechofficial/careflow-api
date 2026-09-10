import {
  EcmMissedClassification,
  InitialAssessmentRiskStatus,
  InitialAssessmentRiskType,
  InitialAssessmentStatus,
  Prisma,
  ServiceUserCarePlanInstanceStatus,
  ServiceUserMedicalConditionStatus,
} from '@prisma/client';
import { CARE_PLAN_LIST_DUE_WITHIN_DAYS } from '../service-user-care-plans/care-plan-review-schedule';
import {
  activeServiceUserAbsenceWhere,
  calendarDayUtcNoon,
} from '../service-user-absences/active-absence.util';
import { activeServiceUserFlashMessageWhere } from '../service-user-flash-messages/active-flash-message.util';
import type { PrismaService } from '../prisma/prisma.service';

export const CARE_PLAN_LIST_STATUS_FILTERS = [
  'none',
  'ok',
  'due_within_week',
  'overdue',
] as const;
export type CarePlanListStatusFilter = (typeof CARE_PLAN_LIST_STATUS_FILTERS)[number];

/** Manager-facing Initial Assessment buckets (not raw enum). */
export const INITIAL_ASSESSMENT_STATUS_FILTERS = [
  'none',
  'in_progress',
  'awaiting_review',
  'completed',
] as const;
export type InitialAssessmentStatusFilter = (typeof INITIAL_ASSESSMENT_STATUS_FILTERS)[number];

export const BEHAVIOUR_INCIDENT_SUBTYPE_KEYS = {
  verbal: 'VERBAL_AGGRESSION',
  physical: 'PHYSICAL_AGGRESSION',
} as const;

export const SAFEGUARDING_INCIDENT_SUBTYPE_KEYS = {
  physicalAbuse: 'PHYSICAL_ABUSE',
  domesticAbuse: 'DOMESTIC_ABUSE',
} as const;

export const SAFEGUARDING_CATEGORY_KEY = 'SAFEGUARDING';

/** Absence reason codes treated as currently hospitalised (not a day visit). */
export const HOSPITALISED_ABSENCE_REASON_CODES = ['HOSPITALISED'] as const;

export function appendWhereAnd(
  where: Prisma.ServiceUserWhereInput,
  clause: Prisma.ServiceUserWhereInput,
): void {
  where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), clause];
}

function utcCalendarDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function subtractUtcYears(d: Date, years: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const next = utcCalendarDay(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Convert inclusive age range to DOB bounds (UTC calendar days).
 * age ≥ min → DOB on/before today − min years
 * age ≤ max → DOB on/after (today − (max+1) years) + 1 day
 */
export function dateOfBirthRangeFromAges(
  ageMin?: number | null,
  ageMax?: number | null,
  today: Date = new Date(),
): { from?: Date; to?: Date } {
  const day = utcCalendarDay(today);
  const result: { from?: Date; to?: Date } = {};
  if (ageMin != null && Number.isFinite(ageMin) && ageMin >= 0) {
    const to = subtractUtcYears(day, Math.floor(ageMin));
    to.setUTCHours(23, 59, 59, 999);
    result.to = to;
  }
  if (ageMax != null && Number.isFinite(ageMax) && ageMax >= 0) {
    const from = addUtcDays(subtractUtcYears(day, Math.floor(ageMax) + 1), 1);
    from.setUTCHours(0, 0, 0, 0);
    result.from = from;
  }
  return result;
}

export function mergeDateOfBirthFilter(
  where: Prisma.ServiceUserWhereInput,
  opts: {
    dateOfBirthFrom?: string;
    dateOfBirthTo?: string;
    ageMin?: number;
    ageMax?: number;
    today?: Date;
  },
): void {
  const fromAge = dateOfBirthRangeFromAges(opts.ageMin, opts.ageMax, opts.today);
  let from = opts.dateOfBirthFrom ? new Date(opts.dateOfBirthFrom) : undefined;
  let to = opts.dateOfBirthTo ? new Date(opts.dateOfBirthTo) : undefined;
  if (fromAge.from && (!from || fromAge.from > from)) from = fromAge.from;
  if (fromAge.to && (!to || fromAge.to < to)) to = fromAge.to;
  if (!from && !to) return;
  const dob: Prisma.DateTimeNullableFilter = {};
  if (from) dob.gte = from;
  if (to) dob.lte = to;
  where.dateOfBirth = dob;
}

export function carePlanListStatusWhere(
  status: CarePlanListStatusFilter,
  today: Date = new Date(),
): Prisma.ServiceUserWhereInput {
  const day = utcCalendarDay(today);
  const published = { status: ServiceUserCarePlanInstanceStatus.PUBLISHED };
  const weekEnd = addUtcDays(day, CARE_PLAN_LIST_DUE_WITHIN_DAYS);
  weekEnd.setUTCHours(23, 59, 59, 999);
  const dayStart = new Date(day);
  dayStart.setUTCHours(0, 0, 0, 0);

  switch (status) {
    case 'none':
      return {
        carePlanInstances: {
          none: published,
        },
      };
    case 'overdue':
      return {
        carePlanInstances: {
          some: {
            ...published,
            nextReviewDueAt: { lt: dayStart },
          },
        },
      };
    case 'due_within_week':
      return {
        AND: [
          {
            carePlanInstances: {
              some: {
                ...published,
                nextReviewDueAt: { gte: dayStart, lte: weekEnd },
              },
            },
          },
          {
            carePlanInstances: {
              none: {
                ...published,
                nextReviewDueAt: { lt: dayStart },
              },
            },
          },
        ],
      };
    case 'ok':
      return {
        AND: [
          { carePlanInstances: { some: published } },
          {
            carePlanInstances: {
              none: {
                ...published,
                nextReviewDueAt: { lte: weekEnd },
              },
            },
          },
        ],
      };
    default:
      return {};
  }
}

export function activeFlashMessageListWhere(
  now = new Date(),
): Prisma.ServiceUserWhereInput {
  return {
    flashMessages: {
      some: activeServiceUserFlashMessageWhere(now),
    },
  };
}

export function hospitalisedListWhere(
  today = new Date(),
): Prisma.ServiceUserWhereInput {
  return {
    absences: {
      some: {
        ...activeServiceUserAbsenceWhere(calendarDayUtcNoon(today)),
        absenceReasonCatalog: {
          code: { in: [...HOSPITALISED_ABSENCE_REASON_CODES] },
        },
      },
    },
  };
}

export function activeMedicalConditionListWhere(
  conditionId: string,
): Prisma.ServiceUserWhereInput {
  return {
    medicalConditions: {
      some: {
        deletedAt: null,
        isActive: true,
        status: ServiceUserMedicalConditionStatus.ACTIVE,
        conditionId,
      },
    },
  };
}

const iaBase = { deletedAt: null, isActive: true };

export function initialAssessmentStatusWhere(
  filter: InitialAssessmentStatusFilter,
): Prisma.ServiceUserWhereInput {
  switch (filter) {
    case 'none':
      return {
        initialAssessmentSubmissions: {
          none: {
            ...iaBase,
            status: {
              in: [
                InitialAssessmentStatus.DRAFT,
                InitialAssessmentStatus.IN_PROGRESS,
                InitialAssessmentStatus.SUBMITTED,
                InitialAssessmentStatus.REVIEWED,
              ],
            },
          },
        },
      };
    case 'in_progress':
      return {
        initialAssessmentSubmissions: {
          some: {
            ...iaBase,
            status: {
              in: [InitialAssessmentStatus.DRAFT, InitialAssessmentStatus.IN_PROGRESS],
            },
          },
        },
      };
    case 'awaiting_review':
      return {
        initialAssessmentSubmissions: {
          some: {
            ...iaBase,
            status: InitialAssessmentStatus.SUBMITTED,
          },
        },
      };
    case 'completed':
      return {
        initialAssessmentSubmissions: {
          some: {
            ...iaBase,
            status: InitialAssessmentStatus.REVIEWED,
          },
        },
      };
    default:
      return {};
  }
}

export function openLoneWorkerRiskWhere(): Prisma.ServiceUserWhereInput {
  return {
    initialAssessmentRiskRecords: {
      some: {
        riskType: InitialAssessmentRiskType.LONE_WORKER,
        status: InitialAssessmentRiskStatus.OPEN,
      },
    },
  };
}

/** Service users with ≥ min confirmed ECM missed visits in an optional date window. */
export async function findServiceUserIdsWithConfirmedMissedVisitsAtLeast(
  prisma: PrismaService,
  minCount: number,
  opts?: { from?: Date; to?: Date },
): Promise<string[]> {
  if (!Number.isFinite(minCount) || minCount < 1) return [];

  const localVisitDate: Prisma.DateTimeFilter = {};
  if (opts?.from) localVisitDate.gte = opts.from;
  if (opts?.to) localVisitDate.lte = opts.to;

  const rows = await prisma.scheduledJob.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ecmEvaluation: {
        missedClassification: EcmMissedClassification.CONFIRMED_MISSED,
        ...(Object.keys(localVisitDate).length > 0 ? { localVisitDate } : {}),
      },
    },
    select: { serviceUserId: true },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row.serviceUserId;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= minCount).map(([id]) => id);
}

/** Incidents link via primaryServiceUserId (no Prisma FK on ServiceUser). */
export async function findServiceUserIdsWithBehaviourIncident(
  prisma: PrismaService,
  subtypeKeys: string[],
): Promise<string[]> {
  return findServiceUserIdsWithIncidents(prisma, { subtypeKeys });
}

export async function findServiceUserIdsWithSafeguardingIncidents(
  prisma: PrismaService,
  opts: { subtypeKeys?: string[]; anySafeguardingCategory?: boolean },
): Promise<string[]> {
  return findServiceUserIdsWithIncidents(prisma, {
    subtypeKeys: opts.subtypeKeys,
    categoryKeys: opts.anySafeguardingCategory ? [SAFEGUARDING_CATEGORY_KEY] : undefined,
  });
}

async function findServiceUserIdsWithIncidents(
  prisma: PrismaService,
  opts: { subtypeKeys?: string[]; categoryKeys?: string[] },
): Promise<string[]> {
  const subtypeKeys = [...new Set((opts.subtypeKeys ?? []).map((k) => k.trim()).filter(Boolean))];
  const categoryKeys = [...new Set((opts.categoryKeys ?? []).map((k) => k.trim()).filter(Boolean))];
  if (subtypeKeys.length === 0 && categoryKeys.length === 0) return [];

  const rows = await prisma.incident.findMany({
    where: {
      deletedAt: null,
      isArchived: false,
      primaryServiceUserId: { not: null },
      OR: [
        ...(subtypeKeys.length > 0
          ? [{ subtype: { key: { in: subtypeKeys }, deletedAt: null } }]
          : []),
        ...(categoryKeys.length > 0
          ? [{ category: { key: { in: categoryKeys }, deletedAt: null } }]
          : []),
      ],
    },
    select: { primaryServiceUserId: true },
  });

  return [
    ...new Set(
      rows
        .map((r) => r.primaryServiceUserId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
}
