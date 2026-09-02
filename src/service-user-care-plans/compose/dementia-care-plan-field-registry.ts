import { DEMENTIA_CARE_PLAN_SEED } from '../../../prisma/seeds/dementia-care-plan.seed-data';
import { AREA_RISK_FOLLOW_UP_MANUAL_NOTE, areaRiskFollowUpFieldKeys } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-and-guard registry for the Dementia Care Plan.
 *
 * Dementia already has a compose engine in `dementia-care-plan.compose.ts`
 * (`DEMENTIA_CARE_PLAN_FIELD_MAPPINGS` + `composeDementiaCarePlan`), an AUTO-PREFILL,
 * label-matched engine drawing on About Me, the Initial Assessment (§8, §10.6/§10.6a, §12),
 * emergency contacts and the Care Pathway review frequency. That engine remains the single
 * source of truth and is intentionally retained unchanged — this registry does NOT re-resolve
 * anything and must never become a second engine.
 *
 * The new "Dementia assessment" section fields use the exact labels the engine already maps, so
 * adding them activates the existing engine (its mappings previously targeted fields that did
 * not exist in the live schema). The Care 2020 standard needs/goals/support/risk block is
 * MANUAL (no generic IA source), with exactly one required Person-centred details field.
 */
export type DementiaFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type DementiaFieldSourceKind =
  | 'ABOUT_ME'
  | 'INITIAL_ASSESSMENT'
  | 'EMERGENCY_CONTACTS'
  | 'REVIEW_SCHEDULE'
  | 'MANUAL';

export type DementiaFieldSourceRef = {
  kind: DementiaFieldSourceKind;
  notes?: string;
};

export type DementiaFieldRegistryEntry = {
  businessKey: string;
  mode: DementiaFieldMappingMode;
  /** True when the existing Dementia engine auto-prefills this field (by label). */
  resolvedByEngine: boolean;
  sources: readonly DementiaFieldSourceRef[];
};

const AUTO = (businessKey: string, kind: DementiaFieldSourceKind, notes: string): DementiaFieldRegistryEntry => ({
  businessKey,
  mode: 'AUTO_PREFILL',
  resolvedByEngine: true,
  sources: [{ kind, notes }],
});

const MANUAL = (businessKey: string, notes: string): DementiaFieldRegistryEntry => ({
  businessKey,
  mode: 'MANUAL',
  resolvedByEngine: false,
  sources: [{ kind: 'MANUAL', notes }],
});

const SUGGEST = (
  businessKey: string,
  kind: DementiaFieldSourceKind,
  notes: string,
): DementiaFieldRegistryEntry => ({
  businessKey,
  mode: 'SUGGESTION',
  resolvedByEngine: true,
  sources: [{ kind, notes }],
});

export const DEMENTIA_FIELD_REGISTRY: readonly DementiaFieldRegistryEntry[] = [
  // ---------- Understanding the person (existing) ----------
  AUTO('dementia_life_history', 'ABOUT_ME', 'About Me lifeHistoryInterests / whatMattersMost.'),
  MANUAL('dementia_stage', 'Staff-entered dementia stage; no equivalent single IA source.'),
  MANUAL('dementia_best_time', 'Staff-entered preference; not engine-driven.'),

  // ---------- Daily support (existing) ----------
  MANUAL('dementia_orientation_cues', 'Staff-entered orientation aids; not engine-driven.'),
  AUTO('dementia_sundowning', 'ABOUT_ME', 'About Me howToSupport / IA §10.6a agitation-with-change.'),
  AUTO('dementia_supervision_level', 'INITIAL_ASSESSMENT', 'IA §10.6 cognitiveImpairment mapped to supervision level.'),

  // ---------- Dementia assessment (Care 2020 — auto-prefilled by the existing engine) ----------
  AUTO('dementia_good_day', 'ABOUT_ME', 'About Me goodDay / meaningfulActivities.'),
  AUTO('dementia_communication', 'ABOUT_ME', 'About Me communication / IA §8.1 communication support notes.'),
  AUTO('dementia_cognitive_impairment', 'INITIAL_ASSESSMENT', 'IA §10.6 cognitiveImpairment (mapped label).'),
  AUTO('dementia_diagnosed', 'INITIAL_ASSESSMENT', 'IA §10.6a Diagnosed dementia (boolean).'),
  AUTO('dementia_memory_orientation', 'INITIAL_ASSESSMENT', 'IA §10.6a memory / orientation profile.'),
  AUTO('dementia_gp_referral', 'INITIAL_ASSESSMENT', 'IA §10.6 GP cognition referral requested/made/date.'),
  AUTO('dementia_triggers', 'ABOUT_ME', 'About Me triggersCalm / IA §10.6a agitation-with-change.'),
  AUTO('dementia_calming_strategies', 'ABOUT_ME', 'About Me howToSupport / triggersCalm.'),
  AUTO('dementia_daily_routines', 'ABOUT_ME', 'About Me routineSummary.'),
  AUTO('dementia_meaningful_activities', 'ABOUT_ME', 'About Me meaningfulActivities / lifeHistoryInterests.'),
  MANUAL(
    'dementia_wandering_risk',
    'Must not infer wandering/exit-seeking from de-orientated + falls. No IA wandering question.',
  ),
  AUTO('dementia_night_support', 'ABOUT_ME', 'About Me nightSupport.'),
  AUTO('dementia_family_involvement', 'ABOUT_ME', 'About Me peopleImportant / emergency contacts.'),
  AUTO('dementia_next_review', 'REVIEW_SCHEDULE', 'Care Pathway review frequency; reviewer may override.'),

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  MANUAL('dementia_service_user_needs', 'Generic Care 2020 needs field; no generic dementia needs source.'),
  SUGGEST(
    'dementia_needs_person_centred',
    'ABOUT_ME',
    'Suggestion from first-person howAndWhenToSupportMe / About Me howToSupport. Never inferred from diagnosis.',
  ),
  MANUAL('dementia_desired_goals_outcomes', 'The IA holds no dementia-specific goals; must not be mapped.'),
  SUGGEST(
    'dementia_support_required',
    'ABOUT_ME',
    'Suggestion from first-person how to support / communication. Staff must accept.',
  ),
  MANUAL('dementia_area_risk', 'Generic risk gate; must not be driven from cognition/wandering data. The assessor owns it.'),
  ...areaRiskFollowUpFieldKeys('dementia').map((key) => MANUAL(key, AREA_RISK_FOLLOW_UP_MANUAL_NOTE)),
];

export type DementiaFieldBusinessKey = (typeof DEMENTIA_FIELD_REGISTRY)[number]['businessKey'];

export const DEMENTIA_AUTO_PREFILL_KEYS = DEMENTIA_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const DEMENTIA_SUGGESTION_KEYS = DEMENTIA_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const DEMENTIA_MANUAL_KEYS = DEMENTIA_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function dementiaFieldRegistryEntry(businessKey: string): DementiaFieldRegistryEntry | undefined {
  return DEMENTIA_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertDementiaRegistryMatchesTemplate(): void {
  const templateKeys = DEMENTIA_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = DEMENTIA_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Dementia registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Dementia registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
