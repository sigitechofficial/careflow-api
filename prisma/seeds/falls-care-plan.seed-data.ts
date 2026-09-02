import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Falls Care Plan template — the local plan merged with the Care 2020 Falls Care Plan
 * questions.
 *
 * The seven pre-existing local fields are retained exactly (label, type, placeholder,
 * required) and gain stable `falls_` keys so the ID-safe schema applier can match them by
 * key and preserve their UUIDs. Before this change the form had no keys and was aligned by
 * the destructive generic applier, which hard-deletes sections on every seed — it has
 * already orphaned at least one instance's saved `sectionId:fieldId` values.
 *
 * The existing Falls IA-suggestion engine (`falls-care-plan.suggestions.ts`) matches these
 * fields by section title + label + type and is deliberately left untouched; adding keys
 * does not affect it. Care 2020 contributes only the generic needs / goals / support /
 * risk block — its repeated "Person-centred details" boxes are real input controls, so
 * each becomes its own field; the explanatory / policy / dependency text is NOT modelled.
 *
 * All other care plans (Home Care, Home Support, Advance, Cognition & Behaviour,
 * Culture/Religion/Spirituality, Dementia) are separate products and are not referenced.
 */
export const FALLS_CARE_PLAN_NAME = 'Falls';

export const FALLS_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Falls risk assessment summary, history of falls, mobility aids, environmental hazards, and actions to reduce risk, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Falls history',
      fields: [
        {
          label: 'Falls in last 12 months',
          fieldType: T.NUMBER,
          fieldKey: 'falls_falls_last_12_months',
          placeholder: '0',
        },
        {
          label: 'Last fall date and circumstances',
          fieldType: T.TEXTAREA,
          fieldKey: 'falls_last_fall_details',
        },
        {
          label: 'Injury from previous falls',
          fieldType: T.YES_NO,
          fieldKey: 'falls_injury_from_previous',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Prevention plan',
      fields: [
        {
          label: 'Mobility aids in use',
          fieldType: T.TEXT,
          fieldKey: 'falls_mobility_aids',
        },
        {
          label: 'Environmental hazards identified',
          fieldType: T.TEXTAREA,
          fieldKey: 'falls_environmental_hazards',
        },
        {
          label: 'Transfers – instructions',
          fieldType: T.TEXTAREA,
          fieldKey: 'falls_transfers_instructions',
          required: true,
        },
        {
          label: 'Referral to physiotherapy',
          fieldType: T.YES_NO,
          fieldKey: 'falls_referral_physiotherapy',
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'falls_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'falls_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'falls_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'falls_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'falls_area_risk',
        },
        ...areaRiskFollowUpFields('falls'),
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Falls fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the
 * exact seeded/live labels, lower-cased for matching.
 */
export const FALLS_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'falls in last 12 months': 'falls_falls_last_12_months',
  'last fall date and circumstances': 'falls_last_fall_details',
  'injury from previous falls': 'falls_injury_from_previous',
  'mobility aids in use': 'falls_mobility_aids',
  'environmental hazards identified': 'falls_environmental_hazards',
  'transfers – instructions': 'falls_transfers_instructions',
  'referral to physiotherapy': 'falls_referral_physiotherapy',
};
