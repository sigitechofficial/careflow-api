import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/** Approved Home Support Plan template — 9 sections, 45 fields, hsp_* keys. */
export const HOME_SUPPORT_PLAN_NAME = 'Home Support Plan';

export const HOME_SUPPORT_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Plan for practical support at home: personal and domestic tasks, access and equipment, coordination with other services, and how carers will achieve agreed outcomes.',
  sections: [
    {
      title: 'Plan overview',
      fields: [
        { label: 'Date plan started', fieldType: T.DATE, fieldKey: 'hsp_plan_start_date', required: true },
        {
          label: 'Summary of home support needs',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_support_needs_summary',
          required: true,
        },
        { label: 'Planned hours / visits per week', fieldType: T.TEXT, fieldKey: 'hsp_planned_hours_visits' },
        {
          label: 'Review frequency',
          fieldType: T.SELECT,
          fieldKey: 'hsp_review_frequency',
          required: true,
          options: ['Monthly', 'Quarterly', 'Six-monthly', 'Annually'],
        },
        { label: 'Next review due date', fieldType: T.DATE, fieldKey: 'hsp_next_review_due_date' },
      ],
    },
    {
      title: 'Personal support',
      fields: [
        { label: 'Personal care tasks', fieldType: T.TEXTAREA, fieldKey: 'hsp_personal_care_tasks', required: true },
        {
          label: 'Personal care assistance level',
          fieldType: T.SELECT,
          fieldKey: 'hsp_personal_care_assistance_level',
          options: ['Independent', 'Supervision', 'Partial assistance', 'Full assistance'],
        },
        {
          label: 'Toileting & continence support',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_toileting_continence_support',
        },
        { label: 'Preferred personal care times', fieldType: T.TEXT, fieldKey: 'hsp_preferred_personal_care_times' },
        {
          label: 'Dignity & privacy preferences',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_dignity_privacy_preferences',
        },
      ],
    },
    {
      title: 'Nutrition & meals',
      fields: [
        { label: 'Meal preparation support', fieldType: T.TEXTAREA, fieldKey: 'hsp_meal_preparation_support' },
        {
          label: 'Eating & drinking assistance level',
          fieldType: T.SELECT,
          fieldKey: 'hsp_eating_drinking_assistance_level',
          options: ['Independent', 'Prompting', 'Supervision', 'Full assistance'],
        },
        {
          label: 'Dietary preferences & restrictions',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_dietary_preferences_restrictions',
        },
        { label: 'Fluid intake guidance', fieldType: T.TEXT, fieldKey: 'hsp_fluid_intake_guidance' },
      ],
    },
    {
      title: 'Domestic & household',
      fields: [
        { label: 'Cleaning tasks', fieldType: T.TEXTAREA, fieldKey: 'hsp_cleaning_tasks' },
        { label: 'Laundry tasks', fieldType: T.TEXTAREA, fieldKey: 'hsp_laundry_tasks' },
        { label: 'Other household tasks', fieldType: T.TEXTAREA, fieldKey: 'hsp_other_household_tasks' },
        {
          label: 'Domestic assistance level',
          fieldType: T.SELECT,
          fieldKey: 'hsp_domestic_assistance_level',
          options: ['None', 'Prompting', 'Partial', 'Full'],
        },
      ],
    },
    {
      title: 'Shopping & community',
      fields: [
        { label: 'Shopping & errands', fieldType: T.TEXTAREA, fieldKey: 'hsp_shopping_errands' },
        { label: 'Finance / bill support required', fieldType: T.YES_NO, fieldKey: 'hsp_finance_support_required' },
        { label: 'Finance support details', fieldType: T.TEXTAREA, fieldKey: 'hsp_finance_support_details' },
        { label: 'Social & community activities', fieldType: T.TEXTAREA, fieldKey: 'hsp_social_community_activities' },
        {
          label: 'Support to attend activities',
          fieldType: T.SELECT,
          fieldKey: 'hsp_support_to_attend_activities',
          options: ['None', 'Prompting', 'Escort', 'Declines'],
        },
      ],
    },
    {
      title: 'Home access & safety',
      fields: [
        {
          label: 'Home access instructions',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_home_access_instructions',
          required: true,
        },
        { label: 'Key safe in use', fieldType: T.YES_NO, fieldKey: 'hsp_key_safe_in_use' },
        { label: 'Key safe / entry code notes', fieldType: T.TEXT, fieldKey: 'hsp_key_safe_entry_notes' },
        { label: 'Telecare / pendant alarm in use', fieldType: T.YES_NO, fieldKey: 'hsp_telecare_pendant_in_use' },
        { label: 'Can answer front door independently', fieldType: T.YES_NO, fieldKey: 'hsp_can_answer_front_door' },
        { label: 'Lives alone', fieldType: T.YES_NO, fieldKey: 'hsp_lives_alone' },
        {
          label: 'Environmental hazards / home safety notes',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_environmental_hazards_notes',
        },
      ],
    },
    {
      title: 'Equipment & mobility aids',
      fields: [
        { label: 'Equipment & aids in the home', fieldType: T.TEXTAREA, fieldKey: 'hsp_equipment_aids_in_home' },
        { label: 'Mobility aids in use', fieldType: T.TEXTAREA, fieldKey: 'hsp_mobility_aids_in_use' },
        { label: 'Hoist / sling in use', fieldType: T.YES_NO, fieldKey: 'hsp_hoist_sling_in_use' },
        {
          label: 'Equipment maintenance / contact',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_equipment_maintenance_contact',
        },
      ],
    },
    {
      title: 'Coordination & informal support',
      fields: [
        { label: 'Informal carer involved', fieldType: T.YES_NO, fieldKey: 'hsp_informal_carer_involved' },
        { label: 'Informal carer name & contact', fieldType: T.TEXTAREA, fieldKey: 'hsp_informal_carer_contact' },
        { label: 'Other care agencies involved', fieldType: T.TEXTAREA, fieldKey: 'hsp_other_care_agencies' },
        { label: 'GP / pharmacy / other professionals', fieldType: T.TEXTAREA, fieldKey: 'hsp_gp_pharmacy_professionals' },
        { label: 'No-response procedure', fieldType: T.TEXTAREA, fieldKey: 'hsp_no_response_procedure' },
      ],
    },
    {
      title: 'Goals & escalation',
      fields: [
        { label: 'Goal 1 – what we will achieve', fieldType: T.TEXTAREA, fieldKey: 'hsp_goal_1', required: true },
        {
          label: 'How carers will support this',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_goal_1_carer_support',
          required: true,
        },
        { label: 'Goal 2 (optional)', fieldType: T.TEXTAREA, fieldKey: 'hsp_goal_2' },
        {
          label: 'Risks if support not provided',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_risks_if_support_not_provided',
        },
        {
          label: 'When to escalate (office / GP / 999)',
          fieldType: T.TEXTAREA,
          fieldKey: 'hsp_escalation_instructions',
          required: true,
        },
        { label: 'Progress notes', fieldType: T.TEXTAREA, fieldKey: 'hsp_progress_notes' },
      ],
    },
  ],
};
