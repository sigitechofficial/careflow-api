import { InitialAssessmentStatus } from '@prisma/client';
import type { CarePlanComposeIaStatus } from './compose-context.types';

export const COMPOSE_ELIGIBLE_IA_STATUSES: InitialAssessmentStatus[] = [
  InitialAssessmentStatus.SUBMITTED,
  InitialAssessmentStatus.REVIEWED,
];

const PREVIOUS_ASSESSMENT_LIMIT = 10;

export type EligibleAssessmentRow = {
  id: string;
  submittedAt: Date | null;
  updatedAt: Date;
  status: InitialAssessmentStatus;
};

export function isEligibleComposeIaStatus(status: InitialAssessmentStatus): status is
  | typeof InitialAssessmentStatus.SUBMITTED
  | typeof InitialAssessmentStatus.REVIEWED {
  return (
    status === InitialAssessmentStatus.SUBMITTED || status === InitialAssessmentStatus.REVIEWED
  );
}

export function toComposeIaStatus(status: InitialAssessmentStatus): CarePlanComposeIaStatus | null {
  if (status === InitialAssessmentStatus.SUBMITTED) return 'SUBMITTED';
  if (status === InitialAssessmentStatus.REVIEWED) return 'REVIEWED';
  return null;
}

export function sortEligibleAssessmentsForCompose<T extends EligibleAssessmentRow>(rows: T[]): T[] {
  return [...rows]
    .filter((row) => isEligibleComposeIaStatus(row.status))
    .sort((a, b) => {
      const aTime = a.submittedAt?.getTime() ?? a.updatedAt.getTime();
      const bTime = b.submittedAt?.getTime() ?? b.updatedAt.getTime();
      if (bTime !== aTime) return bTime - aTime;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
}

export function splitLatestAndPreviousAssessments<T extends EligibleAssessmentRow>(
  rows: T[],
): { latest: T | null; previous: T[] } {
  const sorted = sortEligibleAssessmentsForCompose(rows);
  return {
    latest: sorted[0] ?? null,
    previous: sorted.slice(1, 1 + PREVIOUS_ASSESSMENT_LIMIT),
  };
}
