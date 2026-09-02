import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { areaRiskFollowUpFields } from './area-risk-follow-up.seed';

/**
 * Skin Integrity Care Plan template — the local plan merged with the Care 2020 Skin
 * Integrity questions.
 *
 * The five pre-existing local fields are retained exactly (label, type, required) and gain
 * stable `skin_integrity_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed — it would orphan
 * the real saved `sectionId:fieldId` values this form holds.
 *
 * Skin Integrity already has a mature AUTO-PREFILL compose engine
 * (`composeSkinIntegrityCarePlan` + `SKIN_INTEGRITY_CARE_PLAN_FIELD_MAPPINGS` in
 * `area-care-plans.compose.ts`) that matches fields by label and draws on IA §11.1 and the
 * skin-integrity snapshot. That engine is deliberately left untouched; adding keys does not
 * affect it (labels are preserved). Care 2020 contributes only the generic needs / goals /
 * support / risk block (all MANUAL — the IA holds no skin-specific needs/goals/support). Its
 * repeated "Person-centred details" boxes are real input controls, so each becomes its own
 * field. Explanatory / policy / dependency text is NOT modelled.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const SKIN_INTEGRITY_CARE_PLAN_NAME = 'Skin Integrity';

export const SKIN_INTEGRITY_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Routine skin care: dryness, rashes, emollients, wound clinics, and reporting changes to nursing staff, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Skin profile',
      fields: [
        {
          label: 'Skin type / common issues',
          fieldType: T.TEXTAREA,
          fieldKey: 'skin_integrity_skin_type_issues',
        },
        {
          label: 'Emollients or creams prescribed',
          fieldType: T.TEXTAREA,
          fieldKey: 'skin_integrity_emollients_creams',
        },
        {
          label: 'Previous pressure damage',
          fieldType: T.YES_NO,
          fieldKey: 'skin_integrity_previous_pressure_damage',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Daily care',
      fields: [
        {
          // Note the en dash "–" — matched exactly by the legacy label adoption map and by
          // the existing engine's label mapping.
          label: 'Application of creams – when and where',
          fieldType: T.TEXTAREA,
          fieldKey: 'skin_integrity_cream_application',
          required: true,
        },
        {
          label: 'Signs to report immediately',
          fieldType: T.TEXTAREA,
          fieldKey: 'skin_integrity_signs_to_report',
          required: true,
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      // Corrected 2026-08-28: this section had three duplicate "Person-centred details"
      // fields; the two extras (skin_integrity_goals_person_centred /
      // skin_integrity_support_person_centred) are removed here so the applier deactivates
      // them. Exactly ONE "Person-centred details" field remains
      // (skin_integrity_needs_person_centred), matching the required Care 2020 block.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'skin_integrity_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'skin_integrity_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'skin_integrity_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'skin_integrity_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'skin_integrity_area_risk',
        },
        ...areaRiskFollowUpFields('skin_integrity'),
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Skin Integrity fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching (note the en dash in the cream-application field).
 */
export const SKIN_INTEGRITY_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'skin type / common issues': 'skin_integrity_skin_type_issues',
  'emollients or creams prescribed': 'skin_integrity_emollients_creams',
  'previous pressure damage': 'skin_integrity_previous_pressure_damage',
  'application of creams – when and where': 'skin_integrity_cream_application',
  'signs to report immediately': 'skin_integrity_signs_to_report',
};
