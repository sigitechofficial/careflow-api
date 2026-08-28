import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * "Home Care Plan - needs/goals/support" template — the existing project form brought into the
 * project-wide Care 2020 standard by adding exactly ONE required Person-centred details field
 * and the standard risk gate, while preserving every existing field.
 *
 * This is a DIFFERENT form from the large "Home Care Plan" (which uses `hcp_` keys and the
 * `composeHomeCarePlanHybrid` engine). This needs/goals/support form has NO compose engine and
 * NO dispatch — like Infection / Mobility / Physical Health it is schema-only and all-MANUAL.
 * No engine is created.
 *
 * The seven pre-existing project fields are retained EXACTLY (label, type, required) and gain
 * stable `home_care_` keys so the ID-safe schema applier can match them by key and preserve
 * their UUIDs. Before this change the form had no keys and was aligned by the destructive
 * generic applier.
 *
 * Care 2020 needs/goals/support are already represented by the existing fields (Personal care
 * needs / Domestic and living skills / Social and emotional needs cover "what do they need
 * support with at home"; Goal 1/Goal 2 cover "desired goals and outcomes"; How carers will
 * support this covers "support required"). Therefore only the two missing standard elements are
 * added: one REQUIRED "Person-centred details" (home_care_needs_person_centred) in Identified
 * needs, and the risk gate (home_care_area_risk) at the end of Goals and support. No
 * goals/support PCD duplicates are modelled.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const HOME_CARE_NEEDS_GOALS_SUPPORT_NAME = 'Home Care Plan - needs/goals/support';

export const HOME_CARE_NEEDS_GOALS_SUPPORT_SEED: CarePlanFormSeed = {
  description:
    'Detailed needs, goals, and how care staff will support the service user to achieve outcomes in their own home, together with the person’s person-centred details and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Identified needs',
      fields: [
        {
          label: 'Personal care needs',
          fieldType: T.TEXTAREA,
          fieldKey: 'home_care_personal_care_needs',
        },
        {
          label: 'Domestic and living skills',
          fieldType: T.TEXTAREA,
          fieldKey: 'home_care_domestic_living_skills',
        },
        {
          label: 'Social and emotional needs',
          fieldType: T.TEXTAREA,
          fieldKey: 'home_care_social_emotional_needs',
        },
        {
          // NEW — the single required Person-centred details field (project-wide rule).
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'home_care_needs_person_centred',
          required: true,
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Goals and support',
      fields: [
        {
          // Note the en dash "–" — matched exactly by the legacy adoption map.
          label: 'Goal 1 – what we will achieve',
          fieldType: T.TEXTAREA,
          fieldKey: 'home_care_goal_1',
          required: true,
        },
        {
          label: 'How carers will support this',
          fieldType: T.TEXTAREA,
          fieldKey: 'home_care_carer_support',
          required: true,
        },
        {
          label: 'Goal 2 (optional)',
          fieldType: T.TEXTAREA,
          fieldKey: 'home_care_goal_2',
        },
        {
          label: 'Progress notes',
          fieldType: T.TEXTAREA,
          fieldKey: 'home_care_progress_notes',
        },
        {
          // NEW — the standard Care 2020 risk gate.
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'home_care_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original fields carried no `fieldKey`. Mapping label → key lets
 * the schema applier adopt the existing rows, preserving their UUIDs and any saved
 * `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact seeded/live
 * labels, lower-cased for matching (note the en dash in "Goal 1 – what we will achieve").
 */
export const HOME_CARE_NEEDS_GOALS_SUPPORT_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'personal care needs': 'home_care_personal_care_needs',
  'domestic and living skills': 'home_care_domestic_living_skills',
  'social and emotional needs': 'home_care_social_emotional_needs',
  'goal 1 – what we will achieve': 'home_care_goal_1',
  'how carers will support this': 'home_care_carer_support',
  'goal 2 (optional)': 'home_care_goal_2',
  'progress notes': 'home_care_progress_notes',
};
