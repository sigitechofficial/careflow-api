import { CARE_PLAN_REVIEW_FORM_SEED } from '../../../prisma/seeds/care-plan-review-form.seed-data';

/**
 * Documentation-and-guard registry for the Care Plan review form.
 *
 * The Review form already has a compose engine in `care-plan-review.compose.ts`
 * (`CARE_PLAN_REVIEW_FIELD_MAPPINGS` + `composeCarePlanReviewForm`), an AUTO-PREFILL,
 * label-matched engine drawing on the Initial Assessment, eMAR and the Care Pathway review
 * frequency. That engine remains the single source of truth and is intentionally retained
 * unchanged — this registry does NOT re-resolve anything and must never become a second engine.
 *
 * Its job is to (a) record, per field, whether the engine auto-prefills it and from where, or
 * whether it is a manual review input, and (b) guard that the registry and the seed template
 * stay in lockstep. The new "Review assessment" section fields use the exact labels the engine
 * already maps, so adding them activates the existing engine (its mappings previously targeted
 * fields that did not exist in the live schema). The manual review inputs (Review type,
 * Reviewer, outcome fields) are entered by the reviewer and are deliberately NOT engine-driven.
 */
export type ReviewFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type ReviewFieldSourceKind =
  | 'INITIAL_ASSESSMENT'
  | 'EMAR'
  | 'REVIEW_SCHEDULE'
  | 'STATIC'
  | 'MANUAL';

export type ReviewFieldSourceRef = {
  kind: ReviewFieldSourceKind;
  notes?: string;
};

export type ReviewFieldRegistryEntry = {
  businessKey: string;
  mode: ReviewFieldMappingMode;
  /** True when the existing Review engine auto-prefills this field (by label). */
  resolvedByEngine: boolean;
  sources: readonly ReviewFieldSourceRef[];
};

export const CARE_PLAN_REVIEW_FIELD_REGISTRY: readonly ReviewFieldRegistryEntry[] = [
  // ---------- Review details (existing) ----------
  {
    businessKey: 'care_plan_review_review_date',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'STATIC', notes: 'Engine sets today’s date; reviewer may override.' }],
  },
  {
    businessKey: 'care_plan_review_review_type',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'Reviewer selects the review type; not engine-driven.' }],
  },
  {
    businessKey: 'care_plan_review_reviewer',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'Reviewer enters their own name and role.' }],
  },

  // ---------- Review assessment (Care 2020 — auto-prefilled by the existing engine) ----------
  {
    businessKey: 'care_plan_review_physical_wellbeing',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA §4 generalPhysicalWellbeing.' }],
  },
  {
    businessKey: 'care_plan_review_diagnoses_conditions',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA §4–§5 breathing/condition details.' }],
  },
  {
    businessKey: 'care_plan_review_equipment',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA §11–§12 hoist/pressure/further equipment.' }],
  },
  {
    businessKey: 'care_plan_review_environment_access',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA §3 access instructions / smoking / parking.' }],
  },
  {
    businessKey: 'care_plan_review_eating_drinking',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA §6 eating assistance / equipment.' }],
  },
  {
    businessKey: 'care_plan_review_nutrition',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA §6 nutrition status / supplements.' }],
  },
  {
    businessKey: 'care_plan_review_medication_support',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA §9 medicationSupportLevel (mapped).' }],
  },
  {
    businessKey: 'care_plan_review_active_medications',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'EMAR', notes: 'eMAR active + PRN medication list.' }],
  },
  {
    businessKey: 'care_plan_review_capacity_consent',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA Consent tab — consent, capacity doubt, legal authority (iaConsentCapacitySummary).' }],
  },
  {
    businessKey: 'care_plan_review_cognitive_emotional',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'INITIAL_ASSESSMENT', notes: 'IA §10 emotionalWellbeing / sleep / emotional health.' }],
  },

  // ---------- Outcomes (existing) ----------
  {
    businessKey: 'care_plan_review_meeting_needs',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'Reviewer’s judgement; not engine-driven.' }],
  },
  {
    businessKey: 'care_plan_review_changes_required',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'Reviewer narrative of required changes.' }],
  },
  {
    businessKey: 'care_plan_review_actions',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'Reviewer records actions and responsible person.' }],
  },
  {
    businessKey: 'care_plan_review_next_review_date',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [{ kind: 'REVIEW_SCHEDULE', notes: 'Engine sets next date from the Care Pathway review frequency; reviewer may override.' }],
  },
];

export type ReviewFieldBusinessKey = (typeof CARE_PLAN_REVIEW_FIELD_REGISTRY)[number]['businessKey'];

export const CARE_PLAN_REVIEW_AUTO_PREFILL_KEYS = CARE_PLAN_REVIEW_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const CARE_PLAN_REVIEW_SUGGESTION_KEYS = CARE_PLAN_REVIEW_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const CARE_PLAN_REVIEW_MANUAL_KEYS = CARE_PLAN_REVIEW_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function carePlanReviewFieldRegistryEntry(
  businessKey: string,
): ReviewFieldRegistryEntry | undefined {
  return CARE_PLAN_REVIEW_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertCarePlanReviewRegistryMatchesTemplate(): void {
  const templateKeys = CARE_PLAN_REVIEW_FORM_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = CARE_PLAN_REVIEW_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Care Plan review registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Care Plan review registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
