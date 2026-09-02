import { CarePathwayFormFieldType } from '@prisma/client';
import { HOME_SUPPORT_PLAN_SEED } from './home-support-plan.seed-data';
import { HOME_CARE_PLAN_SEED } from './home-care-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from './advance-care-plan.seed-data';
import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from './cognition-behaviour-care-plan.seed-data';
import { CULTURE_RELIGION_CARE_PLAN_SEED } from './culture-religion-care-plan.seed-data';
import { FALLS_CARE_PLAN_SEED } from './falls-care-plan.seed-data';
import { FINAL_DAYS_CARE_PLAN_SEED } from './final-days-care-plan.seed-data';
import { INFECTION_CARE_PLAN_SEED } from './infection-care-plan.seed-data';
import { MEDICATION_CARE_PLAN_SEED } from './medication-care-plan.seed-data';
import { MOBILITY_CARE_PLAN_SEED } from './mobility-care-plan.seed-data';
import { PAIN_MANAGEMENT_CARE_PLAN_SEED } from './pain-management-care-plan.seed-data';
import { SKIN_INTEGRITY_CARE_PLAN_SEED } from './skin-integrity-care-plan.seed-data';
import { PSYCHOLOGICAL_CARE_PLAN_SEED } from './psychological-care-plan.seed-data';
import { COMMUNICATION_CARE_PLAN_SEED } from './communication-care-plan.seed-data';
import { CONTINENCE_CARE_PLAN_SEED } from './continence-care-plan.seed-data';
import { EATING_AND_DRINKING_CARE_PLAN_SEED } from './eating-and-drinking-care-plan.seed-data';
import { PHYSICAL_HEALTH_CARE_PLAN_SEED } from './physical-health-care-plan.seed-data';
import { PERSONAL_SAFETY_CARE_PLAN_SEED } from './personal-safety-care-plan.seed-data';
import { CARE_PLAN_REVIEW_FORM_SEED } from './care-plan-review-form.seed-data';
import { DEMENTIA_CARE_PLAN_SEED } from './dementia-care-plan.seed-data';
import { HOME_CARE_NEEDS_GOALS_SUPPORT_SEED } from './home-care-needs-goals-support.seed-data';
import { PERSON_CENTRED_CARE_PLAN_SEED } from './person-centred-care-plan.seed-data';
import { PRESSURE_ULCER_CARE_PLAN_SEED } from './pressure-ulcer-care-plan.seed-data';
import { SLEEPING_NIGHT_CARE_PLAN_SEED } from './sleeping-night-care-plan.seed-data';
import { WASHING_DRESSING_CARE_PLAN_SEED } from './washing-dressing-care-plan.seed-data';

/** Seed-time visibility rule. Resolved to UUID `showWhen` after fields exist. */
export type CarePlanFieldShowWhenSeed = {
  fieldKey: string;
  operator: 'is_true';
};

export type CarePlanFieldSeed = {
  label: string;
  fieldType: CarePathwayFormFieldType;
  /** Stable business key (e.g. hsp_personal_care_tasks). Required for Home Support Plan fields. */
  fieldKey?: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  /**
   * Seed-time conditional visibility. Persisted as `conditionalLogicJson` once
   * the referenced fieldKey can be resolved to sectionId/fieldId UUIDs.
   */
  showWhen?: CarePlanFieldShowWhenSeed;
};

export type CarePlanSectionSeed = {
  title: string;
  description?: string;
  fields: CarePlanFieldSeed[];
};

export type CarePlanFormSeed = {
  description: string;
  sections: CarePlanSectionSeed[];
};

