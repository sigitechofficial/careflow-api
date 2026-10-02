import { InitialAssessmentQuestionType } from '@prisma/client';
import {
  APPETITE_CONCERN_OPTIONS,
  ASSISTANCE_LEVEL_OPTIONS,
  BLADDER_CONTINENCE_OPTIONS,
  BOWEL_CONTINENCE_OPTIONS,
  BREATHING_CONCERN_OPTIONS,
  CHOKING_FREQUENCY_OPTIONS,
  CHOKING_OCCURS_WITH_OPTIONS,
  EMOTIONAL_WELLBEING_OPTIONS,
  FLUID_THICKNESS_OPTIONS,
  FOOD_TEXTURE_OPTIONS,
  HEARING_IMPAIRMENT_OPTIONS,
  MEDICATION_ADMINISTERED_BY_OPTIONS,
  MEDICATION_AWARENESS_OPTIONS,
  MEDICATION_DISPENSING_METHOD_OPTIONS,
  MEDICATION_SUPPORT_LEVEL_OPTIONS,
  MEDICATION_ORDERING_BY_OPTIONS,
  MEDICATION_COLLECTION_BY_OPTIONS,
  MEDICATION_STORAGE_OPTIONS,
  NUTRITION_STATUS_OPTIONS,
  ORAL_HEALTH_OPTIONS,
  PAIN_DISTRESS_OPTIONS,
  SIGHT_IMPAIRMENT_OPTIONS,
  SLEEPING_PATTERN_OPTIONS,
  SPEECH_IMPAIRMENT_OPTIONS,
  SWALLOWING_CONCERN_OPTIONS,
  YES_NO_UNKNOWN_OPTIONS,
} from './initial-assessment-enterprise-options';
import { iaMeta, whenFieldYes, whenNo, whenYes } from './initial-assessment-enterprise-metadata';

const Y = InitialAssessmentQuestionType.YES_NO;
const T = InitialAssessmentQuestionType.TEXT;
const A = InitialAssessmentQuestionType.TEXTAREA;
const N = InitialAssessmentQuestionType.NUMBER;
const D = InitialAssessmentQuestionType.DATE;
const S = InitialAssessmentQuestionType.SINGLE_SELECT;
const M = InitialAssessmentQuestionType.MULTI_SELECT;

export type EnterpriseQuestionSeed = {
  questionText: string;
  questionType?: InitialAssessmentQuestionType;
  helpText?: string;
  options?: { options: { value: string; label: string }[] };
  isRequired?: boolean;
  riskFlag?: boolean;
  carePlanTrigger?: boolean;
  sortOrder: number;
  metadata?: Record<string, unknown>;
};

