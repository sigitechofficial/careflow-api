/**
 * Decision-specific mental capacity records (MCA 2005 s1–4, functional test first per
 * A Local Authority v JB [2021] UKSC 52). One record per decision — there is no global
 * "has / lacks capacity" result for the person. Stored in `metadata.capacityDecisions`.
 * Mirrors careflow-admin `utils/capacity-decisions.ts` — change both.
 */

export type YesNo = 'yes' | 'no';

export const CAPACITY_DECISION_OPTIONS = [
  { value: 'consent_to_assessment', label: 'Consent to this assessment' },
  { value: 'consent_to_care', label: 'Consent to the proposed care' },
  {
    value: 'information_sharing',
    label: 'Sharing information with family / professionals',
  },
  { value: 'photography', label: 'Clinical photography' },
  { value: 'medication_support', label: 'Support with medication' },
  { value: 'covert_medication', label: 'Covert medication' },
  { value: 'key_safe_access', label: 'Key safe / access to the home' },
  { value: 'bed_rails', label: 'Bed rails' },
  { value: 'finance_support', label: 'Support with finances' },
  {
    value: 'care_arrangements',
    label: 'Care arrangements that restrict freedom (deprivation of liberty)',
  },
  {
    value: 'future_care_wishes',
    label: 'Advance care planning / end-of-life wishes',
  },
  { value: 'other', label: 'Other decision' },
] as const;

export type CapacityDecisionType =
  (typeof CAPACITY_DECISION_OPTIONS)[number]['value'];

export type CapacityDecisionRecord = {
  id: string;
  decision?: CapacityDecisionType;
  decisionOther?: string;
  /** Relevant information given (incl. consequences of deciding either way, or not deciding). */
  relevantInformation?: string;
  /** All practicable steps taken to help the person decide (MCA s1(3)). */
  practicableSteps?: string;
  understand?: YesNo;
  understandEvidence?: string;
  retain?: YesNo;
  retainEvidence?: string;
  weigh?: YesNo;
  weighEvidence?: string;
  communicate?: YesNo;
  communicateEvidence?: string;
  impairment?: YesNo;
  impairmentDetails?: string;
  /** Is the inability to decide because of the impairment / disturbance? */
  causativeNexus?: YesNo;
  outcome?: 'has_capacity' | 'lacks_capacity';
  /** Needed when the outcome differs from what the answers show. */
  outcomeReason?: string;
  /** The person's own views — recorded whatever the outcome (MCA s4(6)). */
  wishes?: string;
  feelings?: string;
  beliefsValues?: string;
  previousWishes?: string;
  objection?: YesNo;
  objectionDetails?: string;
  /** Lacks capacity: does a verified legal authority cover THIS decision? */
  authorityCovers?: YesNo;
  authorityDetails?: string;
  /** Lacks capacity and no covering authority: best-interests process. */
  bestInterestsDecisionMaker?: string;
  bestInterestsConsulted?: string;
  lessRestrictiveOptions?: string;
  bestInterestsOutcome?: string;
  imcaRequired?: YesNo;
  assessorName?: string;
  assessedOn?: string;
  reviewDate?: string;
};

const FUNCTIONAL = ['understand', 'retain', 'weigh', 'communicate'] as const;

export function decisionTitle(record: CapacityDecisionRecord): string {
  if (record.decision === 'other')
    return record.decisionOther?.trim() || 'Other decision';
  return (
    CAPACITY_DECISION_OPTIONS.find((o) => o.value === record.decision)?.label ??
    'Decision not named'
  );
}

/**
 * What the answers show: unable on any functional step + an impairment + a causal link → lacks
 * capacity for this decision; able on every step → has capacity; otherwise not yet determined.
 */
export function indicatedOutcome(
  record: CapacityDecisionRecord,
): 'has_capacity' | 'lacks_capacity' | null {
  const answers = FUNCTIONAL.map((k) => record[k]);
  if (answers.some((a) => a == null)) return null;
  if (answers.every((a) => a === 'yes')) return 'has_capacity';
  if (record.impairment === 'no' || record.causativeNexus === 'no')
    return 'has_capacity';
  if (record.impairment === 'yes' && record.causativeNexus === 'yes')
    return 'lacks_capacity';
  return null;
}

const filled = (v?: string) => Boolean(v?.trim());

