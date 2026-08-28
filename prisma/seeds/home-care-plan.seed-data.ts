import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Home Care Plan template — the local Home Care Plan expanded to carry the client's
 * Care 2020 Home Care Plan questions.
 *
 * Wording follows the Care 2020 source. Field keys are prefixed `hcp_` and are the
 * stable anchor: labels, options and ordering may change, keys must not, because the
 * schema applier matches on them to preserve field UUIDs (and therefore any values
 * already saved under `sectionId:fieldId`).
 *
 * Home Support Plan is a separate product and is not referenced here.
 */
export const HOME_CARE_PLAN_NAME = 'Home Care Plan';

// ---------------------------------------------------------------------------
// Options that Initial Assessment can evidence are declared as named constants and
// reused both in the option list below and in the IA-derivable allowlists in
// `home-care-plan-field-mappings.ts`. Sharing the constant makes it impossible for a
// resolver to suggest a string the field does not actually offer.
// ---------------------------------------------------------------------------

export const HCP_DIETARY_OPTION_PUREED_FOOD = 'Pureed food';
export const HCP_DIETARY_OPTION_THICKENED_FLUIDS = 'Thickened fluids';
export const HCP_CONTINENCE_OPTION_PAD_CHANGING = 'Pad Changing';
export const HCP_CONTINENCE_OPTION_CATHETER_CARE = 'Catheter care';
export const HCP_MEAL_OPTION_NUTRITIONAL_SUPPLEMENTS = 'Nutritional supplements';
export const HCP_MOBILITY_AIDS_OPTION_HOISTING = 'Hoisting';
export const HCP_MOBILITY_AIDS_OPTION_TRANSFER = 'Transfer';

/** Care 2020 — desired goals and outcomes. */
export const HCP_DESIRED_GOALS_OPTIONS = [
  'Promote Independence',
  'Prevent hospitalisation',
  'All needs to be met',
  'Maintaining good morale',
  'Maintaining privacy and dignity',
  'Promote safety',
  'Ensure environment safety/cleanliness',
  'Promote cleanliness',
  'Reduce risk of infection & contaminates',
  'Promote well-balanced nutrition',
  'Promote eating',
  'Promote hydration',
];

/**
 * Care 2020 — cognitive impairment. These describe cause, not severity.
 * IA records a severity band (none / mild / moderate / severe) which is a different
 * concept and is never mapped into these options.
 */
export const HCP_COGNITIVE_IMPAIRMENT_OPTIONS = [
  'No Signs',
  'Early Signs',
  'Dementia',
  'Learning Disability',
  'Stroke / TIA',
  'Brain Injury',
  'Confusion',
  'Substance Misuse',
  'Mental Illness',
  'Prone to Infections which affect cognition',
  'Other',
];

/** Care 2020 — personal care tasks. */
export const HCP_PERSONAL_NEEDS_OPTIONS = [
  'Strip Wash',
  'Bed Bath',
  'Shower',
  'Bath',
  'Dressing',
  'Toiletting',
  'Oral Care',
  'Denture Care',
  'Hair washing',
  'Personal Hygiene',
];

/** Care 2020 — continence tasks. */
export const HCP_CONTINENCE_NEEDS_OPTIONS = [
  HCP_CONTINENCE_OPTION_PAD_CHANGING,
  'Commode emptying / cleaning',
  'Leg / night bag emptying',
  'Leg / night bag changing',
  'Convene care',
  HCP_CONTINENCE_OPTION_CATHETER_CARE,
  'Bladder washout',
  'Wash with warm water areas of care / prevent skin breakdown',
];

/** Care 2020 — overall mobility level (mutually exclusive). */
export const HCP_MOBILITY_SUMMARY_OPTIONS = [
  'Fully Independent',
  'Requires some assistance',
  'Needs aids',
  'Due to Dementia uses furniture',
  'unlikely to remember to use aids/equipment',
  'Bed bound',
];

/** Care 2020 — what mobility aids are used for. */
export const HCP_MOBILITY_AIDS_OPTIONS = [
  'No',
  'Walking',
  HCP_MOBILITY_AIDS_OPTION_TRANSFER,
  'Standing',
  HCP_MOBILITY_AIDS_OPTION_HOISTING,
];

/** Care 2020 — meal support tasks. */
export const HCP_MEAL_REQUIREMENTS_OPTIONS = [
  'Preparation of food and drink',
  'Assistance with eating',
  'Assistance with drinking/hydration',
  'PEG Care',
  HCP_MEAL_OPTION_NUTRITIONAL_SUPPLEMENTS,
];

