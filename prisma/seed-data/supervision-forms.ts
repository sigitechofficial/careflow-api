/**
 * Default Care Pathway staff forms for supervision, spot checks, probation, appraisal and the other
 * workforce review types. Seeded once (by name) as published STAFF_FORM forms; after that admins
 * own them in Care Pathway → Form builder and choose which form each review type uses in
 * Settings → Supervision.
 *
 * Content follows Skills for Care supervision guidance (management, development and reflective
 * support), NICE QS123 (home care workers have practice observed and are supervised) and CQC
 * Regulation 18 (staff receive supervision and appraisal). Yes/No and pick-list questions are used
 * wherever the answer should be countable as evidence; discussion is free text.
 */
export type SupervisionFormFieldType =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'TIME'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'CHECKBOX'
  | 'YES_NO'
  | 'SUMMERNOTE'
  | 'SECTION_TEXT';

export type SupervisionFormFieldDef = {
  key: string;
  label: string;
  type: SupervisionFormFieldType;
  help?: string;
  required?: boolean;
  options?: string[];
};

export type SupervisionFormSectionDef = {
  title: string;
  description?: string;
  fields: SupervisionFormFieldDef[];
};

export type SupervisionFormDef = {
  name: string;
  description: string;
  /** ReviewType.code values that use this form when it is first created. */
  reviewTypeCodes: string[];
  sections: SupervisionFormSectionDef[];
};

const notes = (key: string, label: string, help?: string, required = false): SupervisionFormFieldDef => ({
  key,
  label,
  type: 'SUMMERNOTE',
  help,
  required,
});
const yesNo = (key: string, label: string, help?: string, required = true): SupervisionFormFieldDef => ({
  key,
  label,
  type: 'YES_NO',
  help,
  required,
});
const pick = (key: string, label: string, options: string[], help?: string, required = true): SupervisionFormFieldDef => ({
  key,
  label,
  type: 'SELECT',
  options,
  help,
  required,
});

const RATING_3 = ['Good', 'Satisfactory', 'Concern'];

const PREVIOUS_ACTIONS: SupervisionFormSectionDef = {
  title: 'Since last time',
  description: 'Open actions from earlier sessions are listed on the session page; record progress here.',
  fields: [notes('previous_actions', 'Progress on previous actions', 'Done, still open, or no longer needed, and why.')],
};

const WELLBEING: SupervisionFormSectionDef = {
  title: 'Wellbeing and support',
  fields: [
    pick('wellbeing', 'How is the carer doing?', ['Good', 'OK', 'Struggling']),
    notes(
      'wellbeing_notes',
      'Wellbeing discussion',
      'Anything at work or home affecting them, stress, fatigue, support they need from us (Employee Assistance, OH referral).',
      true,
    ),
  ],
};

const SAFEGUARDING: SupervisionFormSectionDef = {
  title: 'Safeguarding and concerns',
  fields: [
    yesNo('safeguarding_concern', 'Any safeguarding or practice concerns raised?', 'About people supported, colleagues or practice.'),
    notes('safeguarding_details', 'Details and what was done', 'If yes: what was raised, who it was reported to and the reference.'),
    {
      key: 'whistleblowing_reminded',
      label: 'Reminded how to raise concerns (whistleblowing / Freedom to Speak Up)',
      type: 'CHECKBOX',
      required: true,
    },
  ],
};

const TRAINING: SupervisionFormSectionDef = {
  title: 'Training and development',
  fields: [
    yesNo('mandatory_training_current', 'Mandatory training up to date?', 'Check the training record before the session.'),
    notes('development_notes', 'Training due, qualifications and goals', 'Care Certificate / diploma progress, learning needs, career goals.', true),
  ],
};

const CONFIRMATION: SupervisionFormSectionDef = {
  title: 'Questions and confirmation',
  fields: [
    notes('questions', "Carer's questions"),
    {
      key: 'understood',
      label: 'The carer confirms they understand and will follow the policy',
      type: 'CHECKBOX',
      required: true,
    },
  ],
};

