import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Physical Health Care Plan template — the local plan merged with the Care 2020 generic
 * needs / goals / support / risk block.
 *
 * The six pre-existing local fields are retained exactly (label, type, required) and gain
 * stable `physical_health_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed.
 *
 * Physical Health has NO compose engine (verified: no dispatch, no mappings) — like Infection
 * and Mobility it is a schema-only, all-MANUAL plan. There is deliberately no engine: the
 * structured physical-health data that exists (diagnoses, hospital admissions, GP details,
 * NEWS2 / vital-signs / blood-glucose observations) is clinical monitoring detail and is NOT
 * semantically equivalent to the generic Care 2020 needs / goals / support / risk concepts,
 * and none of it is wired into the compose context for this form. Following the project-wide
 * rule, the Care 2020 block carries EXACTLY ONE "Person-centred details" field
 * (physical_health_needs_person_centred) and it is REQUIRED.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const PHYSICAL_HEALTH_CARE_PLAN_NAME = 'Physical Health';

export const PHYSICAL_HEALTH_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Long-term conditions, acute issues, GP and specialist involvement, and monitoring required during care visits, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Health conditions',
      fields: [
        {
          label: 'Primary diagnoses',
          fieldType: T.TEXTAREA,
          fieldKey: 'physical_health_primary_diagnoses',
          required: true,
        },
        {
          label: 'Recent hospital admissions',
          fieldType: T.TEXTAREA,
          fieldKey: 'physical_health_hospital_admissions',
        },
        {
          label: 'GP surgery and named GP',
          fieldType: T.TEXT,
          fieldKey: 'physical_health_gp_surgery',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Monitoring',
      fields: [
        {
          label: 'Vital signs or NEWS2 required',
          fieldType: T.YES_NO,
          fieldKey: 'physical_health_vital_signs_news2',
        },
        {
          label: 'Blood glucose monitoring',
          fieldType: T.YES_NO,
          fieldKey: 'physical_health_blood_glucose',
        },
        {
          label: 'When to seek urgent medical advice',
          fieldType: T.TEXTAREA,
          fieldKey: 'physical_health_urgent_advice',
          required: true,
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      // Exactly ONE "Person-centred details" field (physical_health_needs_person_centred),
      // which is REQUIRED, matching the project-wide Care 2020 block. The screenshot shows a
      // duplicate PCD for goals/support; those duplicates are intentionally NOT modelled.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'physical_health_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'physical_health_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'physical_health_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'physical_health_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'physical_health_area_risk',
        },
        ...areaRiskFollowUpFields('physical_health'),
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Physical Health fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and any
 * saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching.
 */
export const PHYSICAL_HEALTH_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'primary diagnoses': 'physical_health_primary_diagnoses',
  'recent hospital admissions': 'physical_health_hospital_admissions',
  'gp surgery and named gp': 'physical_health_gp_surgery',
  'vital signs or news2 required': 'physical_health_vital_signs_news2',
  'blood glucose monitoring': 'physical_health_blood_glucose',
  'when to seek urgent medical advice': 'physical_health_urgent_advice',
};
