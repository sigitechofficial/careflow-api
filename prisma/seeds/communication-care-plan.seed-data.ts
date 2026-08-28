import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Communication Care Plan template — the local plan merged with the Care 2020 generic
 * needs / goals / support / risk block.
 *
 * The seven pre-existing local fields are retained exactly (label, type, required) and gain
 * stable `communication_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed — it would orphan
 * the real saved `sectionId:fieldId` values this form holds.
 *
 * Communication already has a mature AUTO-PREFILL compose engine
 * (`composeCommunicationCarePlan` + `COMMUNICATION_CARE_PLAN_FIELD_MAPPINGS` in
 * `remaining-area-care-plans.compose.ts`) that matches the seven existing fields by label and
 * draws on the Initial Assessment plus the IA communication snapshot. That engine is
 * deliberately left untouched; adding keys does not affect it (labels are preserved). Care
 * 2020 contributes only the generic needs / goals / support / risk block (all MANUAL — the IA
 * holds no communication-specific needs/goals/support narrative). Following the project-wide
 * rule, the block carries EXACTLY ONE "Person-centred details" field
 * (communication_needs_person_centred) and it is REQUIRED.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const COMMUNICATION_CARE_PLAN_NAME = 'Communication';

export const COMMUNICATION_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'How the service user communicates, any sensory impairment, preferred language, and how staff should adapt their approach, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Communication needs',
      fields: [
        {
          label: 'Preferred language',
          fieldType: T.TEXT,
          fieldKey: 'communication_preferred_language',
        },
        {
          label: 'Hearing impairment',
          fieldType: T.YES_NO,
          fieldKey: 'communication_hearing_impairment',
        },
        {
          label: 'Vision impairment',
          fieldType: T.YES_NO,
          fieldKey: 'communication_vision_impairment',
        },
        {
          label: 'Primary communication method',
          fieldType: T.SELECT,
          options: ['Verbal', 'Written', 'Gestures', 'AAC device', 'Combination'],
          fieldKey: 'communication_primary_method',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Guidance for staff',
      fields: [
        {
          label: 'How to approach conversations',
          fieldType: T.TEXTAREA,
          fieldKey: 'communication_approach',
          required: true,
        },
        {
          label: 'Uses glasses/hearing aids',
          fieldType: T.TEXT,
          fieldKey: 'communication_glasses_hearing_aids',
        },
        {
          label: 'Consent to share information with family',
          fieldType: T.YES_NO,
          fieldKey: 'communication_consent_share',
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      // Exactly ONE "Person-centred details" field (communication_needs_person_centred),
      // which is REQUIRED, matching the project-wide Care 2020 block.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'communication_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'communication_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'communication_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'communication_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'communication_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Communication fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and any
 * saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching. These labels are also the keys the existing
 * AUTO-PREFILL engine matches on, so they must not drift.
 */
export const COMMUNICATION_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'preferred language': 'communication_preferred_language',
  'hearing impairment': 'communication_hearing_impairment',
  'vision impairment': 'communication_vision_impairment',
  'primary communication method': 'communication_primary_method',
  'how to approach conversations': 'communication_approach',
  'uses glasses/hearing aids': 'communication_glasses_hearing_aids',
  'consent to share information with family': 'communication_consent_share',
};