/** Full care plan templates: description shown above fields; sections/fields match clinical areas. */
export const CARE_PLAN_FORM_SEEDS: Record<string, CarePlanFormSeed> = {
  Advance: ADVANCE_CARE_PLAN_SEED,
  'Care Plan review form': CARE_PLAN_REVIEW_FORM_SEED,
  'Cognition and Behaviour': COGNITION_BEHAVIOUR_CARE_PLAN_SEED,
  Communication: COMMUNICATION_CARE_PLAN_SEED,
  Continence: CONTINENCE_CARE_PLAN_SEED,
  'Culture/Religion/Spirituality': CULTURE_RELIGION_CARE_PLAN_SEED,
  'Dementia Care plan': DEMENTIA_CARE_PLAN_SEED,
  'Eating and Drinking': EATING_AND_DRINKING_CARE_PLAN_SEED,
  Falls: FALLS_CARE_PLAN_SEED,
  'Final Days': FINAL_DAYS_CARE_PLAN_SEED,
  'Home Care Plan': HOME_CARE_PLAN_SEED,
  'Home Care Plan - needs/goals/support': HOME_CARE_NEEDS_GOALS_SUPPORT_SEED,
  'Home Support Plan': HOME_SUPPORT_PLAN_SEED,
  Infection: INFECTION_CARE_PLAN_SEED,
  Medication: MEDICATION_CARE_PLAN_SEED,
  Mobility: MOBILITY_CARE_PLAN_SEED,
  'Pain Management': PAIN_MANAGEMENT_CARE_PLAN_SEED,
  'Person Centred care plan': PERSON_CENTRED_CARE_PLAN_SEED,
  'Personal Safety': PERSONAL_SAFETY_CARE_PLAN_SEED,
  'Physical Health': PHYSICAL_HEALTH_CARE_PLAN_SEED,
  'Pressure Ulcer': PRESSURE_ULCER_CARE_PLAN_SEED,
  Psychological: PSYCHOLOGICAL_CARE_PLAN_SEED,
  'Risk Assessment': {
    description:
      'Summary of assessed risks for the service user and environment, with control measures and review dates.',
    sections: [
      {
        title: 'Risks identified',
        fields: [
          { label: 'Falls risk', fieldType: 'SELECT', options: ['Low', 'Medium', 'High'] },
          { label: 'Nutrition risk', fieldType: 'SELECT', options: ['Low', 'Medium', 'High'] },
          { label: 'Pressure ulcer risk', fieldType: 'SELECT', options: ['Low', 'Medium', 'High'] },
          { label: 'Other significant risks', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Controls',
        fields: [
          { label: 'Control measures in place', fieldType: 'TEXTAREA', required: true },
          { label: 'Residual risk accepted by', fieldType: 'TEXT' },
          { label: 'Next risk review date', fieldType: 'DATE' },
        ],
      },
    ],
  },
  'Risk Assessment and Care Plan': {
    description:
      'Combined risk assessment and care plan documenting hazards, mitigations, and how daily care addresses each risk area.',
    sections: [
      {
        title: 'Risk summary',
        fields: [
          { label: 'Assessment date', fieldType: 'DATE', required: true },
          { label: 'Overall risk level', fieldType: 'SELECT', options: ['Low', 'Medium', 'High'] },
          { label: 'Key risks and mitigations', fieldType: 'TEXTAREA', required: true },
        ],
      },
      {
        title: 'Linked care actions',
        fields: [
          { label: 'How care visits address risks', fieldType: 'TEXTAREA', required: true },
          { label: 'Equipment or adaptations', fieldType: 'TEXTAREA' },
          { label: 'Escalation pathway', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  'Skin Integrity': SKIN_INTEGRITY_CARE_PLAN_SEED,
  'Sleeping and Night': SLEEPING_NIGHT_CARE_PLAN_SEED,
  'Social Activities': {
    description:
      'Social interests, community links, activities to maintain wellbeing, and support needed to participate.',
    sections: [
      {
        title: 'Interests',
        fields: [
          { label: 'Hobbies and pastimes', fieldType: 'TEXTAREA', required: true },
          { label: 'Faith or community groups', fieldType: 'TEXTAREA' },
          { label: 'Preferred activities in service', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Participation',
        fields: [
          { label: 'Support needed to attend activities', fieldType: 'SELECT', options: ['None', 'Prompting', 'Escort', 'Declines'] },
          { label: 'Transport or access notes', fieldType: 'TEXT' },
          { label: 'Family or friends involved', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  Test: {
    description:
      'Test care plan template for training and system checks. Use only in non-production environments or for staff familiarisation.',
    sections: [
      {
        title: 'Test section',
        fields: [
          { label: 'Sample text field', fieldType: 'TEXT', placeholder: 'Enter sample text' },
          { label: 'Sample yes/no', fieldType: 'YES_NO' },
          { label: 'Sample notes', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  'Washing and dressing': WASHING_DRESSING_CARE_PLAN_SEED,
};
