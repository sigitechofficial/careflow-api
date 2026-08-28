import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Culture/Religion/Spirituality Care Plan template — the local plan merged with the
 * Care 2020 Culture/Religion/Spirituality questions.
 *
 * The six pre-existing local fields are retained exactly (label, type) and gain stable
 * `crs_` keys so the ID-safe schema applier can match them by key and preserve their
 * UUIDs. Before this change the form had no keys and was aligned by the destructive
 * generic applier, which hard-deletes sections on every seed and would orphan any saved
 * `sectionId:fieldId` values.
 *
 * Care 2020 contributes a generic needs / goals / support / risk block. Its repeated
 * "Person-centred details" boxes are real input controls, so each becomes its own field
 * with a distinct key; the surrounding explanatory / policy / dependency-level text on
 * the Care 2020 page is NOT modelled as fields.
 *
 * Home Care Plan, Home Support Plan, Advance Care Plan, Cognition & Behaviour and the
 * Dementia Care plan are separate products and are not referenced here.
 */
export const CULTURE_RELIGION_CARE_PLAN_NAME = 'Culture/Religion/Spirituality';

export const CULTURE_RELIGION_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Cultural, religious, and spiritual preferences that must be respected in daily care, meals, routines, and end-of-life planning, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Identity and beliefs',
      fields: [
        {
          label: 'Faith or belief system',
          fieldType: T.TEXT,
          fieldKey: 'crs_faith_belief_system',
        },
        {
          label: 'Cultural practices important to the person',
          fieldType: T.TEXTAREA,
          fieldKey: 'crs_cultural_practices',
        },
        {
          label: 'Religious observances or visits',
          fieldType: T.TEXTAREA,
          fieldKey: 'crs_religious_observances',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Daily care impact',
      fields: [
        {
          label: 'Dietary requirements linked to faith/culture',
          fieldType: T.TEXTAREA,
          fieldKey: 'crs_dietary_requirements',
        },
        {
          label: 'Gender preference for personal care',
          fieldType: T.TEXT,
          fieldKey: 'crs_gender_preference',
        },
        {
          label: 'Notes for staff',
          fieldType: T.TEXTAREA,
          fieldKey: 'crs_staff_notes',
          required: true,
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'crs_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'crs_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'crs_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'crs_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'crs_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Culture/Religion/Spirituality fields carried no
 * `fieldKey`. Mapping label → key lets the schema applier adopt the existing rows,
 * preserving their UUIDs and any saved `sectionId:fieldId` values, instead of creating
 * duplicates. Labels are the exact seeded/live labels, lower-cased for matching.
 */
export const CULTURE_RELIGION_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'faith or belief system': 'crs_faith_belief_system',
  'cultural practices important to the person': 'crs_cultural_practices',
  'religious observances or visits': 'crs_religious_observances',
  'dietary requirements linked to faith/culture': 'crs_dietary_requirements',
  'gender preference for personal care': 'crs_gender_preference',
  'notes for staff': 'crs_staff_notes',
};
