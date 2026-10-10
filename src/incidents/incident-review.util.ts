/**
 * Manager review helpers: readable descriptions of review changes (for the timeline) and the
 * snapshot of a review cycle that is archived when an incident is reopened.
 */

/** Yes/No review answers (stored keys stay stable; labels are what managers see). */
export const REVIEW_ANSWER_LABELS = {
  safeguardingConcern: 'Safeguarding concern',
  // No longer asked (it duplicated "Safeguarding concern"); kept so older reviews still read well.
  possibleAbuseOrNeglect: 'Possible abuse or neglect',
  furtherMedicalAttention: 'Further medical attention',
  externalNotificationRequired: 'External notification required',
  escalationRequired: 'Immediate senior management escalation',
  immediateRisk: 'Immediate or ongoing risk',
} as const;

export type ReviewAnswerKey = keyof typeof REVIEW_ANSWER_LABELS;
export type ReviewAnswers = Record<ReviewAnswerKey | 'managementNotes' | 'protectiveAction', unknown>;

/** "Safeguarding concern No → Yes", "protective action changed", "notes changed" … */
export function describeReviewChanges(before: ReviewAnswers, after: ReviewAnswers): string[] {
  const yn = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : 'Not answered');
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  const out = (Object.keys(REVIEW_ANSWER_LABELS) as ReviewAnswerKey[])
    .filter((k) => !same(before[k], after[k]))
    .map((k) => `${REVIEW_ANSWER_LABELS[k]} ${yn(before[k])} → ${yn(after[k])}`);
  if (!same(before.protectiveAction, after.protectiveAction)) out.push('protective action changed');
  if (!same(before.managementNotes, after.managementNotes)) out.push('notes changed');
  return out;
}

/** Returns an error message when the immediate-risk answer is incomplete, else null. */
export function immediateRiskError(
  immediateRisk: boolean | null | undefined,
  protectiveAction: string | null | undefined,
): string | null {
  return immediateRisk === true && !protectiveAction?.trim()
    ? 'Describe the immediate protective action required or taken'
    : null;
}
