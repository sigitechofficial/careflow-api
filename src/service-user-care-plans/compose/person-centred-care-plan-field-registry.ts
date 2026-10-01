import { PERSON_CENTRED_CARE_PLAN_SEED } from '../../../prisma/seeds/person-centred-care-plan.seed-data';

/**
 * Documentation-and-guard registry for the Person Centred Care Plan.
 *
 * This is a DEDICATED person-centred plan and is EXEMPT from the generic Care 2020
 * "Person-centred details" rule: it has no needs/goals/support/risk block, and every field is
 * itself person-centred content, so no generic "Person-centred details" field is added.
 *
 * The form already has an AUTO-PREFILL compose engine (`composePersonCentredCarePlan` in
 * `area-care-plans.compose.ts`, dispatched as `PERSON_CENTRED_FORM_NAME='Person Centred care
 * plan'`), matching all six fields by label and drawing on About Me + IA §1.3/§1.4. That engine
 * remains the single source of truth and is intentionally retained unchanged — this registry
 * does NOT re-resolve anything and must never become a second engine. Its job is to record each
 * field's compose mode and guard that the registry and seed stay in lockstep.
 */
export type PersonCentredFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type PersonCentredFieldRegistryEntry = {
  businessKey: string;
  mode: PersonCentredFieldMappingMode;
  /** True when the existing Person Centred engine auto-prefills this field (by label). */
  resolvedByEngine: boolean;
  notes: string;
};