/**
 * Care 2020 — dietary needs.
 * "Food allergies" is offered for Care 2020 parity but is manual only: the governed
 * `ServiceUserAllergy` register is authoritative and must never be second-guessed by a
 * composed care plan value.
 */
export const HCP_DIETARY_NEEDS_OPTIONS = [
  'Vegetarian',
  'Vegan',
  HCP_DIETARY_OPTION_PUREED_FOOD,
  'Liquidised foods',
  HCP_DIETARY_OPTION_THICKENED_FLUIDS,
  'Diabetic Diet',
  'Religious dietary restrictions',
  'Food allergies',
];

/** Care 2020 — medication responsibility and ordering. Manual only. */
export const HCP_MEDICATION_SUMMARY_OPTIONS = [
  'Administer — care staff ensure medication is taken/record/monitor',
  'Client ensures medication is taken',
  'Assist — care staff set up dosage, client takes it, care staff record/monitor',
  'Prompt — care staff remind client to take/do medication, care staff monitor',
  'Self-administer — client fully independent, care staff report concerns only',
  'Family Orders medication',
  'Client Orders medication',
  'Pharmacy delivers',
  'Requires assistance to contact GP and order medication',
];

/** Care 2020 — household tasks. */
export const HCP_HOUSEHOLD_SUPPORT_OPTIONS = [
  'Washing Up',
  'Dishwasher',
  'Bed making',
  'Laundry',
  'Tumble dryer',
  'Hang laundry',
  'Fold Laundry away',
  'Ironing',
  'Open/close curtains',
  'Clean kitchen sides',
  'Mop floors',
  'Hoover',
  'Clean Bathroom',
  'Dusting',
  'Leave care areas clean and tidy',
];

/** Care 2020 — errands and wider support. */
export const HCP_OTHER_SUPPORT_OPTIONS = [
  'Shopping',
  'Collecting pension',
  'Collecting prescription',
];

