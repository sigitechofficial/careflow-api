import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Sleeping and Night Care Plan template — the existing published plan merged with the Care 2020
 * Sleeping and Night questions.
 *
 * The six pre-existing local fields are retained exactly (label, type, required) and gain
 * stable `sleeping_night_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed — it would orphan
 * the real saved `sectionId:fieldId` values this form holds.
 *
 * Care 2020 contributes only the generic needs / goals / support / risk block (all MANUAL).
 * Exactly ONE required "Person-centred details" field is added. "Does the resident require a
 * bedrail assessment?" is NOT modelled: CareFlow already has a dedicated published
 * Bed Rail Assessment (ASSESSMENT) plus the shared Care Plan Assessment tab. Policy /
 * dependency-guide / intro copy is NOT modelled.
 *
 * All other care plans are separate products and are not referenced as field sources here.
 */
export const SLEEPING_NIGHT_CARE_PLAN_NAME = 'Sleeping and Night';

export const SLEEPING_NIGHT_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Night-time routine, sleep patterns, disturbances, and how to promote rest while keeping the person safe, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      title: 'Sleep pattern',
      fields: [
        {
          label: 'Usual bedtime and wake time',
          fieldType: T.TEXT,
          fieldKey: 'sleeping_night_usual_bedtime_wake_time',
        },
        {
          label: 'Night-time waking or confusion',
          fieldType: T.TEXTAREA,
          fieldKey: 'sleeping_night_night_waking_confusion',
        },
        {
          label: 'Daytime naps',
          fieldType: T.YES_NO,
          fieldKey: 'sleeping_night_daytime_naps',
        },
      ],
    },
    {
      title: 'Night care',
      fields: [
        {
          label: 'Evening routine',
          fieldType: T.TEXTAREA,
          fieldKey: 'sleeping_night_evening_routine',
          required: true,
        },
        {
          label: 'Call bell / monitoring',
          fieldType: T.TEXT,
          fieldKey: 'sleeping_night_call_bell_monitoring',
        },
        {
          label: 'Night-time drinks or snacks',
          fieldType: T.TEXT,
          fieldKey: 'sleeping_night_night_drinks_snacks',
        },
      ],
    },
    {
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'sleeping_night_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'sleeping_night_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'sleeping_night_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'sleeping_night_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'sleeping_night_area_risk',
        },
        ...areaRiskFollowUpFields('sleeping_night'),
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Sleeping and Night fields carried no `fieldKey`.
 * Mapping label → key lets the schema applier adopt the existing rows, preserving their
 * UUIDs and any saved `sectionId:fieldId` values, instead of creating duplicates.
 */
export const SLEEPING_NIGHT_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'usual bedtime and wake time': 'sleeping_night_usual_bedtime_wake_time',
  'night-time waking or confusion': 'sleeping_night_night_waking_confusion',
  'daytime naps': 'sleeping_night_daytime_naps',
  'evening routine': 'sleeping_night_evening_routine',
  'call bell / monitoring': 'sleeping_night_call_bell_monitoring',
  'night-time drinks or snacks': 'sleeping_night_night_drinks_snacks',
};