export const SECTION_5_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'No concerns identified in this section', questionType: Y, sortOrder: 0, helpText: 'Select Yes if breathing, pain and swallowing are all satisfactory.', metadata: iaMeta('5.0', { noConcernMaster: true }) },
  { questionText: 'Breathing concern options', questionType: M, isRequired: true, sortOrder: 1, options: BREATHING_CONCERN_OPTIONS, metadata: iaMeta('5.1', { fieldKey: 'breathingConcerns' }) },
  { questionText: 'Breathing condition details', questionType: A, sortOrder: 2, metadata: iaMeta('5.1', { fieldKey: 'breathingDetails' }) },
  { questionText: 'Asthma present?', questionType: Y, sortOrder: 3, metadata: iaMeta('5.1') },
  { questionText: 'Emphysema / COPD present?', questionType: Y, sortOrder: 4, metadata: iaMeta('5.1') },
  { questionText: 'Oxygen dependent?', questionType: Y, riskFlag: true, sortOrder: 5, metadata: iaMeta('5.1', { fieldKey: 'oxygenDependent' }) },
  { questionText: 'Oxygen care notes', questionType: A, sortOrder: 6, metadata: iaMeta('5.1', whenYes('oxygen dependent')) },
  { questionText: 'GP or specialist nurse review requested?', questionType: Y, carePlanTrigger: true, sortOrder: 7, metadata: iaMeta('5.1') },
  { questionText: 'Breathing action plan', questionType: A, sortOrder: 8, metadata: iaMeta('5.2', { fieldKey: 'breathingActionPlan' }) },
  { questionText: 'Pain / distress options', questionType: M, isRequired: true, sortOrder: 9, options: PAIN_DISTRESS_OPTIONS, metadata: iaMeta('5.3', { fieldKey: 'painConcerns' }) },
  { questionText: 'Pain or distress identified?', questionType: Y, riskFlag: true, carePlanTrigger: true, sortOrder: 10, metadata: iaMeta('5.3') },
  { questionText: 'Pain location', questionType: T, sortOrder: 11, metadata: iaMeta('5.3', whenYes('pain or distress identified')) },
  { questionText: 'Pain score (0-10)', questionType: N, sortOrder: 12, metadata: iaMeta('5.3', whenYes('pain or distress identified')) },
  { questionText: 'Pain trigger / aggravating factors', questionType: A, sortOrder: 13, metadata: iaMeta('5.3', whenYes('pain or distress identified')) },
  { questionText: 'Current pain relief', questionType: A, sortOrder: 14, metadata: iaMeta('5.3', whenYes('pain or distress identified')) },
  { questionText: 'Pain assessment completed?', questionType: Y, sortOrder: 15, metadata: iaMeta('5.3') },
  { questionText: 'Pain assessment date', questionType: D, sortOrder: 16, metadata: iaMeta('5.3', whenYes('pain assessment completed')) },
  { questionText: 'What pain management plan in place', questionType: A, sortOrder: 175, metadata: iaMeta('5.3', { fieldKey: 'painManagementPlan', ...whenYes('pain or distress identified') }) },
  { questionText: 'Swallowing concern options', questionType: M, isRequired: true, sortOrder: 18, options: SWALLOWING_CONCERN_OPTIONS, metadata: iaMeta('5.4', { fieldKey: 'swallowingConcerns' }) },
  { questionText: 'Swallowing or choking concerns?', questionType: Y, riskFlag: true, carePlanTrigger: true, sortOrder: 19, metadata: iaMeta('5.4') },
  { questionText: 'Choking history details', questionType: A, sortOrder: 20, metadata: iaMeta('5.4', whenYes('swallowing or choking concerns')) },
  {
    questionText: 'What does choking occur with?',
    questionType: M,
    sortOrder: 201,
    options: CHOKING_OCCURS_WITH_OPTIONS,
    metadata: iaMeta('5.4', { fieldKey: 'chokingOccursWith', ...whenYes('swallowing or choking concerns') }),
  },
  {
    questionText: 'How frequently does choking occur?',
    questionType: S,
    sortOrder: 202,
    options: CHOKING_FREQUENCY_OPTIONS,
    metadata: iaMeta('5.4', { fieldKey: 'chokingFrequency', ...whenYes('swallowing or choking concerns') }),
  },
  {
    questionText: 'What positioning or supervision is required for swallowing or choking?',
    questionType: A,
    sortOrder: 203,
    metadata: iaMeta('5.4', { fieldKey: 'chokingPositioningSupervision', ...whenYes('swallowing or choking concerns') }),
  },
  {
    questionText: 'Is the choking or rescue first aid plan known to staff?',
    questionType: Y,
    sortOrder: 204,
    metadata: iaMeta('5.4', { fieldKey: 'chokingRescuePlanKnownToStaff', ...whenYes('swallowing or choking concerns') }),
  },
  { questionText: 'Food texture requirement', questionType: S, sortOrder: 21, options: FOOD_TEXTURE_OPTIONS, metadata: iaMeta('5.4', { fieldKey: 'foodTexture' }) },
  { questionText: 'Fluid thickness requirement', questionType: S, sortOrder: 22, options: FLUID_THICKNESS_OPTIONS, metadata: iaMeta('5.4', { fieldKey: 'fluidThickness' }) },
  { questionText: 'Swallowing action plan', questionType: A, sortOrder: 23, metadata: iaMeta('5.4', whenYes('swallowing or choking concerns')) },
  { questionText: 'SALT referral required?', questionType: Y, carePlanTrigger: true, sortOrder: 24, metadata: iaMeta('5.4', whenYes('swallowing or choking concerns')) },
  { questionText: 'SALT referral made?', questionType: Y, sortOrder: 25, metadata: iaMeta('5.4', whenYes('salt referral required')) },
  { questionText: 'SALT referral date', questionType: D, sortOrder: 26, metadata: iaMeta('5.4', whenYes('salt referral made')) },
];

