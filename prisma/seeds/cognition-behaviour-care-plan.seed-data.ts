import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Cognition and Behaviour Care Plan template — the local plan merged with the
 * Care 2020 Cognition and Behaviour questions.
 *
 * The seven pre-existing local fields are retained exactly (label, type, options) and
 * gain stable `cog_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed and would
 * orphan any saved `sectionId:fieldId` values.
 *
 * Care 2020 contributes a generic needs / goals / support / risk block. Its repeated
 * "Person-centred details" boxes are real input controls, so each becomes its own field
 * with a distinct key; the surrounding explanatory / policy / dependency-level text on
 * the Care 2020 page is NOT modelled as fields.
 *
 * Home Care Plan, Home Support Plan, Advance Care Plan and the Dementia Care plan are
 * separate products and are not referenced here.
 */
export const COGNITION_BEHAVIOUR_CARE_PLAN_NAME = 'Cognition and Behaviour';

/** Retained local option list for the orientation SELECT. */
export const COGNITION_ORIENTATION_OPTIONS = ['Always', 'Usually', 'Sometimes', 'Rarely'];

export const COGNITION_BEHAVIOUR_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Document cognitive strengths and difficulties, behaviour that challenges, triggers, and strategies carers should use day to day, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Cognition',
      fields: [
        {
          label: 'Diagnosis or cognitive concern',
          fieldType: T.TEXTAREA,
          fieldKey: 'cog_diagnosis_or_concern',
        },
        {
          label: 'Orientation – knows where they are',
          fieldType: T.SELECT,
          fieldKey: 'cog_orientation',
          options: COGNITION_ORIENTATION_OPTIONS,
        },
        {
          label: 'Memory prompts used',
          fieldType: T.TEXT,
          fieldKey: 'cog_memory_prompts',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Behaviour support',
      fields: [
        {
          label: 'Known triggers',
          fieldType: T.TEXTAREA,
          fieldKey: 'cog_known_triggers',
        },
        {
          label: 'Calming strategies that work',
          fieldType: T.TEXTAREA,
          fieldKey: 'cog_calming_strategies',
          required: true,
        },
        {
          label: 'Wandering or exit-seeking risk',
          fieldType: T.YES_NO,
          fieldKey: 'cog_wandering_risk',
        },
        {
          label: 'Additional guidance for carers',
          fieldType: T.TEXTAREA,
          fieldKey: 'cog_additional_guidance',
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
          fieldKey: 'cog_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'cog_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'cog_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'cog_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'cog_area_risk',
        },
        ...areaRiskFollowUpFields('cog'),
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Cognition and Behaviour fields carried no
 * `fieldKey`. Mapping label → key lets the schema applier adopt the existing rows,
 * preserving their UUIDs and any saved `sectionId:fieldId` values, instead of creating
 * duplicates. Labels are the exact seeded/live labels, lower-cased for matching.
 */
export const COGNITION_BEHAVIOUR_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'diagnosis or cognitive concern': 'cog_diagnosis_or_concern',
  'orientation – knows where they are': 'cog_orientation',
  'memory prompts used': 'cog_memory_prompts',
  'known triggers': 'cog_known_triggers',
  'calming strategies that work': 'cog_calming_strategies',
  'wandering or exit-seeking risk': 'cog_wandering_risk',
  'additional guidance for carers': 'cog_additional_guidance',
};
