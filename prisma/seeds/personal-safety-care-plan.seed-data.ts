import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Personal Safety Care Plan template — the local plan merged with the Care 2020 generic
 * needs / goals / support / risk block.
 *
 * The six pre-existing local fields are retained exactly (label, type, required, SELECT
 * options and their order) and gain stable `personal_safety_` keys so the ID-safe schema
 * applier can match them by key and preserve their UUIDs. Before this change the form had no
 * keys and was aligned by the destructive generic applier, which hard-deletes sections on
 * every seed — it already orphaned earlier saved `sectionId:fieldId` values (10 stale
 * references remain from prior reseeds); the ID-safe applier stops that recurring.
 *
 * Personal Safety already has a mature AUTO-PREFILL compose engine
 * (`composePersonalSafetyCarePlan` + `PERSONAL_SAFETY_CARE_PLAN_FIELD_MAPPINGS` in
 * `remaining-area-care-plans.compose.ts`) that matches the six existing fields by label and
 * draws on the Initial Assessment answers, the personal-safety snapshot and the emergency
 * contacts context. That engine is deliberately left untouched; adding keys does not affect it
 * (labels are preserved). Care 2020 contributes only the generic needs / goals / support /
 * risk block (all MANUAL — the IA holds no generic needs/goals/support narrative, and the
 * generic risk gate must NOT be driven from safeguarding/risk-assessment flags). Following the
 * project-wide rule, the block carries EXACTLY ONE "Person-centred details" field
 * (personal_safety_needs_person_centred) and it is REQUIRED.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const PERSONAL_SAFETY_CARE_PLAN_NAME = 'Personal Safety';

export const PERSONAL_SAFETY_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Safety in the home and community: hazards, safeguarding concerns, lone working notes, and emergency procedures, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Risk and environment',
      fields: [
        {
          label: 'Home hazards identified',
          fieldType: T.TEXTAREA,
          fieldKey: 'personal_safety_home_hazards',
        },
        {
          label: 'Smoking / fire safety',
          fieldType: T.TEXT,
          fieldKey: 'personal_safety_smoking_fire_safety',
        },
        {
          label: 'Lone worker risk level',
          fieldType: T.SELECT,
          options: ['Low', 'Medium', 'High'],
          fieldKey: 'personal_safety_lone_worker_risk',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Safeguarding',
      fields: [
        {
          label: 'Safeguarding concern on file',
          fieldType: T.YES_NO,
          fieldKey: 'personal_safety_safeguarding_concern',
        },
        {
          label: 'Actions in place',
          fieldType: T.TEXTAREA,
          fieldKey: 'personal_safety_actions_in_place',
        },
        {
          label: 'Emergency contacts',
          fieldType: T.TEXTAREA,
          fieldKey: 'personal_safety_emergency_contacts',
          required: true,
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      // Exactly ONE "Person-centred details" field (personal_safety_needs_person_centred),
      // which is REQUIRED, matching the project-wide Care 2020 block. The screenshot shows a
      // duplicate PCD for goals/support; those duplicates are intentionally NOT modelled.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'personal_safety_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'personal_safety_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'personal_safety_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'personal_safety_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'personal_safety_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Personal Safety fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and any
 * saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching. These labels are also the keys the existing
 * AUTO-PREFILL engine matches on, so they must not drift.
 */
export const PERSONAL_SAFETY_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'home hazards identified': 'personal_safety_home_hazards',
  'smoking / fire safety': 'personal_safety_smoking_fire_safety',
  'lone worker risk level': 'personal_safety_lone_worker_risk',
  'safeguarding concern on file': 'personal_safety_safeguarding_concern',
  'actions in place': 'personal_safety_actions_in_place',
  'emergency contacts': 'personal_safety_emergency_contacts',
};