export const SECTION_6_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'No concerns identified in this section', questionType: Y, sortOrder: 0, helpText: 'Select Yes if nutrition and hydration are satisfactory.', metadata: iaMeta('6.0', { noConcernMaster: true }) },
  { questionText: 'Requires aids for eating or drinking?', questionType: Y, isRequired: true, sortOrder: 1, metadata: iaMeta('6.1') },
  { questionText: 'Enterally fed?', questionType: Y, carePlanTrigger: true, sortOrder: 2, metadata: iaMeta('6.1') },
  { questionText: 'Eating / drinking equipment details', questionType: A, sortOrder: 3, metadata: iaMeta('6.1', whenYes('requires aids for eating or drinking')) },
  { questionText: 'Assistance level for eating and drinking', questionType: S, sortOrder: 4, options: ASSISTANCE_LEVEL_OPTIONS, metadata: iaMeta('6.1', { fieldKey: 'eatingAssistanceLevel' }) },
  { questionText: 'Eating / drinking routine or state', questionType: T, sortOrder: 5, helpText: 'Paper “Any routine state” — describe usual eating/drinking routine if relevant.', metadata: iaMeta('6.1') },
  { questionText: 'Appetite status', questionType: M, isRequired: true, sortOrder: 6, options: APPETITE_CONCERN_OPTIONS, metadata: iaMeta('6.2', { fieldKey: 'appetiteStatus' }) },
  { questionText: 'Appetite concern (poor appetite)?', questionType: Y, carePlanTrigger: true, sortOrder: 7, metadata: iaMeta('6.2') },
  { questionText: 'GP review requested for appetite or nutrition?', questionType: Y, carePlanTrigger: true, sortOrder: 8, metadata: iaMeta('6.2', { fieldKey: 'gpReviewAppetite' }) },
  { questionText: 'Adequately hydrated?', questionType: Y, isRequired: true, sortOrder: 9, metadata: iaMeta('6.3', { fieldKey: 'adequatelyHydrated' }) },
  { questionText: 'Hydration comment', questionType: A, sortOrder: 10, metadata: iaMeta('6.3', whenNo('adequately hydrated')) },
  { questionText: 'Daily fluid target (ml)', questionType: N, sortOrder: 11, metadata: iaMeta('6.3') },
  { questionText: 'Nutrition status', questionType: S, isRequired: true, sortOrder: 14, options: NUTRITION_STATUS_OPTIONS, metadata: iaMeta('6.4', { fieldKey: 'nutritionStatus' }) },
  { questionText: 'Malnourished or at nutrition risk?', questionType: Y, riskFlag: true, carePlanTrigger: true, sortOrder: 15, metadata: iaMeta('6.4') },
  { questionText: 'BMI completed?', questionType: Y, sortOrder: 16, metadata: iaMeta('6.8') },
  { questionText: 'BMI value', questionType: N, sortOrder: 17, metadata: iaMeta('6.8', whenYes('bmi completed')) },
  { questionText: 'MUST assessment completed?', questionType: Y, sortOrder: 18, metadata: iaMeta('6.9') },
  { questionText: 'MUST score', questionType: N, sortOrder: 19, metadata: iaMeta('6.9', whenYes('must assessment completed')) },
  { questionText: 'Nutritional supplements prescribed?', questionType: Y, sortOrder: 25, metadata: iaMeta('6.6', { fieldKey: 'nutritionalSupplementsPrescribed' }) },
  { questionText: 'Dietitian referral made or required?', questionType: Y, carePlanTrigger: true, sortOrder: 26, metadata: iaMeta('6.4', { fieldKey: 'dietitianReferralRequired' }) },
  { questionText: 'Dietitian referral date', questionType: D, sortOrder: 27, metadata: iaMeta('6.10', whenYes('dietitian referral')) },
  { questionText: 'Nutrition / hydration comments', questionType: A, sortOrder: 29, metadata: iaMeta('6.3') },
];

