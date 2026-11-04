import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/** The fields of a care plan recommendation this list needs. */
export type RecommendationForRequiredAssessments = {
  carePathwayFormId?: string;
  carePathwayFormName?: string;
  title: string;
  status: 'pending' | 'accepted' | 'declined' | 'deferred';
};

export type RequiredAssessmentRule = {
  carePlanFormId: string;
  carePlanFormName: string;
  assessmentFormId: string;
  assessmentFormName: string;
};

export type RequiredAssessmentItem = {
  assessmentFormId: string;
  assessmentFormName: string;
  /** Recommended care plans that require it. */
  requiredBy: Array<{ carePathwayFormId: string; carePlanName: string }>;
  /** Latest completion of this assessment for the service user, if any. */
  lastCompletedAt: string | null;
};

/** Care plan forms recommended by the assessment and not declined. */
export function recommendedCarePlanFormIds(
  recommendations: RecommendationForRequiredAssessments[],
): string[] {
  return [
    ...new Set(
      recommendations
        .filter((rec) => rec.status !== 'declined' && rec.carePathwayFormId)
        .map((rec) => rec.carePathwayFormId as string),
    ),
  ];
}

/**
 * One entry per required assessment, listing every recommended care plan that requires it.
 * Configured by the organisation (Care pathway settings): nothing is inferred from names.
 */
export function buildRequiredAssessments(
  recommendations: RecommendationForRequiredAssessments[],
  rules: RequiredAssessmentRule[],
  lastCompletedByForm: ReadonlyMap<string, Date>,
): RequiredAssessmentItem[] {
  const recommended = new Set(recommendedCarePlanFormIds(recommendations));
  const items = new Map<string, RequiredAssessmentItem>();
  for (const rule of rules) {
    if (!recommended.has(rule.carePlanFormId)) continue;
    const item = items.get(rule.assessmentFormId) ?? {
      assessmentFormId: rule.assessmentFormId,
      assessmentFormName: rule.assessmentFormName,
      requiredBy: [],
      lastCompletedAt:
        lastCompletedByForm.get(rule.assessmentFormId)?.toISOString() ?? null,
    };
    if (
      !item.requiredBy.some((r) => r.carePathwayFormId === rule.carePlanFormId)
    ) {
      item.requiredBy.push({
        carePathwayFormId: rule.carePlanFormId,
        carePlanName: rule.carePlanFormName,
      });
    }
    items.set(rule.assessmentFormId, item);
  }
  // Not done yet first, then by name.
  return [...items.values()].sort(
    (a, b) =>
      Number(a.lastCompletedAt != null) - Number(b.lastCompletedAt != null) ||
      a.assessmentFormName.localeCompare(b.assessmentFormName),
  );
}

/** Required assessments for the care plans an Initial Assessment recommends (read-only). */
export async function loadRequiredAssessments(
  db: Db,
  serviceUserId: string,
  recommendations: RecommendationForRequiredAssessments[],
): Promise<RequiredAssessmentItem[]> {
  const carePlanFormIds = recommendedCarePlanFormIds(recommendations);
  if (!carePlanFormIds.length) return [];

  const rows = await db.carePlanRequiredAssessment.findMany({
    where: {
      carePlanFormId: { in: carePlanFormIds },
      assessmentForm: { deletedAt: null, isActive: true },
    },
    select: {
      carePlanFormId: true,
      assessmentFormId: true,
      carePlanForm: { select: { name: true } },
      assessmentForm: { select: { name: true } },
    },
  });
  if (!rows.length) return [];

  const assessmentFormIds = [
    ...new Set(rows.map((row) => row.assessmentFormId)),
  ];
  const assessments = await db.serviceUserAssessment.findMany({
    where: {
      serviceUserId,
      OR: [
        { carePathwayFormId: { in: assessmentFormIds } },
        { assessmentKey: { in: assessmentFormIds } },
      ],
    },
    select: {
      carePathwayFormId: true,
      assessmentKey: true,
      completions: {
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { completedAt: true },
      },
    },
  });
  const lastCompletedByForm = new Map<string, Date>();
  for (const a of assessments) {
    const completedAt = a.completions[0]?.completedAt;
    const formId = a.carePathwayFormId ?? a.assessmentKey;
    if (!completedAt || !assessmentFormIds.includes(formId)) continue;
    const previous = lastCompletedByForm.get(formId);
    if (!previous || completedAt > previous)
      lastCompletedByForm.set(formId, completedAt);
  }

  return buildRequiredAssessments(
    recommendations,
    rows.map((row) => ({
      carePlanFormId: row.carePlanFormId,
      carePlanFormName: row.carePlanForm.name,
      assessmentFormId: row.assessmentFormId,
      assessmentFormName: row.assessmentForm.name,
    })),
    lastCompletedByForm,
  );
}