export const HOME_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Overview care plan for a person receiving care at home: what matters to them, agreed goals and outcomes, the support required in each area of daily living, the consents given for that support, and how the package will be reviewed.',
  sections: [
    {
      title: 'Package overview',
      description: 'Why support is in place and how much is planned.',
      fields: [
        { label: 'Date plan started', fieldType: T.DATE, fieldKey: 'hcp_plan_start_date', required: true },
        {
          label: 'Summary of needs prompting care',
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_needs_summary',
          required: true,
        },
        { label: 'Hours and visits per week', fieldType: T.TEXT, fieldKey: 'hcp_hours_visits' },
      ],
    },
    {
      title: 'About Me',
      fields: [
        {
          label: 'About Me',
          fieldType: T.RICH_TEXT,
          fieldKey: 'hcp_about_me',
          helpText: 'Life history, routines, preferences, and how the person likes to be supported.',
        },
      ],
    },
    {
      title: 'Outcomes',
      description: 'The goals this package of care is intended to achieve.',
      fields: [
        {
          label: "What are the Client's Desired Goals and Outcomes?",
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_desired_goals_outcomes',
          options: HCP_DESIRED_GOALS_OPTIONS,
        },
        {
          label: 'Detailed Goals and Outcomes',
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_detailed_goals_outcomes',
          required: true,
          helpText: 'How these goals will be achieved in practice, and what success looks like.',
        },
        {
          label: 'Risks if care not provided',
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_risks_if_care_not_provided',
        },
        {
          label: 'Review frequency',
          fieldType: T.SELECT,
          fieldKey: 'hcp_review_frequency',
          options: ['Monthly', 'Quarterly', 'Six-monthly', 'Annually'],
        },
      ],
    },
    {
      title: 'Cognition',
      fields: [
        {
          label: 'Does the Client have Cognitive Impairment?',
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_cognitive_impairment',
          options: HCP_COGNITIVE_IMPAIRMENT_OPTIONS,
          helpText:
            'Record the cause where known. Initial Assessment records cognitive impairment as a severity band, which is a different measure, so this field is completed by the assessor.',
        },
      ],
    },
    {
      title: 'Personal Care',
      fields: [
        {
          label: "What are the Client's Personal Care Needs?",
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_personal_care_needs',
        },
        {
          label: 'Has the Client Consented to Personal Care Support?',
          fieldType: T.YES_NO,
          fieldKey: 'hcp_personal_care_consent',
        },
        {
          label: "Client's Personal Needs Summary",
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_personal_needs_summary',
          options: HCP_PERSONAL_NEEDS_OPTIONS,
        },
      ],
    },
    {
      title: 'Continence',
      fields: [
        {
          label: 'Does the Client have Continence Care Needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_continence_care_needs',
        },
        {
          label: 'Has the Client Consented to Continence Care Support?',
          fieldType: T.YES_NO,
          fieldKey: 'hcp_continence_consent',
        },
        {
          label: "Client's Continence Needs Summary",
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_continence_needs_summary',
          options: HCP_CONTINENCE_NEEDS_OPTIONS,
        },
      ],
    },
    {
      title: 'Mobility',
      fields: [
        {
          label: "What are the Client's Mobility Care Needs?",
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_mobility_care_needs',
        },
        {
          label: 'Has the Client Consented to Mobility Support?',
          fieldType: T.YES_NO,
          fieldKey: 'hcp_mobility_consent',
        },
        {
          label: "Client's Mobility Summary",
          fieldType: T.SELECT,
          fieldKey: 'hcp_mobility_summary',
          options: HCP_MOBILITY_SUMMARY_OPTIONS,
        },
        {
          label: "Client's use of Aids for Mobility Summary",
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_mobility_aids_summary',
          options: HCP_MOBILITY_AIDS_OPTIONS,
        },
      ],
    },
    {
      title: 'Meals and Nutrition',
      fields: [
        {
          label: "What are the Client's Meal Requirements?",
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_meal_requirements',
        },
        {
          label: 'Has the Client Consented to Meal Support?',
          fieldType: T.YES_NO,
          fieldKey: 'hcp_meal_consent',
        },
        {
          label: "Client's Meal Requirements Summary",
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_meal_requirements_summary',
          options: HCP_MEAL_REQUIREMENTS_OPTIONS,
        },
        {
          label: "Client's Dietary Needs Summary",
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_dietary_needs_summary',
          options: HCP_DIETARY_NEEDS_OPTIONS,
          helpText:
            'Tick Food allergies only after checking the allergy register — this option is never filled in automatically and the register remains the authoritative record.',
        },
      ],
    },
    {
      title: 'Medication',
      fields: [
        {
          label: "What are the Client's Medication Support Requirements?",
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_medication_support_needs',
        },
        {
          label: 'Has the Client Consented to Medication Support?',
          fieldType: T.YES_NO,
          fieldKey: 'hcp_medication_consent',
        },
        {
          label: "Client's Medication Summary",
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_medication_summary',
          options: HCP_MEDICATION_SUMMARY_OPTIONS,
          helpText:
            'The authoritative record of who administers medication is the medication support profile. Keep this summary consistent with it.',
        },
      ],
    },
    {
      title: 'Wider Support',
      fields: [
        {
          label: "What are the Client's Support Requirements?",
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_support_requirements',
        },
        {
          label: 'Household Support Summary',
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_household_support_summary',
          options: HCP_HOUSEHOLD_SUPPORT_OPTIONS,
        },
        {
          label: 'Other Support Needs Summary',
          fieldType: T.MULTI_SELECT,
          fieldKey: 'hcp_other_support_summary',
          options: HCP_OTHER_SUPPORT_OPTIONS,
        },
        {
          label: 'Other Support Requirements',
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_other_support_requirements',
        },
        {
          label: 'Has the Client Consented to this Support?',
          fieldType: T.YES_NO,
          fieldKey: 'hcp_support_consent',
        },
      ],
    },
    {
      title: 'Advance and End of Life',
      fields: [
        {
          label: 'Client Advance Support Requirements?',
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_advance_support_requirements',
        },
        {
          label: 'Has the Client Consented to Advance Support?',
          fieldType: T.YES_NO,
          fieldKey: 'hcp_advance_support_consent',
        },
        {
          label: 'Client Final Day Requirements?',
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_final_days_requirements',
        },
        {
          label: 'Has the Client Consented to the Final Days Plan?',
          fieldType: T.YES_NO,
          fieldKey: 'hcp_final_days_consent',
        },
      ],
    },
    {
      title: 'Risk Assessment',
      fields: [
        {
          label: 'Risk Assessment',
          fieldType: T.TEXTAREA,
          fieldKey: 'hcp_risk_assessment',
          helpText:
            'Summarise the risks relevant to this package and the controls in place. Kept separate from "Risks if care not provided", which records the consequences of withdrawing care.',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Home Care Plan fields carried no `fieldKey`.
 * Mapping label → key lets the schema applier adopt the existing rows (preserving their
 * UUIDs and any saved `sectionId:fieldId` values) instead of creating duplicates.
 */
export const HOME_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'date plan started': 'hcp_plan_start_date',
  'summary of needs prompting care': 'hcp_needs_summary',
  'hours and visits per week': 'hcp_hours_visits',
  'what success looks like for @': 'hcp_detailed_goals_outcomes',
  'risks if care not provided': 'hcp_risks_if_care_not_provided',
  'review frequency': 'hcp_review_frequency',
};