export const SECTION_7_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'No concerns identified in this section', questionType: Y, sortOrder: 0, helpText: 'Select Yes if oral health and continence are satisfactory.', metadata: iaMeta('7.0', { noConcernMaster: true }) },
  { questionText: 'Oral health options', questionType: M, isRequired: true, sortOrder: 1, options: ORAL_HEALTH_OPTIONS, metadata: iaMeta('7.1', { fieldKey: 'oralHealthOptions' }) },
  { questionText: 'Oral health concern?', questionType: Y, carePlanTrigger: true, sortOrder: 2, metadata: iaMeta('7.1', { fieldKey: 'oralHealthConcern' }) },
  {
    questionText: 'Mouth-care routine or support required',
    questionType: A,
    sortOrder: 21,
    metadata: iaMeta('7.1', { fieldKey: 'mouthCareSupportRoutine', ...whenYes('oral health concern') }),
  },
  {
    questionText: 'Last dental contact known?',
    questionType: Y,
    sortOrder: 22,
    metadata: iaMeta('7.1', { fieldKey: 'lastDentalContactKnown', ...whenYes('oral health concern') }),
  },
  {
    questionText: 'Last dental contact date',
    questionType: D,
    sortOrder: 23,
    metadata: iaMeta('7.1', { fieldKey: 'lastDentalContactDate', ...whenFieldYes('lastDentalContactKnown') }),
  },
  { questionText: 'Dentures fit well?', questionType: S, sortOrder: 3, options: YES_NO_UNKNOWN_OPTIONS, metadata: iaMeta('7.2') },
  { questionText: 'Denture cleaning support required?', questionType: Y, sortOrder: 4, metadata: iaMeta('7.2') },
  { questionText: 'Toothbrushing support required?', questionType: Y, sortOrder: 5, metadata: iaMeta('7.2') },
  { questionText: 'Dental referral required?', questionType: Y, carePlanTrigger: true, sortOrder: 6, metadata: iaMeta('7.2') },
  { questionText: 'Bladder continence options', questionType: M, isRequired: true, sortOrder: 7, options: BLADDER_CONTINENCE_OPTIONS, metadata: iaMeta('7.3', { fieldKey: 'bladderContinenceOptions' }) },
  { questionText: 'Bladder continence concern?', questionType: Y, carePlanTrigger: true, sortOrder: 8, metadata: iaMeta('7.3') },
  { questionText: 'Continence products in use?', questionType: Y, sortOrder: 9, metadata: iaMeta('7.4') },
  { questionText: 'Continence product details', questionType: A, sortOrder: 10, metadata: iaMeta('7.4', whenYes('continence products in use')) },
  { questionText: 'Pads supplied by family?', questionType: Y, sortOrder: 11, metadata: iaMeta('7.4') },
  { questionText: 'Pads supplied by district nurses?', questionType: Y, sortOrder: 12, metadata: iaMeta('7.4') },
  { questionText: 'Urgency?', questionType: Y, sortOrder: 13, metadata: iaMeta('7.4') },
  { questionText: 'Doubly incontinent?', questionType: Y, riskFlag: true, sortOrder: 14, metadata: iaMeta('7.4') },
  { questionText: 'Catheter in situ?', questionType: Y, carePlanTrigger: true, sortOrder: 15, metadata: iaMeta('7.4') },
  { questionText: 'Catheter type and care instructions', questionType: A, sortOrder: 16, metadata: iaMeta('7.4', whenYes('catheter in situ')) },
  { questionText: 'Urostomy or stoma present?', questionType: Y, carePlanTrigger: true, sortOrder: 17, metadata: iaMeta('7.4') },
  { questionText: 'Bowel continence options', questionType: M, isRequired: true, sortOrder: 18, options: BOWEL_CONTINENCE_OPTIONS, metadata: iaMeta('7.5', { fieldKey: 'bowelContinenceOptions' }) },
  { questionText: 'Bowel continence concern?', questionType: Y, carePlanTrigger: true, sortOrder: 19, metadata: iaMeta('7.5') },
  { questionText: 'Stoma care instructions', questionType: A, sortOrder: 20, metadata: iaMeta('7.6', whenYes('urostomy or stoma present')) },
  { questionText: 'Continence service referral required?', questionType: Y, carePlanTrigger: true, sortOrder: 21, metadata: iaMeta('7.3') },
  { questionText: 'Continence referral date', questionType: D, sortOrder: 22, metadata: iaMeta('7.3', whenYes('continence service referral required')) },
  { questionText: 'Continence / oral care notes', questionType: A, sortOrder: 23, metadata: iaMeta('7.1') },
];

