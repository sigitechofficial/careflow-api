import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Pain Management Care Plan template — the local plan merged with the Care 2020
 * Pain Management questions.
 *
 * The six pre-existing local fields are retained exactly (label, type, required) and gain
 * stable `pain_management_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed and would orphan
 * any saved `sectionId:fieldId` values.
 *
 * Unlike Infection/Mobility, Pain Management has genuine IA §5.3 sources, so it gains a
 * dedicated SUGGESTION compose engine (`pain-management-care-plan.compose.ts`) that surfaces
 * four §5.3-backed suggestions for a clinician to review — values are never auto-filled.
 * The remaining fields are MANUAL; the decisions are recorded in the field registry.
 *
 * Care 2020 contributes eight fields (one new section, in screenshot order): a Numeric
 * Rating Scale toggle, the generic needs / goals / support block, and the area-risk gate.
 * Its repeated "Person-centred details" boxes are real input controls, so each becomes its
 * own field. Explanatory / policy / dependency text is NOT modelled.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const PAIN_MANAGEMENT_CARE_PLAN_NAME = 'Pain Management';

export const PAIN_MANAGEMENT_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'How pain is assessed and managed, including non-drug approaches, prescribed analgesia, and when to seek clinical review, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Pain profile',
      fields: [
        {
          label: 'Usual pain score (0–10)',
          fieldType: T.NUMBER,
          fieldKey: 'pain_management_usual_pain_score',
        },
        {
          label: 'Site and character of pain',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_site_and_character',
        },
        {
          label: 'What worsens or relieves pain',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_worsens_relieves',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Management',
      fields: [
        {
          label: 'Regular analgesia',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_regular_analgesia',
        },
        {
          label: 'Non-pharmacological methods',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_non_pharmacological',
          required: true,
        },
        {
          label: 'When to call GP or out of hours',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_when_to_call_gp',
        },
      ],
    },
    {
      // Care 2020 — eight fields kept together in screenshot order. All MANUAL.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a numeric rating scale or risk is associated with this area.',
      fields: [
        {
          label: 'Do you need to do a Numeric Rating Scale (for those able to verbalise their pain?)',
          fieldType: T.YES_NO,
          fieldKey: 'pain_management_nrs_needed',
        },
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'pain_management_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'pain_management_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Pain Management fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching (note the en dash in the pain-score label).
 */
export const PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'usual pain score (0–10)': 'pain_management_usual_pain_score',
  'site and character of pain': 'pain_management_site_and_character',
  'what worsens or relieves pain': 'pain_management_worsens_relieves',
  'regular analgesia': 'pain_management_regular_analgesia',
  'non-pharmacological methods': 'pain_management_non_pharmacological',
  'when to call gp or out of hours': 'pain_management_when_to_call_gp',
};
