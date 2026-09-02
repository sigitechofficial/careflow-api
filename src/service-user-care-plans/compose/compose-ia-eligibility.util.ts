import { InitialAssessmentStatus } from '@prisma/client';
import type { CarePlanComposeIaStatus } from './compose-context.types';

/** Assessments that are preferred compose sources (signed-off). */
export const COMPOSE_ELIGIBLE_IA_STATUSES: InitialAssessmentStatus[] = [
  InitialAssessmentStatus.SUBMITTED,
  InitialAssessmentStatus.REVIEWED,
];

/**
 * Snapshots loaded for compose. IN_PROGRESS is a fallback only when no submitted/reviewed IA exists
 * so Fill Demo Data / Create Plan before manager review can still read medicationSupportLevel.
 */
export const COMPOSE_IA_LOAD_STATUSES: InitialAssessmentStatus[] = [
  InitialAssessmentStatus.SUBMITTED,
  InitialAssessmentStatus.REVIEWED,
  InitialAssessmentStatus.IN_PROGRESS,
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
  if (status === InitialAssessmentStatus.IN_PROGRESS) return 'IN_PROGRESS';
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
  if (sorted.length > 0) {
    return {
      latest: sorted[0] ?? null,
      previous: sorted.slice(1, 1 + PREVIOUS_ASSESSMENT_LIMIT),
    };
  }

  const inProgress = [...rows]
    .filter((row) => row.status === InitialAssessmentStatus.IN_PROGRESS)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return {
    latest: inProgress[0] ?? null,
    previous: [],
  };
}