export const SECTION_8_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'No concerns identified in this section', questionType: Y, sortOrder: 0, helpText: 'Select Yes if communication and sensory needs are satisfactory.', metadata: iaMeta('8.0', { noConcernMaster: true }) },
  { questionText: 'Speech impairment options', questionType: M, isRequired: true, sortOrder: 1, options: SPEECH_IMPAIRMENT_OPTIONS, metadata: iaMeta('8.1', { fieldKey: 'speechOptions' }) },
  { questionText: 'Speech impairment or concern?', questionType: Y, carePlanTrigger: true, sortOrder: 2, metadata: iaMeta('8.1') },
  {
    questionText: 'Staff communication instructions',
    questionType: A,
    sortOrder: 3,
    metadata: iaMeta('8.1', { fieldKey: 'staffCommunicationInstructions', ...whenYes('speech impairment or concern') }),
  },
  { questionText: 'Under SALT for communication?', questionType: Y, sortOrder: 4, metadata: iaMeta('8.2', whenYes('speech impairment or concern')) },
  { questionText: 'SALT communication referral required?', questionType: Y, carePlanTrigger: true, sortOrder: 5, metadata: iaMeta('8.2') },
  { questionText: 'Communication SALT referral date', questionType: D, sortOrder: 6, metadata: iaMeta('8.2', whenYes('salt communication referral required')) },
  { questionText: 'Hearing impairment level', questionType: S, isRequired: true, sortOrder: 7, options: HEARING_IMPAIRMENT_OPTIONS, metadata: iaMeta('8.3', { fieldKey: 'hearingLevel' }) },
  { questionText: 'Hearing impairment (moderate or worse)?', questionType: Y, carePlanTrigger: true, sortOrder: 8, metadata: iaMeta('8.3') },
  { questionText: 'Hearing aid in use?', questionType: Y, sortOrder: 9, metadata: iaMeta('8.3', whenYes('hearing impairment')) },
  { questionText: 'Hearing aid details', questionType: A, sortOrder: 10, metadata: iaMeta('8.3', whenYes('hearing aid in use')) },
  { questionText: 'Sight impairment level', questionType: S, isRequired: true, sortOrder: 11, options: SIGHT_IMPAIRMENT_OPTIONS, metadata: iaMeta('8.4', { fieldKey: 'sightLevel' }) },
  { questionText: 'Sight impairment (moderate or worse)?', questionType: Y, carePlanTrigger: true, sortOrder: 12, metadata: iaMeta('8.4') },
  { questionText: 'Glasses or visual aids in use?', questionType: Y, sortOrder: 13, metadata: iaMeta('8.4', whenYes('sight impairment')) },
  { questionText: 'Visual aid details', questionType: A, sortOrder: 14, metadata: iaMeta('8.4', whenYes('glasses or visual aids in use')) },
  { questionText: 'Professional interpreter needed?', questionType: Y, sortOrder: 17, metadata: iaMeta('8.5', whenYes('interpreter required')) },
  // Visual aid in use? removed — duplicate of Glasses or visual aids in use?
  { questionText: 'Sign language required?', questionType: Y, sortOrder: 19, metadata: iaMeta('8.6', { syncKey: 'signLanguageRequired' }) },
  { questionText: 'Auditory aid in use?', questionType: Y, sortOrder: 20, metadata: iaMeta('8.6') },
  { questionText: 'Communication aids functioning correctly?', questionType: Y, sortOrder: 21, metadata: iaMeta('8.6') },
  { questionText: 'Other communication aid — specify', questionType: T, sortOrder: 22, metadata: iaMeta('8.6') },
  { questionText: 'Communication support notes', questionType: A, sortOrder: 23, metadata: iaMeta('8.1') },
];

const CARER_MEDICATION_LEVELS = ['level_1a', 'level_1b', 'level_2a', 'level_2b'];
const whenCarersSupportMedicines = {
  showWhen: { gateFieldKey: 'medicationSupportLevel', selectedIncludes: CARER_MEDICATION_LEVELS },
};

