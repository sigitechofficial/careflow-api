import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Infection Care Plan template — the local plan merged with the Care 2020 Infection
 * Care Plan questions.
 *
 * The six pre-existing local fields are retained exactly (label, type, options, required)
 * and gain stable `infection_` keys so the ID-safe schema applier can match them by key
 * and preserve their UUIDs. Before this change the form had no keys and was aligned by the
 * destructive generic applier, which hard-deletes sections on every seed and would orphan
 * any saved `sectionId:fieldId` values.
 *
 * Care 2020 contributes only the generic needs / goals / support / risk block. The audit
 * found no genuinely equivalent Infection-specific IA source for any field, so every field
 * is MANUAL and there is no Infection compose/suggestion engine — the mapping decisions are
 * recorded in `infection-care-plan-field-registry.ts` for documentation only.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const INFECTION_CARE_PLAN_NAME = 'Infection';

/** Retained local option list for the isolation/precautions SELECT. */
export const INFECTION_ISOLATION_OPTIONS = ['None', 'Standard', 'Contact', 'Droplet', 'Airborne'];

export const INFECTION_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Infection prevention and control measures, current or recent infections, isolation requirements, and monitoring signs, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Current status',
      fields: [
        {
          label: 'Active infection or colonisation',
          fieldType: T.YES_NO,
          fieldKey: 'infection_active_infection',
        },
        {
          label: 'Type and date identified',
          fieldType: T.TEXT,
          fieldKey: 'infection_type_and_date',
        },
        {
          label: 'Isolation or enhanced precautions',
          fieldType: T.SELECT,
          fieldKey: 'infection_isolation_precautions',
          options: INFECTION_ISOLATION_OPTIONS,
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Prevention',
      fields: [
        {
          label: 'PPE required for visits',
          fieldType: T.TEXT,
          fieldKey: 'infection_ppe_required',
        },
        {
          label: 'Hand hygiene and cleaning notes',
          fieldType: T.TEXTAREA,
          fieldKey: 'infection_hand_hygiene_cleaning',
          required: true,
        },
        {
          label: 'When to escalate to nurse/GP',
          fieldType: T.TEXTAREA,
          fieldKey: 'infection_when_to_escalate',
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
          fieldKey: 'infection_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'infection_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'infection_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'infection_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'infection_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Infection fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and
 * any saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the
 * exact seeded/live labels, lower-cased for matching.
 */
export const INFECTION_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'active infection or colonisation': 'infection_active_infection',
  'type and date identified': 'infection_type_and_date',
  'isolation or enhanced precautions': 'infection_isolation_precautions',
  'ppe required for visits': 'infection_ppe_required',
  'hand hygiene and cleaning notes': 'infection_hand_hygiene_cleaning',
  'when to escalate to nurse/gp': 'infection_when_to_escalate',
};
