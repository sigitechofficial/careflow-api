import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Pressure Ulcer Care Plan template — the existing published plan merged with the Care 2020
 * Pressure Ulcer Prevention questions.
 *
 * The six pre-existing local fields are retained exactly (label, type, required, options) and
 * gain stable `pressure_ulcer_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed — it would orphan
 * the real saved `sectionId:fieldId` values this form holds.
 *
 * Care 2020 contributes only the generic needs / goals / support / risk block (all MANUAL).
 * Exactly ONE required "Person-centred details" field is added. Wound assessment stays on
 * the shared Body Map workflow; policy / dependency-guide / intro copy is NOT modelled.
 *
 * All other care plans (including Skin Integrity) are separate products and are not referenced
 * as field sources here.
 */
export const PRESSURE_ULCER_CARE_PLAN_NAME = 'Pressure Ulcer';

export const PRESSURE_ULCER_WATERLOW_OPTIONS = ['Low', 'At risk', 'High', 'Very high'] as const;

export const PRESSURE_ULCER_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Skin integrity and pressure ulcer prevention: risk level, repositioning, equipment, and existing wounds with dressings, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Risk and skin',
      fields: [
        {
          label: 'Waterlow or risk score',
          fieldType: T.SELECT,
          options: [...PRESSURE_ULCER_WATERLOW_OPTIONS],
          fieldKey: 'pressure_ulcer_waterlow_risk_score',
        },
        {
          label: 'Existing pressure areas or wounds',
          fieldType: T.TEXTAREA,
          fieldKey: 'pressure_ulcer_existing_areas_wounds',
        },
        {
          label: 'Skin inspection frequency',
          fieldType: T.TEXT,
          fieldKey: 'pressure_ulcer_skin_inspection_frequency',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Prevention plan',
      fields: [
        {
          label: 'Repositioning schedule',
          fieldType: T.TEXTAREA,
          fieldKey: 'pressure_ulcer_repositioning_schedule',
          required: true,
        },
        {
          label: 'Pressure relieving equipment',
          fieldType: T.TEXTAREA,
          fieldKey: 'pressure_ulcer_relieving_equipment',
        },
        {
          label: 'Nutrition linked to skin healing',
          fieldType: T.TEXT,
          fieldKey: 'pressure_ulcer_nutrition_skin_healing',
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      // Exactly ONE "Person-centred details" field (pressure_ulcer_needs_person_centred).
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'pressure_ulcer_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'pressure_ulcer_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'pressure_ulcer_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'pressure_ulcer_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'pressure_ulcer_area_risk',
        },
        ...areaRiskFollowUpFields('pressure_ulcer'),
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Pressure Ulcer fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching.
 */
export const PRESSURE_ULCER_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'waterlow or risk score': 'pressure_ulcer_waterlow_risk_score',
  'existing pressure areas or wounds': 'pressure_ulcer_existing_areas_wounds',
  'skin inspection frequency': 'pressure_ulcer_skin_inspection_frequency',
  'repositioning schedule': 'pressure_ulcer_repositioning_schedule',
  'pressure relieving equipment': 'pressure_ulcer_relieving_equipment',
  'nutrition linked to skin healing': 'pressure_ulcer_nutrition_skin_healing',
};
