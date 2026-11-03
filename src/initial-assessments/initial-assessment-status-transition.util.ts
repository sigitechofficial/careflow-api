import { BadRequestException } from '@nestjs/common';
import { InitialAssessmentStatus } from '@prisma/client';

/**
 * Transitions allowed through `PATCH …/initial-assessments/:sid/status`.
 *
 * SUBMITTED is only reached through `/submit` (validation, auto actions and risk records) and
 * REVIEWED only through `/review` (manager review permission and review side effects), so neither
 * can be set here. Reopening a submitted or reviewed assessment for correction stays allowed.
 */
export const IA_STATUS_ENDPOINT_TRANSITIONS: Readonly<
  Record<InitialAssessmentStatus, readonly InitialAssessmentStatus[]>
> = {
  [InitialAssessmentStatus.DRAFT]: [
    InitialAssessmentStatus.IN_PROGRESS,
    InitialAssessmentStatus.CANCELLED,
  ],
  [InitialAssessmentStatus.IN_PROGRESS]: [InitialAssessmentStatus.CANCELLED],
  [InitialAssessmentStatus.SUBMITTED]: [InitialAssessmentStatus.IN_PROGRESS],
  [InitialAssessmentStatus.REVIEWED]: [
    InitialAssessmentStatus.IN_PROGRESS,
    InitialAssessmentStatus.ARCHIVED,
  ],
  [InitialAssessmentStatus.ARCHIVED]: [],
  [InitialAssessmentStatus.CANCELLED]: [],
};

export function assertInitialAssessmentStatusTransition(
  from: InitialAssessmentStatus,
  to: InitialAssessmentStatus,
): void {
  if (IA_STATUS_ENDPOINT_TRANSITIONS[from]?.includes(to)) return;
  if (to === InitialAssessmentStatus.SUBMITTED) {
    throw new BadRequestException(
      'Use Submit assessment to submit an initial assessment.',
    );
  }
  if (to === InitialAssessmentStatus.REVIEWED) {
    throw new BadRequestException(
      'An initial assessment can only be marked reviewed through manager review.',
    );
  }
  if (from === to) {
    throw new BadRequestException(
      `The assessment is already ${from.toLowerCase().replace('_', ' ')}.`,
    );
  }
  throw new BadRequestException(
    `An initial assessment cannot move from ${from.toLowerCase().replace('_', ' ')} to ${to.toLowerCase().replace('_', ' ')}.`,
  );
}
