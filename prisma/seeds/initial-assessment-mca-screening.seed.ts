import { InitialAssessmentQuestionType } from '@prisma/client';
import { iaMeta, whenYes } from './initial-assessment-enterprise-metadata';

const Y = InitialAssessmentQuestionType.YES_NO;
const A = InitialAssessmentQuestionType.TEXTAREA;
const S = InitialAssessmentQuestionType.SINGLE_SELECT;

export const MCA_SCREENING_OUTCOME_OPTIONS = [
  {
    value: 'has_capacity',
    label:
      'There is a reasonable belief that the person does have capacity to make informed decision regarding the question being asked.',
  },
  {
    value: 'lacks_capacity',
    label:
      'There is reasonable belief that the person does not have capacity to make an informed decision regarding the question being asked.',
  },
];

const MCA_WHEN_REQUIRED = whenYes('mca required');

/** Initial Mental Capacity Act screening tool (document tab 3). Upserted by questionText. */
export const MCA_SCREENING_QUESTIONS = [
  {
    questionText:
      'Does the person have an impairment or disturbance in the functioning of the mind or brain?',
    questionType: Y,
    isRequired: true,
    sortOrder: 51,
    metadata: iaMeta('2.mca', {
      fieldKey: 'mcaStage1Impairment',
      screeningPart: 'two_stage',
      screeningOrder: 1,
      hint: 'It does not matter whether the impairment or disturbance is temporary or permanent.',
      ...MCA_WHEN_REQUIRED,
    }),
  },
  {
    questionText:
      'Does that impairment or disturbance mean that the person is unable to make the decision in question at the time that it needs to be made?',
    questionType: Y,
    isRequired: true,
    sortOrder: 52,
    metadata: iaMeta('2.mca', {
      fieldKey: 'mcaStage2UnableToDecide',
      screeningPart: 'two_stage',
      screeningOrder: 2,
      ...MCA_WHEN_REQUIRED,
    }),
  },
  {
    questionText: 'Can the person understand the provided information relevant to the decision?',
    questionType: Y,
    isRequired: true,
    sortOrder: 53,
    metadata: iaMeta('2.mca', {
      fieldKey: 'mcaFunctionalUnderstand',
      screeningPart: 'functional',
      screeningOrder: 1,
      ...MCA_WHEN_REQUIRED,
    }),
  },
  {
    questionText: 'Can the person retain the information given?',
    questionType: Y,
    isRequired: true,
    sortOrder: 54,
    metadata: iaMeta('2.mca', {
      fieldKey: 'mcaFunctionalRetain',
      screeningPart: 'functional',
      screeningOrder: 2,
      ...MCA_WHEN_REQUIRED,
    }),
  },
  {
    questionText:
      'Can the person use or weigh the information given as part of their decision making process?',
    questionType: Y,
    isRequired: true,
    sortOrder: 55,
    metadata: iaMeta('2.mca', {
      fieldKey: 'mcaFunctionalWeigh',
      screeningPart: 'functional',
      screeningOrder: 3,
      ...MCA_WHEN_REQUIRED,
    }),
  },
  {
    questionText:
      'Can the person communicate their decision? (whether by talking or any other means)',
    questionType: Y,
    isRequired: true,
    sortOrder: 56,
    metadata: iaMeta('2.mca', {
      fieldKey: 'mcaFunctionalCommunicate',
      screeningPart: 'functional',
      screeningOrder: 4,
      ...MCA_WHEN_REQUIRED,
    }),
  },
  {
    questionText: 'Outcome of the mental capacity screening tool',
    questionType: S,
    isRequired: true,
    sortOrder: 57,
    options: { options: MCA_SCREENING_OUTCOME_OPTIONS },
    metadata: iaMeta('2.mca', {
      fieldKey: 'mcaScreeningOutcome',
      screeningPart: 'outcome',
      ...MCA_WHEN_REQUIRED,
    }),
  },
  {
    questionText: 'MCA screening tool comments',
    questionType: A,
    sortOrder: 58,
    metadata: iaMeta('2.mca', {
      fieldKey: 'mcaScreeningComments',
      screeningPart: 'comments',
      ...MCA_WHEN_REQUIRED,
    }),
  },
];
