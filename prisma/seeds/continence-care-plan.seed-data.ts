import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Continence Care Plan template — the local plan merged with the Care 2020 generic
 * needs / goals / support / risk block.
 *
 * The six pre-existing local fields are retained exactly (label, type, required, SELECT
 * options and their order) and gain stable `continence_` keys so the ID-safe schema applier
 * can match them by key and preserve their UUIDs. Before this change the form had no keys and
 * was aligned by the destructive generic applier, which hard-deletes sections on every seed —
 * it would orphan the real saved `sectionId:fieldId` values this form holds.
 *
 * Continence already has a mature AUTO-PREFILL compose engine
 * (`composeContinenceCarePlan` + `CONTINENCE_CARE_PLAN_FIELD_MAPPINGS` in
 * `remaining-area-care-plans.compose.ts`) that matches the six existing fields by label and
 * draws on the Initial Assessment answers, ADL metadata and the IA continence snapshot. That
 * engine is deliberately left untouched; adding keys does not affect it (labels are
 * preserved). Care 2020 contributes only the generic needs / goals / support / risk block
 * (all MANUAL — the IA holds no continence-specific needs/goals/support narrative). Following
 * the project-wide rule, the block carries EXACTLY ONE "Person-centred details" field
 * (continence_needs_person_centred) and it is REQUIRED.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const CONTINENCE_CARE_PLAN_NAME = 'Continence';

export const CONTINENCE_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Continence profile including bladder and bowel function, products in use, prompting schedule, and skin care linked to continence, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Continence status',
      fields: [
        {
          label: 'Bladder continence',
          fieldType: T.SELECT,
          options: ['Continent', 'Occasional leakage', 'Incontinent – managed', 'Catheter'],
          fieldKey: 'continence_bladder',
        },
        {
          label: 'Bowel continence',
          fieldType: T.SELECT,
          options: ['Continent', 'Occasional accident', 'Incontinent – managed', 'Stoma'],
          fieldKey: 'continence_bowel',
        },
        {
          label: 'Products used (pads, commode, etc.)',
          fieldType: T.TEXTAREA,
          fieldKey: 'continence_products_used',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Care instructions',
      fields: [
        {
          label: 'Toileting/prompting routine',
          fieldType: T.TEXTAREA,
          fieldKey: 'continence_toileting_routine',
          required: true,
        },
        {
          label: 'Fluid intake guidance',
          fieldType: T.TEXT,
          fieldKey: 'continence_fluid_intake',
        },
        {
          label: 'Skin care after episodes',
          fieldType: T.TEXTAREA,
          fieldKey: 'continence_skin_care',
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      // Exactly ONE "Person-centred details" field (continence_needs_person_centred), which is
      // REQUIRED, matching the project-wide Care 2020 block. The Care 2020 source shows a
      // duplicate PCD for goals/support; those duplicates are intentionally NOT modelled.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'continence_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'continence_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'continence_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'continence_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'continence_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Continence fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and any
 * saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching. These labels are also the keys the existing
 * AUTO-PREFILL engine matches on, so they must not drift.
 */
export const CONTINENCE_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'bladder continence': 'continence_bladder',
  'bowel continence': 'continence_bowel',
  'products used (pads, commode, etc.)': 'continence_products_used',
  'toileting/prompting routine': 'continence_toileting_routine',
  'fluid intake guidance': 'continence_fluid_intake',
  'skin care after episodes': 'continence_skin_care',
};
