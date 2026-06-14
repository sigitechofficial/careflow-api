import { CarePathwayFormFieldType } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

export const MEDICATION_HOME_CARE_ASSESSMENT_FORM_NAME =
  'Assessing For Medication in home care';

const YNNA = ['Yes', 'No', 'N/A'] as const;
const LEVEL_0 = ['LEVEL 0', 'NOT APPLICABLE'] as const;
const LEVEL_1 = ['LEVEL 1A', 'LEVEL 1B'] as const;
const LEVEL_2 = ['LEVEL 2A', 'LEVEL 2B'] as const;
const YES_NO = ['Yes', 'No'] as const;

/** Form Builder schema — migrated from legacy hardcoded medication-home-care-assessment-fields.ts */
export const MEDICATION_HOME_CARE_ASSESSMENT_SEED: CarePlanFormSeed = {
  description:
    "Assess the service user's ability to take medications safely, determine the level of support required (Level 0–2), and document GP/pharmacy details and CQC 6 R's medication support.",
  sections: [
    {
      title: 'Guidance',
      description:
        "It is important to assess a service user's ability to take their medications safely. Do they have capacity or lack capacity will help to determine the level of support — independent with all medication tasks (Level 0), required prompting and support with packaging (Level 1 or 1B), or required full support (Level 2 or 2B). Ask whether they know what each medicine is for, how to take it, what to do if a dose is missed, and how medication is stored. Document GP and pharmacy details, dispensing method, and the 6 R's of medication support promoted by CQC.",
      fields: [],
    },
    {
      title: 'Initial assessment',
      fields: [
        {
          label: '1 Services user ability or understanding',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
          helpText:
            'Client has capacity and can manage independently, or does not have capacity and needs full support, or has capacity but is unable to open packages.',
        },
        {
          label: '2 GP or pharmacy referral support',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
        },
        {
          label: 'Dispensing Methods for Medication Support',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
        },
      ],
    },
    {
      title: 'Medication support levels',
      description: 'Record the applicable level and supporting detail.',
      fields: [
        {
          label:
            'LEVEL 0: THE SERVICE USER RETAINS TOTAL RESPONSIBILITY FOR THE MANAGEMENT OF THEIR MEDICATION',
          fieldType: CarePathwayFormFieldType.SELECT,
          helpText:
            'Record on the support plan that the service user is Level 0. Document assistive technology or pharmacy support used.',
          options: [...LEVEL_0],
        },
        {
          label: 'LEVEL 0 INDEPENDENT WITH MEDICATION',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
          helpText:
            'Record assistive technology and pharmacy support methods used to facilitate independence.',
        },
        {
          label:
            'LEVEL 1: THE SERVICE USER RETAINS OVERALL RESPONSIBILITY FOR MAKING DECISIONS ABOUT THE MANAGEMENT OF THEIR MEDICATION, HOWEVER THEY REQUIRE PHYSICAL ASSISTANCE OR A REMINDER',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...LEVEL_1],
        },
        {
          label: 'REQUIRED SUPPORT WITH MEDICATION FOR CARER / PROVIDER',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
          helpText: 'Level 1A — provider support with physical assistance or reminders.',
        },
        {
          label: 'LEVEL 1 B FAMILY / INFORMAL CARER',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
          helpText: 'Level 1B — informal carer manages support with medication.',
        },
        {
          label:
            'LEVEL 2: THE SERVICE USER LACKS CAPACITY FOR MAKING DECISIONS ABOUT THE MANAGEMENT OF THEIR MEDICATION',
          fieldType: CarePathwayFormFieldType.SELECT,
          helpText:
            'Ensure capacity assessment and best-interest decision are documented where applicable.',
          options: [...LEVEL_2],
        },
        {
          label: 'Level 2 B - Family / informal carer',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
          helpText: 'Informal carer manages all aspects of medication.',
        },
        {
          label: '5. Medication Support - Assessment Tool Service Ability / Capability',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
        },
      ],
    },
    {
      title: 'Practical capability',
      fields: [
        {
          label: 'Able to collect prescriptions/medication from GP/Pharmacy?',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YES_NO],
        },
        {
          label:
            'If not already in place, arrange for informal carer or pharmacy to collect prescriptions and deliver medication.',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
          helpText: 'Providers will not perform this role except in emergency situations.',
        },
        {
          label: 'Able to obtain/organise repeat prescriptions?',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YES_NO],
        },
        {
          label: 'If not already in place, arrange for informal carer / pharmacy / GP to organise (repeat prescriptions).',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
        },
        {
          label: 'Able to return unused/out of date medications to pharmacy?',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YES_NO],
        },
        {
          label: 'If not already in place, arrange for informal carer / pharmacy / GP to organise (return unused).',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
        },
        {
          label: 'Able to read labels & directions on medication containers?',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YES_NO],
        },
        {
          label: 'Arrange for pharmacy to provide large print labels.',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
        },
        {
          label: 'Any other Comment',
          fieldType: CarePathwayFormFieldType.TEXTAREA,
        },
      ],
    },
    {
      title: 'Documentation checklist',
      description: 'Confirm each item is recorded or marked N/A as appropriate.',
      fields: [
        {
          label:
            'Name and contact details of GP, Pharmacist and any other relevant healthcare professional',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label: 'Relevant health details and any medication allergies',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label: "Highlighting if known any homeopathic and 'over the counter' medications.",
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label:
            "Highlighting any 'as required medication' (PRN) such as pain relief and details such as how often this can be taken.",
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label:
            'The service user or informal carer will need to check with their GP or pharmacist if medication can be prescribed less frequently.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label: 'Details of any time specific medication instructions.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label: 'Highlighting (if known) any controlled drugs.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label:
            'Highlighting (if known) any special arrangements for disposal of controlled drugs supplied in patch form.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label:
            'Level of medication support required and description of the support required with each medication.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label:
            'If service user is assessed as Level 2A, capacity assessment recorded and best interest decision documented.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label:
            'Where medication is stored and if it is (or needs to be) stored securely or refrigerated.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label: 'How medication is delivered/collected/reordered.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label: "Providers' medication risk assessment (if appropriate).",
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
        {
          label: 'Time allocated for medication support.',
          fieldType: CarePathwayFormFieldType.SELECT,
          options: [...YNNA],
        },
      ],
    },
  ],
};
