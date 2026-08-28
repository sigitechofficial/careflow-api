import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Advance Care Plan template — the local Advance plan merged with the Care 2020
 * Advance Care Plan questions.
 *
 * The seven pre-existing local fields are retained exactly (label, type, options) and
 * gain stable `acp_` keys so the schema applier can match them by key and preserve their
 * UUIDs. Until this change the form had no keys and was aligned by the destructive
 * generic applier, which hard-deleted sections on every seed and orphaned saved values
 * keyed `sectionId:fieldId`.
 *
 * Home Care Plan and Home Support Plan are separate products and are not referenced here.
 */
export const ADVANCE_CARE_PLAN_NAME = 'Advance';

/** Retained local option list for treatment escalation. */
export const ACP_TREATMENT_ESCALATION_OPTIONS = [
  'Full treatment',
  'Limited intervention',
  'Comfort care only',
  'Not yet discussed',
];

export const ADVANCE_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Record advance care planning discussions, the person’s needs, goals and the support required to achieve them, treatment preferences, and any advance decision to refuse treatment including DNACPR. Update when the service user’s wishes change.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Planning discussion',
      description: 'When and with whom advance care planning took place.',
      fields: [
        {
          label: 'Date of discussion',
          fieldType: T.DATE,
          fieldKey: 'acp_discussion_date',
          required: true,
        },
        {
          label: 'People present',
          fieldType: T.TEXTAREA,
          fieldKey: 'acp_people_present',
          placeholder: 'Service user, family, professionals…',
        },
        {
          label: 'Capacity to participate',
          fieldType: T.YES_NO,
          fieldKey: 'acp_capacity_to_participate',
          required: true,
        },
      ],
    },
    {
      // Care 2020 — needs, goals and the support required to achieve them.
      title: 'Needs, goals and support',
      description:
        'What the person needs from advance care planning, what they want it to achieve, and how staff will support that.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'acp_service_user_needs',
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'acp_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'acp_support_required',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Preferences and decisions',
      fields: [
        {
          label: 'Treatment escalation preferences',
          fieldType: T.SELECT,
          fieldKey: 'acp_treatment_escalation',
          options: ACP_TREATMENT_ESCALATION_OPTIONS,
        },
        {
          label: 'DNACPR in place',
          fieldType: T.YES_NO,
          fieldKey: 'acp_dnacpr_in_place',
          required: true,
          helpText:
            'The authoritative DNACPR record is the service user’s legal documents record. Keep this flag consistent with it.',
        },
        {
          // Care 2020 — narrative detail. Distinct from the boolean flag above.
          label: 'Details of Advance Decision To Refuse Treatment (including DNACPR)',
          fieldType: T.TEXTAREA,
          fieldKey: 'acp_adrt_details',
          helpText:
            'Record what has been decided, where the documentation is held, and any limits the person has set.',
        },
        {
          label: 'Preferred place of care if deteriorating',
          fieldType: T.TEXT,
          fieldKey: 'acp_preferred_place_of_care',
        },
        {
          label: 'Summary of expressed wishes',
          fieldType: T.TEXTAREA,
          fieldKey: 'acp_summary_of_wishes',
          required: true,
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Advance fields carried no `fieldKey`.
 * Mapping label → key lets the schema applier adopt the existing rows, preserving their
 * UUIDs and any saved `sectionId:fieldId` values, instead of creating duplicates.
 */
export const ADVANCE_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'date of discussion': 'acp_discussion_date',
  'people present': 'acp_people_present',
  'capacity to participate': 'acp_capacity_to_participate',
  'treatment escalation preferences': 'acp_treatment_escalation',
  'dnacpr in place': 'acp_dnacpr_in_place',
  'preferred place of care if deteriorating': 'acp_preferred_place_of_care',
  'summary of expressed wishes': 'acp_summary_of_wishes',
};
