import { EATING_AND_DRINKING_CARE_PLAN_SEED } from '../../../prisma/seeds/eating-and-drinking-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesResolvedByEngine } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-and-guard registry for the Eating and Drinking Care Plan.
 *
 * Eating and Drinking already has a mature AUTO-PREFILL compose engine in
 * `remaining-area-care-plans.compose.ts` (`EATING_DRINKING_CARE_PLAN_FIELD_MAPPINGS` +
 * `composeEatingDrinkingCarePlan`), matching the six existing fields by label and drawing on
 * the Initial Assessment answers, the eating-drinking snapshot, the allergies context and the
 * About Me food preferences. That engine remains the single source of truth and is
 * intentionally retained unchanged — this registry does NOT re-resolve anything and must never
 * become a second competing Eating and Drinking compose/mapping system.
 *
 * Its job is to (a) record, per field, whether the engine auto-prefills it and from where, or
 * whether it is manual, and (b) guard that the registry and the seed template stay in
 * lockstep. The Care 2020 needs / goals / support / risk block is MANUAL: the IA holds no
 * eating-specific needs / goals / support narrative (nutrition / hydration / choking / allergy
 * data represents clinical detail, not the generic care-planning needs/goals/support/risk
 * concepts), and the generic risk gate is the assessor's decision.
 */
export type EatingDrinkingFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type EatingDrinkingFieldSourceKind =
  | 'INITIAL_ASSESSMENT'
  | 'EATING_DRINKING_SNAPSHOT'
  | 'ALLERGIES'
  | 'ABOUT_ME'
  | 'MANUAL';

export type EatingDrinkingFieldSourceRef = {
  kind: EatingDrinkingFieldSourceKind;
  iaFieldKeys?: readonly string[];
  notes?: string;
};

export type EatingDrinkingFieldRegistryEntry = {
  businessKey: string;
  mode: EatingDrinkingFieldMappingMode;
  /** True when the existing Eating and Drinking engine auto-prefills this field. */
  resolvedByEngine: boolean;
  sources: readonly EatingDrinkingFieldSourceRef[];
};

export const EATING_AND_DRINKING_FIELD_REGISTRY: readonly EatingDrinkingFieldRegistryEntry[] = [
  // ---------- Diet and fluids (existing — auto-prefilled by the engine, by label) ----------
  {
    businessKey: 'eating_and_drinking_diet_type',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['foodTexture'],
        notes:
          'foodTexture may suggest Normal/Soft/Pureed. Never map T2DM / "diabet" onto Diabetic diet. Not AUTO.',
      },
    ],
  },
  {
    businessKey: 'eating_and_drinking_fluid_target',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes: 'IA "fluid target" / "fluid intake" text / snapshot.fluidTargetMl.',
      },
    ],
  },
  {
    businessKey: 'eating_and_drinking_food_allergies',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      { kind: 'ALLERGIES', notes: 'Service-user allergy records (primary source).' },
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['allergiesSummary'],
        notes: 'IA allergiesSummary / snapshot.foodAllergiesIntolerances (merged).',
      },
    ],
  },

  // ---------- Support at mealtimes (existing) ----------
  {
    businessKey: 'eating_and_drinking_level_of_assistance',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['eatingAssistanceLevel'],
        notes:
          'prompting ≠ Setup only; assistance ≠ Supervision. Exact codes only when suggestion is implemented. Not AUTO.',
      },
    ],
  },
  {
    businessKey: 'eating_and_drinking_choking_salt',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes:
          'Never match the word "salt" (SALT vs dietary salt). Swallowing/choking No must not write SALT guidance.',
      },
    ],
  },
  {
    businessKey: 'eating_and_drinking_preferred_foods',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      { kind: 'ABOUT_ME', notes: 'aboutMe.foodPreferences (primary source).' },
      {
        kind: 'INITIAL_ASSESSMENT',
        notes: 'aboutMe.foodPreferences (primary). IA "Food likes and dislikes" only — not the word "dietary".',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'eating_and_drinking_service_user_needs',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic Care 2020 needs field; nutrition/hydration data is clinical detail, not the generic needs concept.',
      },
    ],
  },
  {
    businessKey: 'eating_and_drinking_needs_person_centred',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      { kind: 'MANUAL', notes: 'Required free-text person-centred narrative for the needs question.' },
    ],
  },
  {
    businessKey: 'eating_and_drinking_desired_goals_outcomes',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      { kind: 'MANUAL', notes: 'The IA holds no eating-specific goals; must not be mapped.' },
    ],
  },
  {
    businessKey: 'eating_and_drinking_support_required',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic Care 2020 support narrative; mealtime assistance is a separate clinical field, not this generic one.',
      },
    ],
  },
  {
    businessKey: 'eating_and_drinking_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate; must not be driven from choking/SALT clinical text. The assessor owns this decision.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesResolvedByEngine('eating_and_drinking'),
];

export type EatingDrinkingFieldBusinessKey =
  (typeof EATING_AND_DRINKING_FIELD_REGISTRY)[number]['businessKey'];

export const EATING_AND_DRINKING_AUTO_PREFILL_KEYS = EATING_AND_DRINKING_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const EATING_AND_DRINKING_SUGGESTION_KEYS = EATING_AND_DRINKING_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const EATING_AND_DRINKING_MANUAL_KEYS = EATING_AND_DRINKING_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function eatingAndDrinkingFieldRegistryEntry(
  businessKey: string,
): EatingDrinkingFieldRegistryEntry | undefined {
  return EATING_AND_DRINKING_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertEatingAndDrinkingRegistryMatchesTemplate(): void {
  const templateKeys = EATING_AND_DRINKING_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = EATING_AND_DRINKING_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Eating and Drinking registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Eating and Drinking registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
