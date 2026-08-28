import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Care Plan review form template — the existing project Review form merged with the Care 2020
 * "Review Assessment" content.
 *
 * The seven pre-existing local fields (Review details + Outcomes) are retained EXACTLY (label,
 * type, required, SELECT options and order) and gain stable `care_plan_review_` keys so the
 * ID-safe schema applier can match them by key and preserve their UUIDs. Before this change
 * the form had no keys and was aligned by the destructive generic applier.
 *
 * The Care 2020 Review Assessment content is added as a new middle section "Review assessment"
 * using the fields the project's EXISTING compose engine already defines
 * (`CARE_PLAN_REVIEW_FIELD_MAPPINGS` + `composeCarePlanReviewForm` in
 * `care-plan-review.compose.ts`). Those AUTO-PREFILL mappings — Overall physical wellbeing,
 * Primary diagnoses and conditions, Equipment in use, Environmental risks and access, Eating
 * and drinking support, Nutrition status and concerns, Medication support level, Active
 * medications summary, Capacity and consent summary, Cognitive and emotional summary — are the
 * project's own terminology for exactly the Care 2020 review-assessment concepts (general
 * health/condition, equipment/services, nutrition & hydration, medication, mental capacity,
 * behaviour/communication/vision-hearing, home environment). They previously targeted fields
 * that did not exist in the live schema, so adding these fields ACTIVATES the existing engine
 * rather than creating a second one; labels are preserved verbatim so the engine keeps
 * matching by label. Nothing about the engine or its mappings is changed.
 *
 * The existing project OUTCOMES fields and DATE/SELECT/YES_NO types are preserved. Version
 * history and review versioning are app-level features and are not modelled here.
 */
export const CARE_PLAN_REVIEW_FORM_NAME = 'Care Plan review form';

export const CARE_PLAN_REVIEW_FORM_SEED: CarePlanFormSeed = {
  description:
    'Structured review of the service user’s care plan. Capture what is working, risks, changes required, and who will action follow-up.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Review details',
      fields: [
        {
          label: 'Review date',
          fieldType: T.DATE,
          fieldKey: 'care_plan_review_review_date',
          required: true,
        },
        {
          label: 'Review type',
          fieldType: T.SELECT,
          options: ['Scheduled', 'Unscheduled', 'Post-incident', 'Hospital discharge'],
          fieldKey: 'care_plan_review_review_type',
        },
        {
          label: 'Reviewer name and role',
          fieldType: T.TEXT,
          fieldKey: 'care_plan_review_reviewer',
          required: true,
        },
      ],
    },
    {
      // Care 2020 Review Assessment — new section. Every field here is AUTO-PREFILLED by the
      // EXISTING engine (`CARE_PLAN_REVIEW_FIELD_MAPPINGS`); labels match the engine verbatim.
      title: 'Review assessment',
      description:
        'Assessment of the service user’s current health, conditions, equipment, environment, nutrition, medication, capacity and cognition at review, drawn from the Initial Assessment and eMAR.',
      fields: [
        {
          label: 'Overall physical wellbeing',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_physical_wellbeing',
        },
        {
          label: 'Primary diagnoses and conditions',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_diagnoses_conditions',
        },
        {
          label: 'Equipment in use',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_equipment',
        },
        {
          label: 'Environmental risks and access',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_environment_access',
        },
        {
          label: 'Eating and drinking support',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_eating_drinking',
        },
        {
          label: 'Nutrition status and concerns',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_nutrition',
        },
        {
          label: 'Medication support level',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_medication_support',
        },
        {
          label: 'Active medications summary',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_active_medications',
        },
        {
          label: 'Capacity and consent summary',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_capacity_consent',
        },
        {
          label: 'Cognitive and emotional summary',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_cognitive_emotional',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Outcomes',
      fields: [
        {
          label: 'Care plan still meeting needs',
          fieldType: T.YES_NO,
          fieldKey: 'care_plan_review_meeting_needs',
          required: true,
        },
        {
          label: 'Changes required',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_changes_required',
        },
        {
          label: 'Actions and responsible person',
          fieldType: T.TEXTAREA,
          fieldKey: 'care_plan_review_actions',
        },
        {
          label: 'Next review date',
          fieldType: T.DATE,
          fieldKey: 'care_plan_review_next_review_date',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Review form fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and any
 * saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching. These labels are also the keys the existing
 * compose engine matches on, so they must not drift.
 */
export const CARE_PLAN_REVIEW_FORM_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'review date': 'care_plan_review_review_date',
  'review type': 'care_plan_review_review_type',
  'reviewer name and role': 'care_plan_review_reviewer',
  'care plan still meeting needs': 'care_plan_review_meeting_needs',
  'changes required': 'care_plan_review_changes_required',
  'actions and responsible person': 'care_plan_review_actions',
  'next review date': 'care_plan_review_next_review_date',
};
