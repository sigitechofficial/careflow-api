import { CarePathwayFormFieldType } from '@prisma/client';

export type CarePlanFieldSeed = {
  label: string;
  fieldType: CarePathwayFormFieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
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
  Advance: {
    description:
      'Record advance care planning discussions, treatment preferences, DNACPR status, and who was involved in the conversation. Update when the service user’s wishes change.',
    sections: [
      {
        title: 'Planning discussion',
        description: 'When and with whom advance care planning took place.',
        fields: [
          { label: 'Date of discussion', fieldType: 'DATE', required: true },
          { label: 'People present', fieldType: 'TEXTAREA', placeholder: 'Service user, family, professionals…' },
          { label: 'Capacity to participate', fieldType: 'YES_NO', required: true },
        ],
      },
      {
        title: 'Preferences and decisions',
        fields: [
          {
            label: 'Treatment escalation preferences',
            fieldType: 'SELECT',
            options: ['Full treatment', 'Limited intervention', 'Comfort care only', 'Not yet discussed'],
          },
          { label: 'DNACPR in place', fieldType: 'YES_NO', required: true },
          { label: 'Preferred place of care if deteriorating', fieldType: 'TEXT' },
          { label: 'Summary of expressed wishes', fieldType: 'TEXTAREA', required: true },
        ],
      },
    ],
  },
  'Care Plan review form': {
    description:
      'Structured review of the service user’s care plan. Capture what is working, risks, changes required, and who will action follow-up.',
    sections: [
      {
        title: 'Review details',
        fields: [
          { label: 'Review date', fieldType: 'DATE', required: true },
          { label: 'Review type', fieldType: 'SELECT', options: ['Scheduled', 'Unscheduled', 'Post-incident', 'Hospital discharge'] },
          { label: 'Reviewer name and role', fieldType: 'TEXT', required: true },
        ],
      },
      {
        title: 'Outcomes',
        fields: [
          { label: 'Care plan still meeting needs', fieldType: 'YES_NO', required: true },
          { label: 'Changes required', fieldType: 'TEXTAREA' },
          { label: 'Actions and responsible person', fieldType: 'TEXTAREA' },
          { label: 'Next review date', fieldType: 'DATE' },
        ],
      },
    ],
  },
  'Cognition and Behaviour': {
    description:
      'Document cognitive strengths and difficulties, behaviour that challenges, triggers, and strategies carers should use day to day.',
    sections: [
      {
        title: 'Cognition',
        fields: [
          { label: 'Diagnosis or cognitive concern', fieldType: 'TEXTAREA' },
          { label: 'Orientation – knows where they are', fieldType: 'SELECT', options: ['Always', 'Usually', 'Sometimes', 'Rarely'] },
          { label: 'Memory prompts used', fieldType: 'TEXT' },
        ],
      },
      {
        title: 'Behaviour support',
        fields: [
          { label: 'Known triggers', fieldType: 'TEXTAREA' },
          { label: 'Calming strategies that work', fieldType: 'TEXTAREA', required: true },
          { label: 'Wandering or exit-seeking risk', fieldType: 'YES_NO' },
          { label: 'Additional guidance for carers', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  Communication: {
    description:
      'How the service user communicates, any sensory impairment, preferred language, and how staff should adapt their approach.',
    sections: [
      {
        title: 'Communication needs',
        fields: [
          { label: 'Preferred language', fieldType: 'TEXT' },
          { label: 'Hearing impairment', fieldType: 'YES_NO' },
          { label: 'Vision impairment', fieldType: 'YES_NO' },
          {
            label: 'Primary communication method',
            fieldType: 'SELECT',
            options: ['Verbal', 'Written', 'Gestures', 'AAC device', 'Combination'],
          },
        ],
      },
      {
        title: 'Guidance for staff',
        fields: [
          { label: 'How to approach conversations', fieldType: 'TEXTAREA', required: true },
          { label: 'Uses glasses/hearing aids', fieldType: 'TEXT' },
          { label: 'Consent to share information with family', fieldType: 'YES_NO' },
        ],
      },
    ],
  },
  Continence: {
    description:
      'Continence profile including bladder and bowel function, products in use, prompting schedule, and skin care linked to continence.',
    sections: [
      {
        title: 'Continence status',
        fields: [
          {
            label: 'Bladder continence',
            fieldType: 'SELECT',
            options: ['Continent', 'Occasional leakage', 'Incontinent – managed', 'Catheter'],
          },
          {
            label: 'Bowel continence',
            fieldType: 'SELECT',
            options: ['Continent', 'Occasional accident', 'Incontinent – managed', 'Stoma'],
          },
          { label: 'Products used (pads, commode, etc.)', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Care instructions',
        fields: [
          { label: 'Toileting/prompting routine', fieldType: 'TEXTAREA', required: true },
          { label: 'Fluid intake guidance', fieldType: 'TEXT' },
          { label: 'Skin care after episodes', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  'Culture/Religion/Spirituality': {
    description:
      'Cultural, religious, and spiritual preferences that must be respected in daily care, meals, routines, and end-of-life planning.',
    sections: [
      {
        title: 'Identity and beliefs',
        fields: [
          { label: 'Faith or belief system', fieldType: 'TEXT' },
          { label: 'Cultural practices important to the person', fieldType: 'TEXTAREA' },
          { label: 'Religious observances or visits', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Daily care impact',
        fields: [
          { label: 'Dietary requirements linked to faith/culture', fieldType: 'TEXTAREA' },
          { label: 'Gender preference for personal care', fieldType: 'TEXT' },
          { label: 'Notes for staff', fieldType: 'TEXTAREA', required: true },
        ],
      },
    ],
  },
  'Dementia Care plan': {
    description:
      'Person-centred dementia support plan covering orientation, meaningful occupation, safety, and involvement of family or advocates.',
    sections: [
      {
        title: 'Understanding the person',
        fields: [
          { label: 'Life history and interests', fieldType: 'TEXTAREA', required: true },
          { label: 'Stage of dementia (if known)', fieldType: 'TEXT' },
          { label: 'Best time of day for activities', fieldType: 'TEXT' },
        ],
      },
      {
        title: 'Daily support',
        fields: [
          { label: 'Orientation cues used (signs, photos, clocks)', fieldType: 'TEXTAREA' },
          { label: 'Sundowning or agitation – what helps', fieldType: 'TEXTAREA' },
          { label: 'Safe walking / supervision level', fieldType: 'SELECT', options: ['Independent', 'Intermittent supervision', 'Constant supervision'] },
        ],
      },
    ],
  },
  'Eating and Drinking': {
    description:
      'Nutrition and hydration plan including diet type, assistance level, choking risk, and monitoring of food and fluid intake.',
    sections: [
      {
        title: 'Diet and fluids',
        fields: [
          {
            label: 'Diet type',
            fieldType: 'SELECT',
            options: ['Normal', 'Soft', 'Pureed', 'Diabetic', 'Fortified', 'Other'],
          },
          { label: 'Fluid target per day (ml)', fieldType: 'NUMBER' },
          { label: 'Food allergies or intolerances', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Support at mealtimes',
        fields: [
          {
            label: 'Level of assistance',
            fieldType: 'SELECT',
            options: ['Independent', 'Setup only', 'Supervision', 'Full assistance'],
          },
          { label: 'Choking risk / SALT recommendations', fieldType: 'TEXTAREA' },
          { label: 'Preferred foods and dislikes', fieldType: 'TEXTAREA', required: true },
        ],
      },
    ],
  },
  Falls: {
    description:
      'Falls risk assessment summary, history of falls, mobility aids, environmental hazards, and actions to reduce risk.',
    sections: [
      {
        title: 'Falls history',
        fields: [
          { label: 'Falls in last 12 months', fieldType: 'NUMBER', placeholder: '0' },
          { label: 'Last fall date and circumstances', fieldType: 'TEXTAREA' },
          { label: 'Injury from previous falls', fieldType: 'YES_NO' },
        ],
      },
      {
        title: 'Prevention plan',
        fields: [
          { label: 'Mobility aids in use', fieldType: 'TEXT' },
          { label: 'Environmental hazards identified', fieldType: 'TEXTAREA' },
          { label: 'Transfers – instructions', fieldType: 'TEXTAREA', required: true },
          { label: 'Referral to physiotherapy', fieldType: 'YES_NO' },
        ],
      },
    ],
  },
  'Final Days': {
    description:
      'Palliative and end-of-life care preferences: comfort measures, symptom control, family communication, and spiritual support.',
    sections: [
      {
        title: 'Comfort and symptoms',
        fields: [
          { label: 'Current focus of care', fieldType: 'SELECT', options: ['Active treatment', 'Symptom control', 'End of life'] },
          { label: 'Pain management plan', fieldType: 'TEXTAREA' },
          { label: 'Mouth care frequency', fieldType: 'TEXT' },
        ],
      },
      {
        title: 'People and wishes',
        fields: [
          { label: 'Family contact and updates', fieldType: 'TEXTAREA' },
          { label: 'Spiritual or cultural needs', fieldType: 'TEXTAREA' },
          { label: 'Preferred place of death if expressed', fieldType: 'TEXT' },
        ],
      },
    ],
  },
  'Home Care Plan': {
    description:
      'Overview care plan for a person receiving care at home: why support is in place, overall outcomes, and how the package will be reviewed.',
    sections: [
      {
        title: 'Package overview',
        fields: [
          { label: 'Date plan started', fieldType: 'DATE', required: true },
          { label: 'Summary of needs prompting care', fieldType: 'TEXTAREA', required: true },
          { label: 'Hours and visits per week', fieldType: 'TEXT' },
        ],
      },
      {
        title: 'Outcomes',
        fields: [
          { label: 'What success looks like for @', fieldType: 'TEXTAREA', required: true },
          { label: 'Risks if care not provided', fieldType: 'TEXTAREA' },
          { label: 'Review frequency', fieldType: 'SELECT', options: ['Monthly', 'Quarterly', 'Six-monthly', 'Annually'] },
        ],
      },
    ],
  },
  'Home Care Plan - needs/goals/support': {
    description:
      'Detailed needs, goals, and how care staff will support the service user to achieve outcomes in their own home.',
    sections: [
      {
        title: 'Identified needs',
        fields: [
          { label: 'Personal care needs', fieldType: 'TEXTAREA' },
          { label: 'Domestic and living skills', fieldType: 'TEXTAREA' },
          { label: 'Social and emotional needs', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Goals and support',
        fields: [
          { label: 'Goal 1 – what we will achieve', fieldType: 'TEXTAREA', required: true },
          { label: 'How carers will support this', fieldType: 'TEXTAREA', required: true },
          { label: 'Goal 2 (optional)', fieldType: 'TEXTAREA' },
          { label: 'Progress notes', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  'Home Support Plan': {
    description:
      'Plan for practical support at home: tasks carers will complete, equipment, and coordination with other services.',
    sections: [
      {
        title: 'Support tasks',
        fields: [
          { label: 'Personal care tasks', fieldType: 'TEXTAREA', required: true },
          { label: 'Household tasks', fieldType: 'TEXTAREA' },
          { label: 'Shopping and meals', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Coordination',
        fields: [
          { label: 'Equipment in the home', fieldType: 'TEXT' },
          { label: 'Other professionals involved', fieldType: 'TEXTAREA' },
          { label: 'Key safe / access instructions', fieldType: 'TEXT' },
        ],
      },
    ],
  },
  Infection: {
    description:
      'Infection prevention and control measures, current or recent infections, isolation requirements, and monitoring signs.',
    sections: [
      {
        title: 'Current status',
        fields: [
          { label: 'Active infection or colonisation', fieldType: 'YES_NO' },
          { label: 'Type and date identified', fieldType: 'TEXT' },
          { label: 'Isolation or enhanced precautions', fieldType: 'SELECT', options: ['None', 'Standard', 'Contact', 'Droplet', 'Airborne'] },
        ],
      },
      {
        title: 'Prevention',
        fields: [
          { label: 'PPE required for visits', fieldType: 'TEXT' },
          { label: 'Hand hygiene and cleaning notes', fieldType: 'TEXTAREA', required: true },
          { label: 'When to escalate to nurse/GP', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  Medication: {
    description:
      'Medication support plan: what medicines are taken, who administers them, adherence issues, and allergy or interaction alerts.',
    sections: [
      {
        title: 'Medication overview',
        fields: [
          { label: 'Medication support level', fieldType: 'SELECT', options: ['Self-administers', 'Prompted', 'Administered by carer', 'Nurse only'] },
          { label: 'Known allergies', fieldType: 'TEXTAREA', required: true },
          { label: 'PRN medicines and when used', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Instructions',
        fields: [
          { label: 'Storage and blister packs', fieldType: 'TEXT' },
          { label: 'Refusal or missed dose – action', fieldType: 'TEXTAREA', required: true },
          { label: 'Pharmacy and GP contact', fieldType: 'TEXT' },
        ],
      },
    ],
  },
  Mobility: {
    description:
      'Mobility and transfers plan including independence level, equipment, physiotherapy input, and safe handling for carers.',
    sections: [
      {
        title: 'Mobility status',
        fields: [
          {
            label: 'Indoor mobility',
            fieldType: 'SELECT',
            options: ['Independent', 'Stick', 'Frame', 'Wheelchair', 'Bed bound'],
          },
          {
            label: 'Outdoor mobility',
            fieldType: 'SELECT',
            options: ['Independent', 'Assisted', 'Does not go out', 'Not assessed'],
          },
          { label: 'Equipment issued', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Transfers',
        fields: [
          { label: 'Transfer method (bed/chair/toilet)', fieldType: 'TEXTAREA', required: true },
          { label: 'Number of carers required', fieldType: 'SELECT', options: ['1', '2'] },
          { label: 'Physio / OT recommendations', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  'Pain Management': {
    description:
      'How pain is assessed and managed, including non-drug approaches, prescribed analgesia, and when to seek clinical review.',
    sections: [
      {
        title: 'Pain profile',
        fields: [
          { label: 'Usual pain score (0–10)', fieldType: 'NUMBER' },
          { label: 'Site and character of pain', fieldType: 'TEXTAREA' },
          { label: 'What worsens or relieves pain', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Management',
        fields: [
          { label: 'Regular analgesia', fieldType: 'TEXTAREA' },
          { label: 'Non-pharmacological methods', fieldType: 'TEXTAREA', required: true },
          { label: 'When to call GP or out of hours', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  'Person Centred care plan': {
    description:
      'What matters most to the person: routines, preferences, relationships, and how care should feel from their perspective.',
    sections: [
      {
        title: 'About me',
        fields: [
          { label: 'What is important to me', fieldType: 'TEXTAREA', required: true },
          { label: 'How I like to be supported', fieldType: 'TEXTAREA', required: true },
          { label: 'People who matter to me', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Daily life',
        fields: [
          { label: 'Morning routine preferences', fieldType: 'TEXTAREA' },
          { label: 'Evening / bedtime routine', fieldType: 'TEXTAREA' },
          { label: 'Things that upset or calm me', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
  'Personal Safety': {
    description:
      'Safety in the home and community: hazards, safeguarding concerns, lone working notes, and emergency procedures.',
    sections: [
      {
        title: 'Risk and environment',
        fields: [
          { label: 'Home hazards identified', fieldType: 'TEXTAREA' },
          { label: 'Smoking / fire safety', fieldType: 'TEXT' },
          { label: 'Lone worker risk level', fieldType: 'SELECT', options: ['Low', 'Medium', 'High'] },
        ],
      },
      {
        title: 'Safeguarding',
        fields: [
          { label: 'Safeguarding concern on file', fieldType: 'YES_NO' },
          { label: 'Actions in place', fieldType: 'TEXTAREA' },
          { label: 'Emergency contacts', fieldType: 'TEXTAREA', required: true },
        ],
      },
    ],
  },
  'Physical Health': {
    description:
      'Long-term conditions, acute issues, GP and specialist involvement, and monitoring required during care visits.',
    sections: [
      {
        title: 'Health conditions',
        fields: [
          { label: 'Primary diagnoses', fieldType: 'TEXTAREA', required: true },
          { label: 'Recent hospital admissions', fieldType: 'TEXTAREA' },
          { label: 'GP surgery and named GP', fieldType: 'TEXT' },
        ],
      },
      {
        title: 'Monitoring',
        fields: [
          { label: 'Vital signs or NEWS2 required', fieldType: 'YES_NO' },
          { label: 'Blood glucose monitoring', fieldType: 'YES_NO' },
          { label: 'When to seek urgent medical advice', fieldType: 'TEXTAREA', required: true },
        ],
      },
    ],
  },
  'Pressure Ulcer': {
    description:
      'Skin integrity and pressure ulcer prevention: risk level, repositioning, equipment, and existing wounds with dressings.',
    sections: [
      {
        title: 'Risk and skin',
        fields: [
          {
            label: 'Waterlow or risk score',
            fieldType: 'SELECT',
            options: ['Low', 'At risk', 'High', 'Very high'],
          },
          { label: 'Existing pressure areas or wounds', fieldType: 'TEXTAREA' },
          { label: 'Skin inspection frequency', fieldType: 'TEXT' },
        ],
      },
      {
        title: 'Prevention plan',
        fields: [
          { label: 'Repositioning schedule', fieldType: 'TEXTAREA', required: true },
          { label: 'Pressure relieving equipment', fieldType: 'TEXTAREA' },
          { label: 'Nutrition linked to skin healing', fieldType: 'TEXT' },
        ],
      },
    ],
  },
  Psychological: {
    description:
      'Emotional wellbeing and mental health: mood, anxiety, formal diagnosis, therapies, and how carers should respond.',
    sections: [
      {
        title: 'Wellbeing',
        fields: [
          { label: 'Current mood (typical)', fieldType: 'SELECT', options: ['Stable', 'Low', 'Anxious', 'Variable', 'Elevated'] },
          { label: 'Mental health diagnosis', fieldType: 'TEXT' },
          { label: 'Triggers for distress', fieldType: 'TEXTAREA' },
        ],
      },
      {
        title: 'Support',
        fields: [
          { label: 'Coping strategies that help', fieldType: 'TEXTAREA', required: true },
          { label: 'Involvement of CMHT or counsellor', fieldType: 'TEXT' },
          { label: 'When to contact crisis team / GP', fieldType: 'TEXTAREA' },
        ],
      },
    ],
  },
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
  'Skin Integrity': {
    description:
      'Routine skin care: dryness, rashes, emollients, wound clinics, and reporting changes to nursing staff.',
    sections: [
      {
        title: 'Skin profile',
        fields: [
          { label: 'Skin type / common issues', fieldType: 'TEXTAREA' },
          { label: 'Emollients or creams prescribed', fieldType: 'TEXTAREA' },
          { label: 'Previous pressure damage', fieldType: 'YES_NO' },
        ],
      },
      {
        title: 'Daily care',
        fields: [
          { label: 'Application of creams – when and where', fieldType: 'TEXTAREA', required: true },
          { label: 'Signs to report immediately', fieldType: 'TEXTAREA', required: true },
        ],
      },
    ],
  },
  'Sleeping and Night': {
    description:
      'Night-time routine, sleep patterns, disturbances, and how to promote rest while keeping the person safe.',
    sections: [
      {
        title: 'Sleep pattern',
        fields: [
          { label: 'Usual bedtime and wake time', fieldType: 'TEXT' },
          { label: 'Night-time waking or confusion', fieldType: 'TEXTAREA' },
          { label: 'Daytime naps', fieldType: 'YES_NO' },
        ],
      },
      {
        title: 'Night care',
        fields: [
          { label: 'Evening routine', fieldType: 'TEXTAREA', required: true },
          { label: 'Call bell / monitoring', fieldType: 'TEXT' },
          { label: 'Night-time drinks or snacks', fieldType: 'TEXT' },
        ],
      },
    ],
  },
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
  'Washing and dressing': {
    description:
      'Personal care preferences for washing, bathing, oral care, and dressing including dignity, gender, and equipment.',
    sections: [
      {
        title: 'Preferences',
        fields: [
          {
            label: 'Preferred wash type',
            fieldType: 'SELECT',
            options: ['Full bath', 'Shower', 'Strip wash', 'Bed bath', 'Declines on this day'],
          },
          { label: 'Preferred time of day', fieldType: 'SELECT', options: ['Morning', 'Afternoon', 'Evening'] },
          { label: 'Gender of carer preferred', fieldType: 'TEXT' },
        ],
      },
      {
        title: 'Dressing and grooming',
        fields: [
          { label: 'Level of assistance required', fieldType: 'SELECT', options: ['Independent', 'Supervision', 'Full assistance'] },
          { label: 'Clothing preferences', fieldType: 'TEXTAREA' },
          { label: 'Dental / denture care', fieldType: 'TEXTAREA', required: true },
        ],
      },
    ],
  },
};
