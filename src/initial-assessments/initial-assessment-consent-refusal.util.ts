/**
 * What happens when the person says No to a consent question (assessment §2.1 or care §2.2).
 * A refusal is never ignored (CQC Regulation 11, MCA 2005): with capacity it stands; with capacity in
 * doubt the IA goes on only once capacity for this decision is assessed as lacking AND a best-interests
 * decision (recording the person's wishes and objection) or a covering legal authority is recorded —
 * and a manager reviews it. Mirrors careflow-admin `consentRefusalRoute`.
 */
export type ConsentRefusalRoute =
  | 'none'
  | 'refusal_stands'
  | 'needs_capacity_and_best_interests'
  | 'proceed_with_manager_review';

export function consentRefusalRoute(input: {
  refused: boolean;
  capacityInDoubt: boolean;
  /** A decision-specific record for this decision found the person has capacity. */
  hasCapacityForDecision?: boolean;
  lacksCapacity: boolean;
  bestInterestRecorded: boolean;
  coveringAuthority: boolean;
}): ConsentRefusalRoute {
  if (!input.refused) return 'none';
  if (!input.capacityInDoubt || input.hasCapacityForDecision) return 'refusal_stands';
  if (!input.lacksCapacity) return 'needs_capacity_and_best_interests';
  if (input.bestInterestRecorded || input.coveringAuthority) return 'proceed_with_manager_review';
  return 'needs_capacity_and_best_interests';
}

/** Consent-tab legal authorities that name a decision maker (scope is checked by the manager). */
export const LEGAL_AUTHORITY_WITH_DECISION_MAKER = ['hw_lpa', 'deputy', 'court_order_other'] as const;
