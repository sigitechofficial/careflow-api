import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Eating and Drinking Care Plan template — the local plan merged with the Care 2020 generic
 * needs / goals / support / risk block.
 *
 * The six pre-existing local fields are retained exactly (label, type, required, SELECT
 * options and their order — note "Fluid target per day (ml)" is a NUMBER and "Preferred foods
 * and dislikes" is required) and gain stable `eating_and_drinking_` keys so the ID-safe schema
 * applier can match them by key and preserve their UUIDs. Before this change the form had no
 * keys and was aligned by the destructive generic applier, which hard-deletes sections on
 * every seed — it already orphaned earlier saved `sectionId:fieldId` values (12 stale
 * references remain from prior reseeds); the ID-safe applier stops that recurring.
 *
 * Eating and Drinking already has a mature AUTO-PREFILL compose engine
 * (`composeEatingDrinkingCarePlan` + `EATING_DRINKING_CARE_PLAN_FIELD_MAPPINGS` in
 * `remaining-area-care-plans.compose.ts`) that matches the six existing fields by label and
 * draws on the Initial Assessment answers, the eating-drinking snapshot, the allergies context
 * and the About Me food preferences. That engine is deliberately left untouched; adding keys
 * does not affect it (labels are preserved). Care 2020 contributes only the generic needs /
 * goals / support / risk block (all MANUAL — the IA holds no eating-specific needs/goals/
 * support narrative). Following the project-wide rule, the block carries EXACTLY ONE
 * "Person-centred details" field (eating_and_drinking_needs_person_centred) and it is REQUIRED.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const EATING_AND_DRINKING_CARE_PLAN_NAME = 'Eating and Drinking';

export const EATING_AND_DRINKING_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Nutrition and hydration plan including diet type, assistance level, choking risk, and monitoring of food and fluid intake, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Diet and fluids',
      fields: [
        {
          label: 'Diet type',
          fieldType: T.SELECT,
          options: ['Normal', 'Soft', 'Pureed', 'Diabetic', 'Fortified', 'Other'],
          fieldKey: 'eating_and_drinking_diet_type',
        },
        {
          label: 'Fluid target per day (ml)',
          fieldType: T.NUMBER,
          fieldKey: 'eating_and_drinking_fluid_target',
        },
        {
          label: 'Food allergies or intolerances',
          fieldType: T.TEXTAREA,
          fieldKey: 'eating_and_drinking_food_allergies',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Support at mealtimes',
      fields: [
        {
          label: 'Level of assistance',
          fieldType: T.SELECT,
          options: ['Independent', 'Setup only', 'Supervision', 'Full assistance'],
          fieldKey: 'eating_and_drinking_level_of_assistance',
        },
        {
          label: 'Choking risk / SALT recommendations',
          fieldType: T.TEXTAREA,
          fieldKey: 'eating_and_drinking_choking_salt',
        },
        {
          label: 'Preferred foods and dislikes',
          fieldType: T.TEXTAREA,
          fieldKey: 'eating_and_drinking_preferred_foods',
          required: true,
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      // Exactly ONE "Person-centred details" field
      // (eating_and_drinking_needs_person_centred), which is REQUIRED, matching the
      // project-wide Care 2020 block. No goals/support Person-centred duplicates are modelled.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'eating_and_drinking_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'eating_and_drinking_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'eating_and_drinking_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'eating_and_drinking_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'eating_and_drinking_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Eating and Drinking fields carried no `fieldKey`.
 * Mapping label → key lets the schema applier adopt the existing rows, preserving their UUIDs
 * and any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the
 * exact seeded/live labels, lower-cased for matching. These labels are also the keys the
 * existing AUTO-PREFILL engine matches on, so they must not drift.
 */
export const EATING_AND_DRINKING_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'diet type': 'eating_and_drinking_diet_type',
  'fluid target per day (ml)': 'eating_and_drinking_fluid_target',
  'food allergies or intolerances': 'eating_and_drinking_food_allergies',
  'level of assistance': 'eating_and_drinking_level_of_assistance',
  'choking risk / salt recommendations': 'eating_and_drinking_choking_salt',
  'preferred foods and dislikes': 'eating_and_drinking_preferred_foods',
};
