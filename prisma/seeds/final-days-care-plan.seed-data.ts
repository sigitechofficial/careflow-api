import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Final Days Care Plan template — the local palliative/end-of-life plan merged with the
 * Care 2020 Final Days questions.
 *
 * The six pre-existing local fields are retained exactly (label, type, options) and gain
 * stable `final_days_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed and would orphan
 * any saved `sectionId:fieldId` values.
 *
 * Care 2020 contributes the generic needs / goals / support / risk block plus the
 * "Details of Advance Decision To Refuse Treatment (including DNACPR)" narrative field.
 * Its repeated "Person-centred details" boxes are real input controls, so each becomes its
 * own field with a distinct key; the explanatory / policy / dependency text is NOT modelled.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const FINAL_DAYS_CARE_PLAN_NAME = 'Final Days';

/** Retained local option list for the "Current focus of care" SELECT. */
export const FINAL_DAYS_CURRENT_FOCUS_OPTIONS = ['Active treatment', 'Symptom control', 'End of life'];

export const FINAL_DAYS_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Palliative and end-of-life care preferences: comfort measures, symptom control, family communication, and spiritual support, together with the person’s needs, goals and the support required to achieve them, any advance decision to refuse treatment including DNACPR, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Comfort and symptoms',
      fields: [
        {
          label: 'Current focus of care',
          fieldType: T.SELECT,
          fieldKey: 'final_days_current_focus_of_care',
          options: FINAL_DAYS_CURRENT_FOCUS_OPTIONS,
        },
        {
          label: 'Pain management plan',
          fieldType: T.TEXTAREA,
          fieldKey: 'final_days_pain_management_plan',
        },
        {
          label: 'Mouth care frequency',
          fieldType: T.TEXT,
          fieldKey: 'final_days_mouth_care_frequency',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'People and wishes',
      fields: [
        {
          label: 'Family contact and updates',
          fieldType: T.TEXTAREA,
          fieldKey: 'final_days_family_contact_updates',
        },
        {
          label: 'Spiritual or cultural needs',
          fieldType: T.TEXTAREA,
          fieldKey: 'final_days_spiritual_cultural_needs',
        },
        {
          label: 'Preferred place of death if expressed',
          fieldType: T.TEXT,
          fieldKey: 'final_days_preferred_place_of_death',
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, plus the ADRT/DNACPR
      // narrative field at the end (Care 2020 order). Added new.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, whether a risk is associated with this area, and any advance decision to refuse treatment (including DNACPR).',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'final_days_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'final_days_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'final_days_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'final_days_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'final_days_area_risk',
        },
        ...areaRiskFollowUpFields('final_days'),
        {
          label: 'Details of Advance Decision To Refuse Treatment (including DNACPR)',
          fieldType: T.TEXTAREA,
          fieldKey: 'final_days_adrt_details',
          helpText:
            'Record what has been decided, where the documentation is held, and any limits the person has set.',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Final Days fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the
 * exact seeded/live labels, lower-cased for matching.
 */
export const FINAL_DAYS_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'current focus of care': 'final_days_current_focus_of_care',
  'pain management plan': 'final_days_pain_management_plan',
  'mouth care frequency': 'final_days_mouth_care_frequency',
  'family contact and updates': 'final_days_family_contact_updates',
  'spiritual or cultural needs': 'final_days_spiritual_cultural_needs',
  'preferred place of death if expressed': 'final_days_preferred_place_of_death',
};
