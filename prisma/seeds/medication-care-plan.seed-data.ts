import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Medication Care Plan template — the local plan merged with the Care 2020 Medication
 * Care Plan questions.
 *
 * The six pre-existing local fields are retained exactly (label, type, options, required)
 * and gain stable `medication_` keys so the ID-safe schema applier can match them by key
 * and preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed — it has already
 * orphaned six saved `sectionId:fieldId` values.
 *
 * Medication already has a mature AUTO-PREFILL compose engine
 * (`medication-care-plan.compose.ts` + `MEDICATION_CARE_PLAN_FIELD_MAPPINGS`) that matches
 * fields by section label + label and is deliberately left untouched; adding keys does not
 * affect it. Care 2020 contributes only the generic needs / goals / support / risk block
 * (all MANUAL); its repeated "Person-centred details" boxes are real input controls, so
 * each becomes its own field. Explanatory / policy / dependency text is NOT modelled.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const MEDICATION_CARE_PLAN_NAME = 'Medication';

/**
 * Option list for the medication-support-level SELECT.
 *
 * The original four options are retained (saved answers such as 'Nurse only' must stay
 * valid). 'Assisted by carer' and 'Provided by others (family / nurse)' were added so every
 * IA §9.2 level maps 1:1 without overstating what carers do — see
 * `mapMedicationSupportLevelToCarePlan`. Existing databases are patched by
 * `prisma/scripts/patch-medication-support-level-options.ts` (and by the seed applier).
 */
export const MEDICATION_SUPPORT_LEVEL_OPTIONS = [
  'Self-administers',
  'Prompted',
  'Assisted by carer',
  'Administered by carer',
  'Provided by others (family / nurse)',
  'Nurse only',
];

export const MEDICATION_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Medication support plan: what medicines are taken, who administers them, adherence issues, and allergy or interaction alerts, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Medication overview',
      fields: [
        {
          label: 'Medication support level',
          fieldType: T.SELECT,
          fieldKey: 'medication_support_level',
          options: MEDICATION_SUPPORT_LEVEL_OPTIONS,
        },
        {
          label: 'Known allergies',
          fieldType: T.TEXTAREA,
          fieldKey: 'medication_known_allergies',
          required: true,
        },
        {
          label: 'PRN medicines and when used',
          fieldType: T.TEXTAREA,
          fieldKey: 'medication_prn_medicines',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Instructions',
      fields: [
        {
          label: 'Storage and blister packs',
          fieldType: T.TEXT,
          fieldKey: 'medication_storage_blister_packs',
        },
        {
          // Note the en dash "–" — matched exactly by the legacy label adoption map.
          label: 'Refusal or missed dose – action',
          fieldType: T.TEXTAREA,
          fieldKey: 'medication_refusal_missed_dose',
          required: true,
        },
        {
          label: 'Pharmacy and GP contact',
          fieldType: T.TEXT,
          fieldKey: 'medication_pharmacy_gp_contact',
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'medication_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'medication_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'medication_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'medication_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'medication_area_risk',
        },
        ...areaRiskFollowUpFields('medication'),
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Medication fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the
 * exact seeded/live labels, lower-cased for matching (note the en dash in the refusal field).
 */
export const MEDICATION_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'medication support level': 'medication_support_level',
  'known allergies': 'medication_known_allergies',
  'prn medicines and when used': 'medication_prn_medicines',
  'storage and blister packs': 'medication_storage_blister_packs',
  'refusal or missed dose – action': 'medication_refusal_missed_dose',
  'pharmacy and gp contact': 'medication_pharmacy_gp_contact',
};
