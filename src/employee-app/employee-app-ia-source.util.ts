import { InitialAssessmentStatus, type Prisma, type PrismaClient } from '@prisma/client';

/**
 * Which Initial Assessment carers may see. Drafts and in-progress reassessments are never shown.
 * REVIEWED wins; a SUBMITTED assessment is used only when nothing is reviewed yet and is flagged
 * as pending manager review so the app can label it.
 */
export const CARER_VISIBLE_IA_STATUSES: InitialAssessmentStatus[] = [
  InitialAssessmentStatus.REVIEWED,
  InitialAssessmentStatus.SUBMITTED,
];

export type CarerVisibleIa<T> = { submission: T; pendingReview: boolean };

type Db = Pick<PrismaClient, 'initialAssessmentSubmission'>;

export async function findCarerVisibleIa<S extends Prisma.InitialAssessmentSubmissionSelect>(
  prisma: Db,
  serviceUserId: string,
  select: S,
): Promise<CarerVisibleIa<Prisma.InitialAssessmentSubmissionGetPayload<{ select: S }>> | null> {
  for (const status of CARER_VISIBLE_IA_STATUSES) {
    const row = await prisma.initialAssessmentSubmission.findFirst({
      where: { serviceUserId, status, deletedAt: null },
      orderBy: [
        { reviewedAt: { sort: 'desc', nulls: 'last' } },
        { submittedAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
      ],
      select,
    });
    if (row) {
      return {
        submission: row as Prisma.InitialAssessmentSubmissionGetPayload<{ select: S }>,
        pendingReview: status === InitialAssessmentStatus.SUBMITTED,
      };
    }
  }
  return null;
}

/** Risk records carers may see: from a submitted or reviewed IA only (never a draft). */
export const CARER_VISIBLE_RISK_WHERE = {
  submission: { status: { in: CARER_VISIBLE_IA_STATUSES }, deletedAt: null },
} satisfies Prisma.InitialAssessmentRiskRecordWhereInput;

/**
 * Drops master-data rows promoted from an Initial Assessment that a manager has not reviewed yet
 * (e.g. conditions added on IA submit). Rows entered by the office (no `sourceSubmissionId`) stay.
 */
export async function withoutUnreviewedIaRows<T extends { sourceSubmissionId: string | null }>(
  prisma: Db,
  rows: T[],
): Promise<T[]> {
  const ids = [...new Set(rows.map((r) => r.sourceSubmissionId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return rows;
  const reviewed = new Set(
    (
      await prisma.initialAssessmentSubmission.findMany({
        where: { id: { in: ids }, status: InitialAssessmentStatus.REVIEWED, deletedAt: null },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  return rows.filter((r) => !r.sourceSubmissionId || reviewed.has(r.sourceSubmissionId));
}