/** Missing items for a record (empty = complete). */
export function capacityDecisionGaps(record: CapacityDecisionRecord): string[] {
  const gaps: string[] = [];
  if (
    !record.decision ||
    (record.decision === 'other' && !filled(record.decisionOther))
  )
    gaps.push('the decision');
  if (!filled(record.relevantInformation))
    gaps.push('relevant information given');
  if (!filled(record.practicableSteps))
    gaps.push('steps taken to support the decision');
  for (const k of FUNCTIONAL)
    if (!record[k]) gaps.push(`can ${k === 'weigh' ? 'use or weigh' : k}`);
  const anyUnable = FUNCTIONAL.some((k) => record[k] === 'no');
  if (anyUnable && !record.impairment) gaps.push('impairment or disturbance');
  if (anyUnable && record.impairment === 'yes' && !record.causativeNexus)
    gaps.push('whether the impairment causes the inability');
  if (!record.outcome) gaps.push('outcome');
  const indicated = indicatedOutcome(record);
  if (
    record.outcome &&
    indicated &&
    record.outcome !== indicated &&
    !filled(record.outcomeReason)
  ) {
    gaps.push('reason the outcome differs from the answers');
  }
  if (!filled(record.wishes)) gaps.push("the person's wishes");
  if (!record.objection) gaps.push('whether the person objects');
  if (record.objection === 'yes' && !filled(record.objectionDetails))
    gaps.push('how the person objects');
  if (record.outcome === 'lacks_capacity') {
    if (!record.authorityCovers)
      gaps.push('whether a legal authority covers this decision');
    if (record.authorityCovers === 'yes' && !filled(record.authorityDetails))
      gaps.push('the covering authority');
    if (record.authorityCovers === 'no') {
      if (!filled(record.bestInterestsDecisionMaker))
        gaps.push('best-interests decision maker');
      if (!filled(record.bestInterestsConsulted))
        gaps.push('who was consulted');
      if (!filled(record.bestInterestsOutcome))
        gaps.push('best-interests outcome');
    }
  }
  if (!filled(record.assessorName)) gaps.push('assessor');
  if (!filled(record.assessedOn)) gaps.push('date assessed');
  return gaps;
}

export function isCapacityDecisionComplete(
  record: CapacityDecisionRecord,
): boolean {
  return capacityDecisionGaps(record).length === 0;
}

export function normalizeCapacityDecisions(
  raw: unknown,
): CapacityDecisionRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is CapacityDecisionRecord =>
      Boolean(r) &&
      typeof r === 'object' &&
      typeof (r as { id?: unknown }).id === 'string',
  );
}

/** Latest complete record for a decision (records are appended over time). */
export function completedDecisionFor(
  records: CapacityDecisionRecord[],
  decision: CapacityDecisionType,
): CapacityDecisionRecord | undefined {
  return [...records]
    .reverse()
    .find((r) => r.decision === decision && isCapacityDecisionComplete(r));
}

export function hasCompleteCapacityDecision(
  records: CapacityDecisionRecord[],
): boolean {
  return records.some(isCapacityDecisionComplete);
}

