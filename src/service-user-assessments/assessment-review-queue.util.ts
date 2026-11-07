import {
  computeAssessmentReviewState,
  type AssessmentReviewState,
  type AssessmentScheduleOverrides,
} from './assessment-review-schedule';
import { resolveCarePathwayFormName } from './assessment-review-context.util';

export type AssessmentReviewQueueItem = {
  serviceUserId: string;
  serviceUserName: string | null;
  assessmentId: string;
  assessmentKey: string;
  assessmentTitle: string;
  latestCompletionId: string | null;
  latestCompletedAt: string | null;
  review: AssessmentReviewState;
  queueReasons: string[];
};

export function buildAssessmentReviewQueueItem(params: {
  serviceUserId: string;
  serviceUserName: string | null;
  assessmentId: string;
  assessmentKey: string;
  assessmentTitle: string;
  latestCompletionId: string | null;
  latestCompletedAt: Date | null;
  snapshot: Record<string, unknown> | null;
  now?: Date;
  overrides?: AssessmentScheduleOverrides;
}): AssessmentReviewQueueItem {
  const review = computeAssessmentReviewState({
    assessmentKey: params.assessmentKey,
    carePathwayFormName: resolveCarePathwayFormName({
      assessmentKey: params.assessmentKey,
      assessmentTitle: params.assessmentTitle,
      snapshot: params.snapshot,
    }),
    lastCompletedAt: params.latestCompletedAt,
    snapshot: params.snapshot,
    now: params.now,
    overrides: params.overrides,
  });

  const queueReasons: string[] = [];
  if (review.status === 'overdue') {
    queueReasons.push('Scheduled review overdue');
  } else if (review.status === 'due_soon') {
    queueReasons.push('Scheduled review due soon');
  } else if (review.status === 'not_started') {
    queueReasons.push('Not yet completed');
  }

  return {
    serviceUserId: params.serviceUserId,
    serviceUserName: params.serviceUserName,
    assessmentId: params.assessmentId,
    assessmentKey: params.assessmentKey,
    assessmentTitle: params.assessmentTitle,
    latestCompletionId: params.latestCompletionId,
    latestCompletedAt: params.latestCompletedAt?.toISOString() ?? null,
    review,
    queueReasons,
  };
}

export function filterReviewQueueItems(
  items: AssessmentReviewQueueItem[],
  opts?: { overdueOnly?: boolean; alertsOnly?: boolean },
): AssessmentReviewQueueItem[] {
  return items.filter((item) => {
    if (opts?.overdueOnly) return item.review.status === 'overdue';
    if (opts?.alertsOnly === false) return true;
    return (
      item.review.alertActive ||
      item.review.status === 'overdue' ||
      item.review.status === 'due_soon'
    );
  });
}
