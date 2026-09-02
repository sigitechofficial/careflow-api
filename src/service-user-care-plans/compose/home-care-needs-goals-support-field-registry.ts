import { HOME_CARE_NEEDS_GOALS_SUPPORT_SEED } from '../../../prisma/seeds/home-care-needs-goals-support.seed-data';
import { areaRiskFollowUpManualEntriesNotesOnly } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-only registry for the "Home Care Plan - needs/goals/support" form.
 *
 * This form has NO compose engine and NO dispatch (verified). It is a DIFFERENT form from the
 * large "Home Care Plan", which owns `HOME_CARE_PLAN_FORM_NAME='Home Care Plan'` +
 * `composeHomeCarePlanHybrid`; that engine is untouched and must not be confused with this
 * form. Like Infection / Mobility / Physical Health, every field here is MANUAL — a compose
 * would only ever return an empty result. This registry records that fact and guards that the
 * registry and seed stay in lockstep. It resolves nothing and must never become an engine.
 */
export type HomeCareFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type HomeCareFieldRegistryEntry = {
  businessKey: string;
  mode: HomeCareFieldMappingMode;
  notes: string;
};

export const HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY: readonly HomeCareFieldRegistryEntry[] = [
  // ---------- Identified needs ----------
  { businessKey: 'home_care_personal_care_needs', mode: 'MANUAL', notes: 'Staff-entered personal care needs; no compose engine on this form.' },
  { businessKey: 'home_care_domestic_living_skills', mode: 'MANUAL', notes: 'Staff-entered domestic/living skills.' },
  { businessKey: 'home_care_social_emotional_needs', mode: 'MANUAL', notes: 'Staff-entered social/emotional needs.' },
  { businessKey: 'home_care_needs_person_centred', mode: 'MANUAL', notes: 'Required free-text person-centred narrative for the needs.' },

  // ---------- Goals and support ----------
  { businessKey: 'home_care_goal_1', mode: 'MANUAL', notes: 'Reviewer-entered goal; existing required field.' },
  { businessKey: 'home_care_carer_support', mode: 'MANUAL', notes: 'How carers will support the goal; existing required field.' },
  { businessKey: 'home_care_goal_2', mode: 'MANUAL', notes: 'Optional second goal.' },
  { businessKey: 'home_care_progress_notes', mode: 'MANUAL', notes: 'Free-text progress notes.' },
  { businessKey: 'home_care_area_risk', mode: 'MANUAL', notes: 'Generic risk gate; the assessor owns this decision.' },
  ...areaRiskFollowUpManualEntriesNotesOnly('home_care'),
];

export type HomeCareFieldBusinessKey =
  (typeof HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY)[number]['businessKey'];

export const HOME_CARE_SUGGESTION_KEYS = HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const HOME_CARE_AUTO_PREFILL_KEYS = HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const HOME_CARE_MANUAL_KEYS = HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function homeCareFieldRegistryEntry(businessKey: string): HomeCareFieldRegistryEntry | undefined {
  return HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertHomeCareRegistryMatchesTemplate(): void {
  const templateKeys = HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Home Care registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Home Care registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