/** §9.6 Managing medicines — ordering, storage, PRN, time-critical, specialist administration, refusal. */
export const IA_MEDICATION_MANAGEMENT_QUESTIONS: EnterpriseQuestionSeed[] = [
  {
    questionText: 'Who orders repeat prescriptions?',
    questionType: S,
    sortOrder: 70,
    options: MEDICATION_ORDERING_BY_OPTIONS,
    metadata: iaMeta('9.6', { fieldKey: 'medicationOrderingBy', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Who collects the medicines, or are they delivered?',
    questionType: S,
    sortOrder: 71,
    options: MEDICATION_COLLECTION_BY_OPTIONS,
    metadata: iaMeta('9.6', { fieldKey: 'medicationCollectionBy', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'How are medicines stored?',
    questionType: M,
    sortOrder: 72,
    options: MEDICATION_STORAGE_OPTIONS,
    metadata: iaMeta('9.6', { fieldKey: 'medicationStorage', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Storage details — where, and who holds any key',
    questionType: A,
    sortOrder: 73,
    metadata: iaMeta('9.6', {
      fieldKey: 'medicationStorageDetails',
      showWhen: { gateFieldKey: 'medicationStorage', selectedIncludes: ['restricted', 'controlled_drugs', 'other'] },
    }),
  },
  {
    questionText: 'Any "when required" (PRN) medicines?',
    questionType: Y,
    sortOrder: 74,
    metadata: iaMeta('9.6', { fieldKey: 'prnMedicationInUse', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'PRN — what for, how the person asks or shows they need it, and the maximum dose',
    questionType: A,
    isRequired: true,
    sortOrder: 75,
    metadata: iaMeta('9.6', { fieldKey: 'prnMedicationDetails', ...whenFieldYes('prnMedicationInUse') }),
  },
  {
    questionText: 'Any time-critical medicines (e.g. for Parkinson\'s, epilepsy or diabetes)?',
    questionType: Y,
    sortOrder: 76,
    metadata: iaMeta('9.6', { fieldKey: 'timeCriticalMedication', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Time-critical medicines — which, and the latest safe time for each',
    questionType: A,
    isRequired: true,
    sortOrder: 77,
    metadata: iaMeta('9.6', { fieldKey: 'timeCriticalMedicationDetails', ...whenFieldYes('timeCriticalMedication') }),
  },
  {
    questionText: 'Any injections, patches, inhalers, eye drops or other specialist administration?',
    questionType: Y,
    sortOrder: 78,
    metadata: iaMeta('9.6', { fieldKey: 'specialistAdministration', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Specialist administration — what, and who gives it (e.g. district nurse, carer trained for a delegated task)',
    questionType: A,
    isRequired: true,
    sortOrder: 79,
    metadata: iaMeta('9.6', { fieldKey: 'specialistAdministrationDetails', ...whenFieldYes('specialistAdministration') }),
  },
  {
    questionText: 'If a dose is refused, missed, dropped or wrong — what carers do and who they tell',
    questionType: A,
    isRequired: true,
    sortOrder: 80,
    helpText: 'e.g. record on the MAR, do not force or hide it, ring the office; call the GP / 111 for time-critical medicines.',
    metadata: iaMeta('9.6', { fieldKey: 'medicationRefusalEscalation', ...whenCarersSupportMedicines }),
  },
];

export const SECTION_9_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'Taking prescribed medication?', questionType: Y, isRequired: true, sortOrder: 1, metadata: iaMeta('9.1', { fieldKey: 'takingPrescribedMedication' }) },
  { questionText: 'Knows why they take prescribed medication?', questionType: S, sortOrder: 2, options: MEDICATION_AWARENESS_OPTIONS, metadata: iaMeta('9.1', whenYes('taking prescribed medication')) },
  { questionText: 'Knows when to take prescribed medication?', questionType: S, sortOrder: 3, options: MEDICATION_AWARENESS_OPTIONS, metadata: iaMeta('9.1', whenYes('taking prescribed medication')) },
  { questionText: 'Knows how to take prescribed medication?', questionType: S, sortOrder: 4, options: MEDICATION_AWARENESS_OPTIONS, metadata: iaMeta('9.1', whenYes('taking prescribed medication')) },
  {
    questionText: 'Recommended medication support level',
    questionType: S,
    isRequired: true,
    sortOrder: 10,
    helpText:
      'What carers do with medicines. Prompt = remind only. Assist = help, the person stays in control. Administer = carers give them (trained staff, MAR). Provided by others = carers give none.',
    options: MEDICATION_SUPPORT_LEVEL_OPTIONS,
    metadata: iaMeta('9.2', { fieldKey: 'medicationSupportLevel', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Medication administered by',
    questionType: S,
    sortOrder: 14,
    options: MEDICATION_ADMINISTERED_BY_OPTIONS,
    metadata: iaMeta('9.2', { fieldKey: 'medicationAdministeredBy', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Insulin administration required?',
    questionType: Y,
    sortOrder: 30,
    metadata: iaMeta('9.3', { fieldKey: 'insulinAdministrationRequired', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Insulin prompting required?',
    questionType: Y,
    sortOrder: 31,
    metadata: iaMeta('9.3', { fieldKey: 'insulinPromptingRequired', ...whenFieldYes('insulinAdministrationRequired') }),
  },
  {
    questionText: 'Insulin supervision required?',
    questionType: Y,
    sortOrder: 32,
    metadata: iaMeta('9.3', { fieldKey: 'insulinSupervisionRequired', ...whenFieldYes('insulinAdministrationRequired') }),
  },
  {
    questionText: 'Covert medication required?',
    questionType: Y,
    sortOrder: 33,
    helpText:
      'Only after a capacity assessment for this decision finds the person lacks capacity, a best-interests decision with the prescriber and pharmacist, and a written covert plan. Record the capacity assessment on the Mental Capacity tab.',
    metadata: iaMeta('9.3', { fieldKey: 'covertMedicationRequired', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Covert medication legal basis or best-interest notes',
    questionType: A,
    sortOrder: 34,
    metadata: iaMeta('9.3', { fieldKey: 'covertMedicationLegalBasis', ...whenFieldYes('covertMedicationRequired') }),
  },
  {
    questionText: 'Controlled drugs in use?',
    questionType: Y,
    sortOrder: 35,
    metadata: iaMeta('9.3', { fieldKey: 'controlledDrugsInUse', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Controlled drugs — which, and how they are stored and recorded',
    questionType: A,
    isRequired: true,
    sortOrder: 36,
    metadata: iaMeta('9.3', { fieldKey: 'controlledDrugsDetails', ...whenFieldYes('controlledDrugsInUse') }),
  },
  {
    questionText: 'Medication list available?',
    questionType: Y,
    sortOrder: 50,
    metadata: iaMeta('9.4', { fieldKey: 'medicationListAvailable', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Medication list verified?',
    questionType: Y,
    sortOrder: 51,
    metadata: iaMeta('9.4', { fieldKey: 'medicationListVerified', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Date medication list verified',
    questionType: D,
    sortOrder: 52,
    metadata: iaMeta('9.4', { fieldKey: 'medicationListVerifiedDate', ...whenFieldYes('medicationListVerified') }),
  },
  {
    questionText: 'Dispensing method',
    questionType: S,
    sortOrder: 60,
    options: MEDICATION_DISPENSING_METHOD_OPTIONS,
    metadata: iaMeta('9.5', { fieldKey: 'medicationDispensingMethod', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'MAR / eMAR required?',
    questionType: Y,
    sortOrder: 61,
    metadata: iaMeta('9.5', { fieldKey: 'emarRequired', ...whenYes('taking prescribed medication') }),
  },
  {
    questionText: 'Medication safety notes',
    questionType: A,
    sortOrder: 62,
    metadata: iaMeta('9.5', { fieldKey: 'medicationSafetyNotes', ...whenYes('taking prescribed medication') }),
  },
  ...IA_MEDICATION_MANAGEMENT_QUESTIONS,
];

export const SECTION_10_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'No concerns identified in this section', questionType: Y, sortOrder: 0, helpText: 'Select Yes if emotional health and cognition are satisfactory.', metadata: iaMeta('10.0', { noConcernMaster: true }) },
  { questionText: 'Current mental health issues reported?', questionType: Y, carePlanTrigger: true, sortOrder: 1, metadata: iaMeta('10.1') },
  { questionText: 'Current mental health details', questionType: A, sortOrder: 2, metadata: iaMeta('10.1', whenYes('current mental health issues reported')) },
  { questionText: 'Community Psychiatric Nurse involved?', questionType: S, sortOrder: 3, options: YES_NO_UNKNOWN_OPTIONS, metadata: iaMeta('10.1') },
  { questionText: 'CPN name and contact', questionType: A, sortOrder: 4, metadata: iaMeta('10.1', whenYes('community psychiatric nurse involved')) },
  { questionText: 'Previous mental health issues reported?', questionType: Y, sortOrder: 5, metadata: iaMeta('10.1') },
  { questionText: 'Emotional health comments', questionType: A, sortOrder: 6, metadata: iaMeta('10.1') },
  { questionText: 'Emotional wellbeing status', questionType: S, isRequired: true, sortOrder: 7, options: EMOTIONAL_WELLBEING_OPTIONS, metadata: iaMeta('10.2', { fieldKey: 'emotionalWellbeing' }) },
  { questionText: 'Feels depressed?', questionType: Y, riskFlag: true, sortOrder: 9, metadata: iaMeta('10.2', { fieldKey: 'feelsDepressed' }) },
  { questionText: 'Low mood or depression concern?', questionType: Y, riskFlag: true, carePlanTrigger: true, sortOrder: 10, metadata: iaMeta('10.2') },
  { questionText: 'Sleeping pattern', questionType: S, isRequired: true, sortOrder: 11, options: SLEEPING_PATTERN_OPTIONS, metadata: iaMeta('10.4', { fieldKey: 'sleepingPattern' }) },
  { questionText: 'Sleeping pattern concern?', questionType: Y, carePlanTrigger: true, sortOrder: 12, metadata: iaMeta('10.4') },
  { questionText: 'Sleep medication prescribed or OTC?', questionType: Y, sortOrder: 13, metadata: iaMeta('10.10') },
  { questionText: 'GP referral for sleep concern requested?', questionType: Y, carePlanTrigger: true, sortOrder: 14, metadata: iaMeta('10.4') },
  { questionText: 'GP referral for sleep concern made?', questionType: Y, sortOrder: 15, metadata: iaMeta('10.4', whenYes('gp referral for sleep concern requested')) },
  { questionText: 'GP referral for sleep concern date', questionType: D, sortOrder: 16, metadata: iaMeta('10.4', whenYes('gp referral for sleep concern made')) },
  { questionText: 'GP referral for mental health requested?', questionType: Y, carePlanTrigger: true, sortOrder: 17, metadata: iaMeta('10.5') },
  { questionText: 'GP referral for mental health made?', questionType: Y, sortOrder: 18, metadata: iaMeta('10.5', whenYes('gp referral for mental health requested')) },
  { questionText: 'GP referral date', questionType: D, sortOrder: 19, metadata: iaMeta('10.5', whenYes('gp referral for mental health made')) },
  { questionText: 'Cognitive impairment level', questionType: S, sortOrder: 20, options: { options: [{ value: 'none', label: 'No concern / need identified' }, { value: 'mild', label: 'Mild cognitive impairment' }, { value: 'moderate', label: 'Moderate cognitive impairment' }, { value: 'severe', label: 'Severe cognitive impairment' }] }, metadata: iaMeta('10.6', { fieldKey: 'cognitiveImpairment' }) },
  { questionText: 'Diagnosed dementia?', questionType: Y, carePlanTrigger: true, sortOrder: 21, metadata: iaMeta('10.6a', { fieldKey: 'diagnosedDementia' }) },
  {
    questionText: 'Wandering or exit-seeking?',
    questionType: Y,
    sortOrder: 211,
    metadata: iaMeta('10.6a', { fieldKey: 'wanderingOrExitSeeking', ...whenYes('diagnosed dementia') }),
  },
  {
    questionText: 'Wandering or exit-seeking support needed',
    questionType: A,
    sortOrder: 212,
    metadata: iaMeta('10.6a', { fieldKey: 'wanderingSupportNotes', ...whenFieldYes('wanderingOrExitSeeking') }),
  },
  { questionText: 'Learning disability?', questionType: Y, sortOrder: 22, metadata: iaMeta('10.6a') },
  { questionText: 'Ever had a brain injury?', questionType: Y, sortOrder: 23, metadata: iaMeta('10.6a') },
  { questionText: 'Good long-term memory recall?', questionType: Y, sortOrder: 24, metadata: iaMeta('10.6a') },
  { questionText: 'Good short-term memory recall?', questionType: Y, sortOrder: 25, metadata: iaMeta('10.6a') },
  { questionText: 'Able to follow basic instructions?', questionType: Y, sortOrder: 26, metadata: iaMeta('10.6a') },
  { questionText: 'Challenging behaviour or agitation with change?', questionType: Y, riskFlag: true, sortOrder: 28, metadata: iaMeta('10.6a') },
  { questionText: 'Fully orientated?', questionType: Y, sortOrder: 29, metadata: iaMeta('10.6a') },
  { questionText: 'AMT completed?', questionType: Y, sortOrder: 31, metadata: iaMeta('10.7') },
  { questionText: 'AMT score', questionType: N, sortOrder: 32, metadata: iaMeta('10.7', whenYes('amt completed')) },
  { questionText: 'AMT date', questionType: D, sortOrder: 33, metadata: iaMeta('10.7', whenYes('amt completed')) },
  // MCA required lives on Consent §2.5 (fieldKey mcaRequired) — Tab 3 master; do not re-ask on cognition.
  { questionText: 'GP referral for cognition requested?', questionType: Y, carePlanTrigger: true, sortOrder: 35, metadata: iaMeta('10.6', { fieldKey: 'cognitionGpReferralRequested' }) },
  { questionText: 'GP referral for cognition made?', questionType: Y, sortOrder: 36, metadata: iaMeta('10.6', whenYes('gp referral for cognition requested')) },
  { questionText: 'GP referral for cognition date', questionType: D, sortOrder: 37, metadata: iaMeta('10.6', whenYes('gp referral for cognition made')) },
];