export const PERSON_CENTRED_FIELD_REGISTRY: readonly PersonCentredFieldRegistryEntry[] = [
  // ---------- About me ----------
  {
    businessKey: 'person_centred_what_important',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    notes: 'About Me whatMattersMost / IA §1.3 (required).',
  },
  {
    businessKey: 'person_centred_how_supported',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    notes: 'About Me howToSupport / IA §1.3 howToSupportMe (required).',
  },
  {
    businessKey: 'person_centred_people_matter',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    notes: 'About Me peopleImportant / IA §1.3 peopleImportantToMe.',
  },

  // ---------- About me — Care 2020 person-centred narrative (added 2026-08-28) ----------
  // MANUAL: the existing engine does not map these labels and there is no defensible
  // auto-prefill/suggestion source; they are staff-entered person-centred free text.
  {
    businessKey: 'person_centred_likes',
    mode: 'MANUAL',
    resolvedByEngine: false,
    notes: 'Person-centred likes; no engine mapping / IA source.',
  },
  {
    businessKey: 'person_centred_dislikes',
    mode: 'MANUAL',
    resolvedByEngine: false,
    notes: 'Person-centred dislikes; no engine mapping / IA source.',
  },
  {
    businessKey: 'person_centred_interact_others',
    mode: 'MANUAL',
    resolvedByEngine: false,
    notes: 'How the person interacts with others; no engine mapping / IA source.',
  },
  {
    businessKey: 'person_centred_family_info',
    mode: 'MANUAL',
    resolvedByEngine: false,
    notes: 'Family narrative; contacts/relationships are the system-of-record, this is free text.',
  },
  {
    businessKey: 'person_centred_pets',
    mode: 'MANUAL',
    resolvedByEngine: false,
    notes: 'Pets; no store elsewhere, no engine mapping / IA source.',
  },

  // ---------- Daily life ----------
  {
    businessKey: 'person_centred_morning_routine',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    notes: 'About Me routineSummary / IA §1.4 morning routine.',
  },
  {
    businessKey: 'person_centred_evening_routine',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    notes: 'About Me nightSupport only (IA §1.4 routine is one combined answer, used for the morning field).',
  },
  {
    businessKey: 'person_centred_upset_calm',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    notes: 'About Me triggersCalm / IA §1.4 known triggers.',
  },

  // ---------- Personal details (Care 2020, added 2026-08-28) ----------
  { businessKey: 'person_centred_preferred_name', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from profile preferredName (read-only).' },
  { businessKey: 'person_centred_date_of_birth', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from ServiceUser.dateOfBirth (read-only).' },
  { businessKey: 'person_centred_sexuality', mode: 'MANUAL', resolvedByEngine: false, notes: 'Sensitive EDI; no store → manual.' },
  { businessKey: 'person_centred_ethnic_origin', mode: 'MANUAL', resolvedByEngine: false, notes: 'Ethnicity is a lookup catalog with no per-service-user link → manual.' },
  { businessKey: 'person_centred_religion', mode: 'MANUAL', resolvedByEngine: false, notes: 'Culture/Religion/Spirituality plan is source of truth; person-centred note here is manual.' },
  { businessKey: 'person_centred_culture', mode: 'MANUAL', resolvedByEngine: false, notes: 'Culture/Religion/Spirituality plan is source of truth; manual here.' },
  { businessKey: 'person_centred_address', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from ServiceUserAddress (read-only).' },
  { businessKey: 'person_centred_phone', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from ServiceUser.mobile/phone (read-only).' },

  // ---------- Family and important people ----------
  { businessKey: 'person_centred_advocate', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from emergency contacts (name/relationship/phone).' },
  { businessKey: 'person_centred_family_language', mode: 'MANUAL', resolvedByEngine: false, notes: 'Language is a lookup catalog with no per-service-user link → manual.' },
  { businessKey: 'person_centred_siblings', mode: 'MANUAL', resolvedByEngine: false, notes: 'ServiceUserContact is source of truth; free-text here is manual.' },
  { businessKey: 'person_centred_professionals', mode: 'MANUAL', resolvedByEngine: false, notes: 'Care team / references hold this; no clean single prefill → manual.' },

  // ---------- My community, learning and safety ----------
  { businessKey: 'person_centred_community_access', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from About Me meaningfulActivities; Social Activities plan = detailed SoT.' },
  { businessKey: 'person_centred_road_safety', mode: 'MANUAL', resolvedByEngine: false, notes: 'Personal Safety plan = source of truth; summary here is manual.' },
  { businessKey: 'person_centred_educational_needs', mode: 'MANUAL', resolvedByEngine: false, notes: 'No store → manual.' },
  { businessKey: 'person_centred_property_access', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from address accessInstructions / key-safe (read-only).' },

  // ---------- My care and health (person-centred summaries; dedicated plans = SoT) ----------
  { businessKey: 'person_centred_personal_care', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from About Me personalCare, else IA §1.4 bathing / dressing preferences; Washing & dressing / Home Care = detailed SoT.' },
  { businessKey: 'person_centred_eating_drinking', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from About Me foodPreferences, else IA §1.5 food likes and dislikes; Eating & Drinking plan = detailed SoT.' },
  { businessKey: 'person_centred_comm_behaviour', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from About Me communication; Communication + Cognition plans = detailed SoT.' },
  { businessKey: 'person_centred_health', mode: 'MANUAL', resolvedByEngine: false, notes: 'Physical Health plan = source of truth; summary here is manual (no ctx source).' },
  { businessKey: 'person_centred_mobility', mode: 'AUTO_PREFILL', resolvedByEngine: true, notes: 'Prefill from IA ADL mobility aids list; Mobility plan = source of truth.' },
  { businessKey: 'person_centred_diagnosis', mode: 'MANUAL', resolvedByEngine: false, notes: 'Physical Health plan = source of truth; summary here is manual (no ctx source).' },
  { businessKey: 'person_centred_care_details', mode: 'MANUAL', resolvedByEngine: false, notes: 'Narrative overview; manual.' },

  // ---------- Consent and completion (Consent & Mental Capacity module = SoT) ----------
  { businessKey: 'person_centred_home_access_consent', mode: 'MANUAL', resolvedByEngine: false, notes: 'Consent module = source of truth; manual here.' },
  { businessKey: 'person_centred_consent_gained', mode: 'MANUAL', resolvedByEngine: false, notes: 'Consent module = source of truth; manual here.' },
  { businessKey: 'person_centred_date_completed', mode: 'MANUAL', resolvedByEngine: false, notes: 'Form publish/version metadata is authoritative; manual field.' },
];

export type PersonCentredFieldBusinessKey =
  (typeof PERSON_CENTRED_FIELD_REGISTRY)[number]['businessKey'];

export const PERSON_CENTRED_AUTO_PREFILL_KEYS = PERSON_CENTRED_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const PERSON_CENTRED_SUGGESTION_KEYS = PERSON_CENTRED_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const PERSON_CENTRED_MANUAL_KEYS = PERSON_CENTRED_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function personCentredFieldRegistryEntry(
  businessKey: string,
): PersonCentredFieldRegistryEntry | undefined {
  return PERSON_CENTRED_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertPersonCentredRegistryMatchesTemplate(): void {
  const templateKeys = PERSON_CENTRED_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = PERSON_CENTRED_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Person Centred registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Person Centred registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
