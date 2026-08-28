import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Psychological Well-being Care Plan template — the local plan merged with the Care 2020
 * Psychological questions.
 *
 * The six pre-existing local fields are retained exactly (label, type, options, required)
 * and gain stable `psychological_` keys so the ID-safe schema applier can match them by key
 * and preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed and would orphan
 * the real saved `sectionId:fieldId` values this form holds.
 *
 * The audit found exactly one genuine, live IA source: "Involvement of CMHT or counsellor"
 * maps to IA §10.1 "CPN name and contact" (Community Psychiatric Nurse = the community
 * mental-health clinician). It is surfaced as a SUGGESTION (never auto-filled) by the
 * dedicated `psychological-care-plan.compose.ts` engine. Every other field is MANUAL — see
 * `psychological-care-plan-field-registry.ts` for the rejected candidates and reasons.
 *
 * Care 2020 contributes the generic needs / goals / support / risk block with EXACTLY ONE
 * "Person-centred details" field. All other care plans are separate products.
 */
export const PSYCHOLOGICAL_CARE_PLAN_NAME = 'Psychological';

/** Retained local option list for the "Current mood (typical)" SELECT. */
export const PSYCHOLOGICAL_MOOD_OPTIONS = ['Stable', 'Low', 'Anxious', 'Variable', 'Elevated'];

export const PSYCHOLOGICAL_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Emotional wellbeing and mental health: mood, anxiety, formal diagnosis, therapies, and how carers should respond, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Wellbeing',
      fields: [
        {
          label: 'Current mood (typical)',
          fieldType: T.SELECT,
          fieldKey: 'psychological_current_mood',
          options: PSYCHOLOGICAL_MOOD_OPTIONS,
        },
        {
          label: 'Mental health diagnosis',
          fieldType: T.TEXT,
          fieldKey: 'psychological_mh_diagnosis',
        },
        {
          label: 'Triggers for distress',
          fieldType: T.TEXTAREA,
          fieldKey: 'psychological_distress_triggers',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Support',
      fields: [
        {
          label: 'Coping strategies that help',
          fieldType: T.TEXTAREA,
          fieldKey: 'psychological_coping_strategies',
          required: true,
        },
        {
          label: 'Involvement of CMHT or counsellor',
          fieldType: T.TEXT,
          fieldKey: 'psychological_cmht_counsellor',
        },
        {
          label: 'When to contact crisis team / GP',
          fieldType: T.TEXTAREA,
          fieldKey: 'psychological_crisis_contact',
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. EXACTLY ONE
      // "Person-centred details" field. All MANUAL.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'psychological_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'psychological_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'psychological_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'psychological_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'psychological_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Psychological fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching.
 */
export const PSYCHOLOGICAL_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'current mood (typical)': 'psychological_current_mood',
  'mental health diagnosis': 'psychological_mh_diagnosis',
  'triggers for distress': 'psychological_distress_triggers',
  'coping strategies that help': 'psychological_coping_strategies',
  'involvement of cmht or counsellor': 'psychological_cmht_counsellor',
  'when to contact crisis team / gp': 'psychological_crisis_contact',
};
