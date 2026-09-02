import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Washing and dressing Care Plan template — the existing published plan merged with the Care 2020
 * needs / goals / support / risk block.
 *
 * The six pre-existing local fields are retained exactly (label, type, required, options) and gain
 * stable `washing_dressing_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed — it would orphan
 * the real saved `sectionId:fieldId` values this form holds.
 *
 * Care 2020 contributes only the generic needs / goals / support / risk block. Exactly ONE
 * required "Person-centred details" field is added. Policy / dependency-guide / intro copy,
 * HCP personal-needs checklists, HSP personal-care fields, capability / double-up / privacy
 * questions, and Body Map / Risk Profile duplicates are NOT modelled.
 *
 * All other care plans are separate products and are not referenced as field sources here.
 */
export const WASHING_DRESSING_CARE_PLAN_NAME = 'Washing and dressing';

export const WASHING_DRESSING_WASH_TYPE_OPTIONS = [
  'Full bath',
  'Shower',
  'Strip wash',
  'Bed bath',
  'Declines on this day',
] as const;

export const WASHING_DRESSING_TIME_OF_DAY_OPTIONS = ['Morning', 'Afternoon', 'Evening'] as const;

export const WASHING_DRESSING_ASSISTANCE_OPTIONS = [
  'Independent',
  'Supervision',
  'Full assistance',
] as const;

export const WASHING_DRESSING_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Personal care preferences for washing, bathing, oral care, and dressing including dignity, gender, and equipment, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      title: 'Preferences',
      fields: [
        {
          label: 'Preferred wash type',
          fieldType: T.SELECT,
          options: [...WASHING_DRESSING_WASH_TYPE_OPTIONS],
          fieldKey: 'washing_dressing_preferred_wash_type',
        },
        {
          label: 'Preferred time of day',
          fieldType: T.SELECT,
          options: [...WASHING_DRESSING_TIME_OF_DAY_OPTIONS],
          fieldKey: 'washing_dressing_preferred_time_of_day',
        },
        {
          label: 'Gender of carer preferred',
          fieldType: T.TEXT,
          fieldKey: 'washing_dressing_gender_of_carer',
        },
      ],
    },
    {
      title: 'Dressing and grooming',
      fields: [
        {
          label: 'Level of assistance required',
          fieldType: T.SELECT,
          options: [...WASHING_DRESSING_ASSISTANCE_OPTIONS],
          fieldKey: 'washing_dressing_assistance_level',
        },
        {
          label: 'Clothing preferences',
          fieldType: T.TEXTAREA,
          fieldKey: 'washing_dressing_clothing_preferences',
        },
        {
          label: 'Dental / denture care',
          fieldType: T.TEXTAREA,
          fieldKey: 'washing_dressing_dental_denture_care',
          required: true,
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
          fieldKey: 'washing_dressing_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'washing_dressing_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'washing_dressing_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'washing_dressing_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'washing_dressing_area_risk',
        },
        ...areaRiskFollowUpFields('washing_dressing'),
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Washing and dressing fields carried no `fieldKey`.
 * Mapping label → key lets the schema applier adopt the existing rows, preserving their
 * UUIDs and any saved `sectionId:fieldId` values, instead of creating duplicates.
 */
export const WASHING_DRESSING_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'preferred wash type': 'washing_dressing_preferred_wash_type',
  'preferred time of day': 'washing_dressing_preferred_time_of_day',
  'gender of carer preferred': 'washing_dressing_gender_of_carer',
  'level of assistance required': 'washing_dressing_assistance_level',
  'clothing preferences': 'washing_dressing_clothing_preferences',
  'dental / denture care': 'washing_dressing_dental_denture_care',
};