export function newCapacityDecision(
  decision?: CapacityDecisionType,
): CapacityDecisionRecord {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `cd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, ...(decision ? { decision } : {}) };
}

/** Core screening answers that decide which decisions need a capacity record. */
export type CapacityDecisionTriggers = {
  capacityDoubt: boolean | null;
  covertMedication: boolean | null;
  dolRestrictions: string[] | null;
  dolConcern: string | null;
};

export type CapacityDecisionNeed = {
  decision: CapacityDecisionType;
  reason: string;
  /** Required = a submit block until a complete record exists; otherwise suggested. */
  required: boolean;
};

/**
 * Decisions the screening says need a capacity record. Capacity is presumed (MCA s1(2)) — nothing is
 * asked for until something gives a reason to doubt it or a decision is proposed that needs one.
 */
export function capacityDecisionNeeds(
  t: CapacityDecisionTriggers,
): CapacityDecisionNeed[] {
  const needs: CapacityDecisionNeed[] = [];
  if (t.capacityDoubt === true) {
    needs.push({
      decision: 'consent_to_care',
      reason: 'Reason to doubt capacity (Consent)',
      required: true,
    });
  }
  if (t.covertMedication === true) {
    needs.push({
      decision: 'covert_medication',
      reason: 'Covert medication proposed',
      required: true,
    });
  }
  const restrictions = (t.dolRestrictions ?? []).filter((v) => v !== 'none');
  if (t.dolConcern === 'yes' || t.dolConcern === 'unsure') {
    needs.push({
      decision: 'care_arrangements',
      reason: 'Possible deprivation of liberty',
      required: true,
    });
  } else if (restrictions.some((v) => v !== 'bed_rails_or_belts')) {
    needs.push({
      decision: 'care_arrangements',
      reason: 'Restrictions recorded',
      required: false,
    });
  }
  if (restrictions.includes('bed_rails_or_belts')) {
    needs.push({
      decision: 'bed_rails',
      reason: 'Bed rails or lap belts',
      required: false,
    });
  }
  return needs;
}

/** Old IAs recorded one global screening (§2.mca) — they keep the old rules until a record is added. */
export function usesLegacyCapacityScreening(
  records: CapacityDecisionRecord[],
  legacyScreeningAnswered: boolean,
) {
  return records.length === 0 && legacyScreeningAnswered;
}

export type CapacityDecisionIssues = { blocks: string[]; warnings: string[] };

/** Submit issues for the decision records. Mirrors careflow-admin `capacityDecisionIssues`. */
export function capacityDecisionIssues(
  records: CapacityDecisionRecord[],
  triggers: CapacityDecisionTriggers,
  legacyScreeningAnswered: boolean,
): CapacityDecisionIssues {
  const blocks: string[] = [];
  const warnings: string[] = [];
  if (usesLegacyCapacityScreening(records, legacyScreeningAnswered))
    return { blocks, warnings };
  for (const r of records) {
    const gaps = capacityDecisionGaps(r);
    if (gaps.length)
      blocks.push(
        `Capacity assessment incomplete — ${decisionTitle(r)}: ${gaps.join(', ')}`,
      );
  }
  for (const need of capacityDecisionNeeds(triggers)) {
    if (!need.required || completedDecisionFor(records, need.decision))
      continue;
    const label =
      CAPACITY_DECISION_OPTIONS.find((o) => o.value === need.decision)?.label ??
      need.decision;
    blocks.push(
      `Required: capacity assessment for "${label}" — ${need.reason}`,
    );
  }
  for (const r of records.filter(isCapacityDecisionComplete)) {
    if (r.outcome !== 'lacks_capacity') continue;
    if (r.objection === 'yes') {
      warnings.push(
        `${decisionTitle(r)}: the person objects — manager review required; their objection must be weighed and may need escalation`,
      );
    }
    if (r.authorityCovers === 'yes') {
      warnings.push(
        `${decisionTitle(r)}: manager to verify the legal authority is registered and covers this decision`,
      );
    }
  }
  return { blocks, warnings };
}

/**
 * Refusal context from a complete record for the refused decision. With capacity the refusal stands;
 * lacking capacity it can only proceed with a best-interests decision or covering authority — the
 * person's wishes and objection are part of the record. Never "lacks capacity → refusal ignored".
 */
export function refusalContextFromDecision(
  record: CapacityDecisionRecord | undefined,
) {
  if (!record) return null;
  return {
    hasCapacity: record.outcome === 'has_capacity',
    lacksCapacity: record.outcome === 'lacks_capacity',
    bestInterestRecorded:
      record.outcome === 'lacks_capacity' &&
      record.authorityCovers === 'no' &&
      filled(record.bestInterestsOutcome),
    coveringAuthority:
      record.outcome === 'lacks_capacity' && record.authorityCovers === 'yes',
  };
}

/** Carer-facing summary (promoted as `snapshot.decisions[]`, read by the carer app). */
export function capacityDecisionForCarers(record: CapacityDecisionRecord) {
  const lacks = record.outcome === 'lacks_capacity';
  const note = lacks
    ? record.authorityCovers === 'yes'
      ? `Decided by the person's legal representative${record.authorityDetails ? ` (${record.authorityDetails.trim()})` : ''}. Still involve the person.`
      : `Best-interests decision: ${record.bestInterestsOutcome?.trim() ?? ''}`.trim()
    : 'The person makes this decision.';
  return {
    id: record.id,
    decision: record.decision,
    title: decisionTitle(record),
    status: record.outcome,
    hasCapacity: record.outcome === 'has_capacity',
    reviewAt: record.reviewDate ?? null,
    assessor: record.assessorName ?? null,
    note: [
      note,
      record.wishes?.trim() ? `Their wishes: ${record.wishes.trim()}` : null,
      record.objection === 'yes' ? 'They object — see office.' : null,
    ]
      .filter(Boolean)
      .join(' '),
  };
}