export const DEFAULT_SUPERVISION_FORMS: SupervisionFormDef[] = [
  {
    name: 'Staff supervision (one-to-one)',
    description: 'Regular one-to-one supervision: wellbeing, practice, safeguarding and development (CQC Regulation 18).',
    reviewTypeCodes: ['SUPERVISION'],
    sections: [
      PREVIOUS_ACTIONS,
      WELLBEING,
      {
        title: 'Workload, rota and travel',
        fields: [
          yesNo('workload_manageable', 'Is the workload manageable?', 'Hours, rota, travel time between visits, lone working.'),
          notes('workload_notes', 'Workload discussion', 'Anything making visits hard to complete on time or in full.'),
        ],
      },
      {
        title: 'Practice and care quality',
        fields: [
          {
            key: 'feedback_received',
            label: 'Feedback since last supervision',
            type: 'MULTI_SELECT',
            options: ['Compliment', 'Complaint', 'Concern', 'None'],
            required: true,
          },
          notes(
            'practice_quality',
            'Practice discussion',
            'Feedback from people supported and families, care plan use, record keeping, observed practice findings.',
            true,
          ),
        ],
      },
      {
        title: 'Medication',
        fields: [
          yesNo('medication_incident', 'Any medication errors or near misses since last time?'),
          notes('medication_notes', 'Medication discussion', 'eMAR recording, confidence with medicines support, learning from incidents.'),
        ],
      },
      SAFEGUARDING,
      TRAINING,
      { title: 'Any other business', fields: [notes('other_business', 'Anything else discussed')] },
    ],
  },
  {
    name: 'Clinical supervision',
    description: 'Clinical supervision for nurses and senior clinical staff: caseload, reflection and registration.',
    reviewTypeCodes: ['CLINICAL_SUPERVISION'],
    sections: [
      PREVIOUS_ACTIONS,
      WELLBEING,
      {
        title: 'Clinical practice and caseload',
        fields: [
          notes('clinical_practice', 'Complex cases, clinical decisions and escalations', 'Outcomes, risks and anything needing a second opinion.', true),
          notes('reflective_practice', 'Reflective practice', 'A situation to reflect on: what happened, what was learnt, what changes.'),
        ],
      },
      {
        title: 'Professional registration',
        fields: [
          yesNo('registration_current', 'NMC / HCPC registration current?'),
          notes('revalidation_notes', 'Revalidation and CPD', 'CPD hours, practice-related feedback, revalidation date.'),
        ],
      },
      SAFEGUARDING,
      TRAINING,
    ],
  },
  {
    name: 'Probation review',
    description: 'Probation review against the induction plan and probation objectives.',
    reviewTypeCodes: ['PROBATION_REVIEW'],
    sections: [
      PREVIOUS_ACTIONS,
      WELLBEING,
      {
        title: 'Induction and Care Certificate',
        fields: [
          pick('care_certificate_progress', 'Care Certificate progress', ['Not started', 'In progress', 'Completed']),
          { key: 'shadow_shifts', label: 'Shadow shifts completed', type: 'NUMBER' },
          notes('competencies_outstanding', 'Competencies still to assess'),
        ],
      },
      {
        title: 'Performance against probation objectives',
        fields: [
          pick('timekeeping', 'Timekeeping and visit times', RATING_3),
          pick('record_keeping', 'Record keeping', RATING_3),
          pick('conduct', 'Attitude and conduct', RATING_3),
          notes('performance_notes', 'Evidence and feedback', 'Feedback from people supported, families, colleagues and spot checks.', true),
        ],
      },
      SAFEGUARDING,
      {
        title: 'Outcome',
        fields: [
          pick('probation_outcome', 'Outcome', ['On track', 'Extend probation', 'Pass probation', 'Not passed – refer to HR']),
          notes('outcome_notes', 'Reasons and what happens next', undefined, true),
        ],
      },
    ],
  },
  {
    name: 'Induction check-in',
    description: 'Early check-in in the first weeks of employment.',
    reviewTypeCodes: ['INDUCTION_CHECKIN'],
    sections: [
      WELLBEING,
      {
        title: 'First weeks in the role',
        fields: [
          yesNo('shadowing_done', 'Shadow shifts completed as planned?'),
          yesNo('policies_read', 'Key policies read and signed?', 'Safeguarding, whistleblowing, lone working, medication, data protection.'),
          yesNo('app_access', 'Carer app, ID badge, uniform and PPE in place?'),
          notes('first_weeks_notes', 'How the first weeks have gone', 'Questions so far, anything they are unsure about.', true),
        ],
      },
      {
        title: 'Care Certificate plan',
        fields: [notes('care_certificate_plan', 'Standards to work on next and who will assess them')],
      },
    ],
  },
  {
    name: 'Spot check (observed practice)',
    description: 'Unannounced or announced observation of a visit (NICE QS123). Every check answer is countable evidence.',
    reviewTypeCodes: ['SPOT_CHECK'],
    sections: [
      {
        title: 'Visit observed',
        fields: [
          { key: 'person_supported', label: 'Person supported (initials or client ID)', type: 'TEXT', required: true },
          { key: 'visit_time', label: 'Visit time', type: 'TIME' },
          yesNo('announced', 'Was the carer told in advance?', undefined, false),
          notes('tasks_observed', 'Tasks observed', undefined, true),
        ],
      },
      {
        title: 'Arrival and identity',
        fields: [
          yesNo('on_time', 'Arrived on time (or the person was told about any delay)'),
          yesNo('id_badge', 'Wearing ID badge'),
          yesNo('checked_in', 'Checked in on the carer app'),
          yesNo('uniform_ppe', 'Uniform and PPE appropriate'),
        ],
      },
      {
        title: 'Dignity, choice and communication',
        fields: [
          yesNo('introduced', 'Knocked / rang and introduced themselves'),
          yesNo('choice_offered', 'Offered choice and asked for consent'),
          yesNo('privacy_dignity', 'Maintained privacy and dignity'),
          yesNo('respectful_communication', 'Spoke respectfully and at the person’s pace'),
        ],
      },
      {
        title: 'Care plan and moving and handling',
        fields: [
          yesNo('care_plan_followed', 'Tasks done as the care plan says'),
          pick('moving_handling', 'Moving and handling technique', ['Safe', 'Needs improvement', 'Not observed']),
          pick('equipment', 'Equipment used safely', ['Yes', 'No', 'Not used']),
        ],
      },
      {
        title: 'Infection prevention',
        fields: [
          yesNo('hand_hygiene', 'Hand hygiene before and after care'),
          yesNo('ppe_correct', 'Gloves and apron used and disposed of correctly'),
        ],
      },
      {
        title: 'Medication support',
        fields: [
          pick('medication_observed', 'Medication support', ['Given correctly', 'Issues found', 'Not observed']),
          pick('emar_recorded', 'eMAR recorded at the time', ['Yes', 'No', 'Not applicable']),
        ],
      },
      {
        title: 'Records and escalation',
        fields: [
          yesNo('notes_accurate', 'Visit notes accurate and written at the visit'),
          pick('escalation', 'Anything needing escalation was reported', ['Yes', 'No', 'Nothing to report']),
        ],
      },
      {
        title: 'Feedback from the person and family',
        fields: [notes('person_feedback', 'What the person and family said about this carer')],
      },
      {
        title: 'Outcome',
        fields: [
          pick('spot_check_outcome', 'Overall outcome', [
            'Meets the standard',
            'Minor improvements needed',
            'Not safe – immediate action taken',
          ]),
          notes('strengths', 'Strengths'),
          notes('improvements', 'Areas to improve and feedback given to the carer', undefined, true),
          yesNo('recheck', 'Re-check needed?'),
        ],
      },
    ],
  },
  {
    name: 'Return to work interview',
    description: 'Return to work after sickness, injury or other absence.',
    reviewTypeCodes: ['RETURN_TO_WORK'],
    sections: [
      {
        title: 'Absence',
        fields: [
          { key: 'absence_start', label: 'First day of absence', type: 'DATE', required: true },
          { key: 'absence_end', label: 'Last day of absence', type: 'DATE', required: true },
          pick('absence_reason', 'Reason', ['Sickness', 'Injury at work', 'Injury outside work', 'Family / dependant', 'Other']),
          yesNo('fit_note', 'Fit note received (needed after 7 calendar days)?', undefined, false),
          notes('absence_notes', 'Details'),
        ],
      },
      {
        title: 'Fitness to return',
        fields: [
          yesNo('fit_for_full_duties', 'Fit for full duties, including moving and handling and driving?'),
          notes('restrictions', 'Ongoing health issues, medication or restrictions'),
          pick('adjustments', 'Adjustments agreed', ['None', 'Phased return', 'Reduced hours', 'Lighter duties', 'Occupational Health referral']),
        ],
      },
      {
        title: 'Updates missed while away',
        fields: [notes('updates_missed', 'Changes to people supported, care plans, policies and training due')],
      },
      WELLBEING,
    ],
  },
  {
    name: 'Performance improvement review',
    description: 'Formal performance improvement plan meeting.',
    reviewTypeCodes: ['PERFORMANCE_IMPROVEMENT'],
    sections: [
      {
        title: 'Concerns',
        fields: [
          notes('concerns', 'Performance concerns and the standard expected', 'Specific and evidenced.', true),
          notes('carer_response', "Carer's response", 'Their view, context and any support needs.', true),
        ],
      },
      {
        title: 'Plan',
        fields: [
          notes('targets', 'Improvement targets', 'Measurable targets, how progress will be checked and by when.', true),
          {
            key: 'support_offered',
            label: 'Support offered',
            type: 'MULTI_SELECT',
            options: ['Training', 'Shadowing', 'Buddy', 'More frequent supervision', 'Occupational Health', 'Other'],
          },
          { key: 'review_date', label: 'Review date', type: 'DATE', required: true },
        ],
      },
      {
        title: 'Progress and outcome',
        fields: [
          pick('targets_met', 'Targets', ['Met', 'Partly met', 'Not met', 'First meeting – not reviewed yet']),
          pick('pip_outcome', 'Outcome', ['Continue plan', 'Close – targets met', 'Escalate under the capability policy']),
          notes('pip_notes', 'Notes'),
        ],
      },
    ],
  },
  {
    name: 'Care Certificate sign-off',
    description: 'Sign-off that all 15 Care Certificate standards have been met.',
    reviewTypeCodes: ['CARE_CERTIFICATE_SIGNOFF'],
    sections: [
      {
        title: 'Standards',
        fields: [
          yesNo('all_standards', 'All 15 standards assessed and met?'),
          notes('standards_outstanding', 'Standards outstanding (if any)'),
          yesNo('observations_done', 'Practice observations completed by a competent assessor?'),
          yesNo('knowledge_checks', 'Workbook / knowledge checks completed and marked?'),
        ],
      },
      {
        title: 'Decision',
        fields: [
          pick('signoff_decision', 'Decision', ['Signed off to work unsupervised', 'Further support needed']),
          notes('signoff_notes', 'Support needed and by when', 'If not signed off: what is needed, who will help and the target date.'),
        ],
      },
    ],
  },
  {
    name: 'NMC revalidation discussion',
    description: 'Reflective discussion and confirmation for NMC revalidation.',
    reviewTypeCodes: ['NMC_REVALIDATION_DISCUSSION'],
    sections: [
      {
        title: 'Requirements',
        fields: [
          yesNo('practice_hours', '450 practice hours over 3 years (900 for dual registration)?'),
          yesNo('cpd_hours', '35 hours of CPD, including 20 participatory?'),
          yesNo('feedback_pieces', 'Five pieces of practice-related feedback?'),
          yesNo('reflective_accounts', 'Five written reflective accounts linked to the Code?'),
        ],
      },
      {
        title: 'Reflective discussion',
        fields: [notes('reflective_discussion', 'Discussion of the reflective accounts', undefined, true)],
      },
      {
        title: 'Confirmation',
        fields: [
          yesNo('health_character', 'Health and character declaration completed?'),
          yesNo('indemnity', 'Professional indemnity arrangement in place?'),
          { key: 'revalidation_due', label: 'Revalidation due date', type: 'DATE' },
        ],
      },
    ],
  },
  {
    name: 'Team meeting record',
    description: 'Team meeting or group supervision record.',
    reviewTypeCodes: ['TEAM_MEETING'],
    sections: [
      {
        title: 'Updates',
        fields: [notes('service_updates', 'Changes to people supported, policies, rota and systems', undefined, true)],
      },
      {
        title: 'Learning',
        fields: [
          notes('learning_from_events', 'Learning from incidents, complaints and compliments', undefined, true),
          notes('group_reflection', 'Case or situation discussed as a team'),
        ],
      },
      { title: 'Any other business', fields: [notes('other_business', 'Anything else discussed')] },
    ],
  },
  {
    name: 'Phone and social media policy briefing',
    description: 'Briefing on phone use during care and social media.',
    reviewTypeCodes: ['PHONE_SOCIAL_MEDIA'],
    sections: [
      {
        title: 'Policy explained',
        fields: [
          {
            key: 'policy_points',
            label: 'Points covered',
            type: 'MULTI_SELECT',
            options: [
              'Phone used only for the carer app or emergencies during care',
              'No photos of people supported or their homes',
              'No posts about people supported or colleagues',
              'Data protection and confidentiality',
            ],
            required: true,
          },
        ],
      },
      CONFIRMATION,
    ],
  },
  {
    name: 'Whistleblowing awareness briefing',
    description: 'Briefing on raising concerns internally and externally.',
    reviewTypeCodes: ['WHISTLEBLOWING_AWARENESS'],
    sections: [
      {
        title: 'Policy explained',
        fields: [
          {
            key: 'policy_points',
            label: 'Points covered',
            type: 'MULTI_SELECT',
            options: [
              'How to raise a concern with a manager',
              'Freedom to Speak Up guardian / named contact',
              'Raising concerns with CQC or the local authority',
              'Protection from detriment',
            ],
            required: true,
          },
          notes('concerns_now', 'Any concerns the carer wants to raise now'),
        ],
      },
      CONFIRMATION,
    ],
  },
  {
    name: 'Annual appraisal',
    description: 'Yearly appraisal: review of the year, objectives and development plan.',
    reviewTypeCodes: ['ANNUAL_APPRAISAL'],
    sections: [
      {
        title: 'Review of the year',
        fields: [
          notes('year_review', 'Achievements, challenges and themes from this year’s supervisions', undefined, true),
          pick('objectives_met', 'Last year’s objectives', ['Met', 'Partly met', 'Not met', 'None set']),
          notes('objectives_evidence', 'Evidence'),
        ],
      },
      {
        title: 'Competencies and values',
        fields: [
          pick('person_centred', 'Person-centred care and dignity', RATING_3),
          pick('communication', 'Communication and teamwork', RATING_3),
          pick('records', 'Record keeping', RATING_3),
        ],
      },
      TRAINING,
      {
        title: 'Next year',
        fields: [
          notes('objectives_next', 'Objectives for next year', 'Specific and measurable, agreed with the carer.', true),
          pick('overall_rating', 'Overall', ['Exceeds expectations', 'Meets expectations', 'Partly meets', 'Does not meet']),
        ],
      },
      WELLBEING,
    ],
  },
];
