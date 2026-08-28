import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Mobility Care Plan template — the local plan merged with the Care 2020 Mobility
 * Care Plan questions.
 *
 * The six pre-existing local fields are retained exactly (label, type, options, required)
 * and gain stable `mobility_` keys so the ID-safe schema applier can match them by key and
 * preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed and would orphan
 * any saved `sectionId:fieldId` values.
 *
 * The audit found no genuinely equivalent, defensible Mobility-specific IA or structured
 * source for any field, so every field is MANUAL and there is deliberately no Mobility
 * compose/suggestion engine — the mapping decisions are recorded in
 * `mobility-care-plan-field-registry.ts` for documentation only.
 *
 * Care 2020 contributes nine fields (kept together in one new section, in screenshot order):
 * a manual-handling-assessment toggle, the generic needs / goals / support block, an
 * emergency-procedure toggle, and the area-risk gate. Its repeated "Person-centred details"
 * boxes are real input controls, so each becomes its own field. Explanatory / policy /
 * dependency text is NOT modelled.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const MOBILITY_CARE_PLAN_NAME = 'Mobility';

/** Retained local option lists. */
export const MOBILITY_INDOOR_OPTIONS = ['Independent', 'Stick', 'Frame', 'Wheelchair', 'Bed bound'];
export const MOBILITY_OUTDOOR_OPTIONS = ['Independent', 'Assisted', 'Does not go out', 'Not assessed'];
export const MOBILITY_CARERS_OPTIONS = ['1', '2'];

export const MOBILITY_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Mobility and transfers plan including independence level, equipment, physiotherapy input, and safe handling for carers, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Mobility status',
      fields: [
        {
          label: 'Indoor mobility',
          fieldType: T.SELECT,
          fieldKey: 'mobility_indoor_mobility',
          options: MOBILITY_INDOOR_OPTIONS,
        },
        {
          label: 'Outdoor mobility',
          fieldType: T.SELECT,
          fieldKey: 'mobility_outdoor_mobility',
          options: MOBILITY_OUTDOOR_OPTIONS,
        },
        {
          label: 'Equipment issued',
          fieldType: T.TEXTAREA,
          fieldKey: 'mobility_equipment_issued',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Transfers',
      fields: [
        {
          label: 'Transfer method (bed/chair/toilet)',
          fieldType: T.TEXTAREA,
          fieldKey: 'mobility_transfer_method',
          required: true,
        },
        {
          label: 'Number of carers required',
          fieldType: T.SELECT,
          fieldKey: 'mobility_number_of_carers',
          options: MOBILITY_CARERS_OPTIONS,
        },
        {
          label: 'Physio / OT recommendations',
          fieldType: T.TEXTAREA,
          fieldKey: 'mobility_physio_ot_recommendations',
        },
      ],
    },
    {
      // Care 2020 — nine fields kept together in screenshot order. All MANUAL.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a manual handling assessment, emergency procedure or risk is associated with this area.',
      fields: [
        {
          label: 'Do you wish to do a manual handling assessment?',
          fieldType: T.YES_NO,
          fieldKey: 'mobility_manual_handling_assessment',
        },
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'mobility_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'mobility_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'mobility_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'mobility_support_required',
        },
        {
          label: 'Is there a procedure in case of an emergency?',
          fieldType: T.YES_NO,
          fieldKey: 'mobility_emergency_procedure',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'mobility_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Mobility fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the
 * exact seeded/live labels, lower-cased for matching.
 */
export const MOBILITY_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'indoor mobility': 'mobility_indoor_mobility',
  'outdoor mobility': 'mobility_outdoor_mobility',
  'equipment issued': 'mobility_equipment_issued',
  'transfer method (bed/chair/toilet)': 'mobility_transfer_method',
  'number of carers required': 'mobility_number_of_carers',
  'physio / ot recommendations': 'mobility_physio_ot_recommendations',
};
