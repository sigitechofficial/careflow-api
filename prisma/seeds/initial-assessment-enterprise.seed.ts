import { InitialAssessmentQuestionType, PrismaClient } from '@prisma/client';
import { seedInitialAssessmentLegacyCatalog } from './initial-assessment-legacy-catalog.seed';
import {
  pruneSection311ActiveExtras,
  purgeSection311FlooringQuestions,
} from './initial-assessment-section-311.seed';
import { pruneSection310ActiveExtras } from './initial-assessment-section-310.seed';
import { pruneSection35AccessDuplicates } from './initial-assessment-section-3-access.seed';
import { pruneSection38ActiveExtras } from './initial-assessment-section-38-pets.seed';
import { pruneSection5ActiveExtras } from './initial-assessment-section-5-clinical.seed';
import { pruneSection6ActiveExtras } from './initial-assessment-section-6-nutrition.seed';
import { pruneSection12ActiveExtras } from './initial-assessment-section-12-mobility.seed';
import { pruneSection10ActiveExtras } from './initial-assessment-section-10-mental-health.seed';
import {
  pruneSection1ActiveExtras,
  pruneSection4ActiveExtras,
  pruneSection7ActiveExtras,
  pruneSection8ActiveExtras,
  pruneSection9ActiveExtras,
  pruneSection11ActiveExtras,
  pruneSection13ActiveExtras,
} from './initial-assessment-sections-phase1-prune.seed';
import { SECTION_4_QUESTIONS } from './initial-assessment-enterprise-section-4.seed';
import {
  ASSESSMENT_REASON_OPTIONS,
  CAR_PARKING_LIKELIHOOD_OPTIONS,
  CAR_PARKING_SEVERITY_OPTIONS,
  REVIEW_FREQUENCY_OPTIONS,
} from './initial-assessment-enterprise-options';
import { whenFieldYes } from './initial-assessment-enterprise-metadata';
import {
  SECTION_5_QUESTIONS,
  SECTION_6_QUESTIONS,
  SECTION_7_QUESTIONS,
  SECTION_8_QUESTIONS,
  SECTION_9_QUESTIONS,
  SECTION_10_QUESTIONS,
  type EnterpriseQuestionSeed,
} from './initial-assessment-enterprise-sections-5-10.seed';
import { HOLISTIC_SECTION_1_EXTRA_QUESTIONS } from './initial-assessment-holistic-section-1.seed';
import { MCA_SCREENING_QUESTIONS } from './initial-assessment-mca-screening.seed';
import {
  SECTION_11_QUESTIONS,
  SECTION_12_QUESTIONS,
  SECTION_13_QUESTIONS,
  SECTION_14_EXTRA_QUESTIONS,
  SECTION_14_TAIL_QUESTIONS,
} from './initial-assessment-enterprise-sections-11-14.seed';

type QuestionSeed = {
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

type SectionSeed = {
  sectionNumber: number;
  title: string;
  description?: string;
  carePlanArea?: string;
  questions: QuestionSeed[];
};

const CHECKBOX = InitialAssessmentQuestionType.CHECKBOX;
const TEXT = InitialAssessmentQuestionType.TEXT;
const TEXTAREA = InitialAssessmentQuestionType.TEXTAREA;
const YES_NO = InitialAssessmentQuestionType.YES_NO;
const NUMBER = InitialAssessmentQuestionType.NUMBER;
const DATE = InitialAssessmentQuestionType.DATE;
const SINGLE_SELECT = InitialAssessmentQuestionType.SINGLE_SELECT;
const MULTI_SELECT = InitialAssessmentQuestionType.MULTI_SELECT;

const ASSESSMENT_LOCATION_OPTIONS = {
  options: [
    { value: 'home', label: 'Home' },
    { value: 'hospital', label: 'Hospital' },
    { value: 'phone', label: 'Phone' },
    { value: 'video', label: 'Video call' },
    { value: 'other', label: 'Other' },
  ],
};

const SECTION_14_HEAD_QUESTIONS: EnterpriseQuestionSeed[] = [
  {
    questionText: 'Assessment reason',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 1,
    options: ASSESSMENT_REASON_OPTIONS,
    helpText: 'Why this assessment is being completed (audit and CQC evidence).',
    metadata: { specRef: '14.1', fieldKey: 'assessmentReason' },
  },
  {
    questionText: 'Assessment date',
    questionType: DATE,
    isRequired: true,
    sortOrder: 2,
    metadata: { specRef: '14.1', fieldKey: 'assessmentDate' },
  },
  {
    questionText: 'Next review date',
    questionType: DATE,
    isRequired: true,
    sortOrder: 3,
    helpText: 'Submission is blocked if this date is missing.',
    metadata: { specRef: '14.1', fieldKey: 'nextReviewDate' },
  },
  {
    questionText: 'Review frequency',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 4,
    options: REVIEW_FREQUENCY_OPTIONS,
    metadata: { specRef: '14.1', fieldKey: 'reviewFrequency' },
  },
  {
    questionText: 'Responsible reviewer (name or role)',
    questionType: TEXT,
    isRequired: true,
    sortOrder: 5,
    metadata: { specRef: '14.1', fieldKey: 'responsibleReviewer' },
  },
  {
    questionText: 'Service User agrees with assessment?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 6,
    metadata: { specRef: '14.6' },
  },
];

const SECTION_14_QUESTIONS: EnterpriseQuestionSeed[] = [
  ...SECTION_14_HEAD_QUESTIONS,
  ...SECTION_14_EXTRA_QUESTIONS,
  ...SECTION_14_TAIL_QUESTIONS,
];

function asQuestionSeeds(rows: EnterpriseQuestionSeed[]): QuestionSeed[] {
  return rows as QuestionSeed[];
}

const FUNDING_TYPE_OPTIONS = {
  options: [
    { value: 'private', label: 'Private' },
    { value: 'local_authority', label: 'Local Authority' },
    { value: 'nhs', label: 'NHS' },
    { value: 'direct_payment', label: 'Direct Payment' },
    { value: 'self_funded', label: 'Self Funded' },
    { value: 'mixed', label: 'Mixed Funding' },
    { value: 'unknown', label: 'Unknown at assessment stage' },
  ],
};

const REFERRAL_SOURCE_OPTIONS = {
  options: [
    { value: 'local_authority', label: 'Local authority' },
    { value: 'nhs', label: 'NHS' },
    { value: 'family', label: 'Family' },
    { value: 'self_referral', label: 'Self referral' },
    { value: 'hospital_discharge', label: 'Hospital discharge' },
    { value: 'gp', label: 'GP' },
    { value: 'other', label: 'Other' },
  ],
};

const GENDER_OPTIONS = {
  options: [
    { value: 'female', label: 'Female' },
    { value: 'male', label: 'Male' },
    { value: 'non_binary', label: 'Non-binary' },
    { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    { value: 'other', label: 'Other' },
  ],
};

const COMMUNICATION_FORMAT_OPTIONS = {
  options: [
    { value: 'spoken', label: 'Spoken' },
    { value: 'written', label: 'Written' },
    { value: 'easy_read', label: 'Easy read' },
    { value: 'large_print', label: 'Large print' },
    { value: 'mixed', label: 'Mixed formats' },
  ],
};

const STAFF_GENDER_PREFERENCE_OPTIONS = {
  options: [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'no_preference', label: 'No preference' },
    { value: 'case_by_case', label: 'Case by case' },
  ],
};

const CONSENT_GIVEN_BY_OPTIONS = {
  options: [
    { value: 'service_user', label: 'Service User' },
    { value: 'representative', label: 'Representative' },
    { value: 'best_interest', label: 'Best interest process' },
    { value: 'lpa', label: 'LPA / attorney' },
  ],
};

/** UX display order for Â§1: 1.1â†’1.8 then 1.0 (specRef unchanged in metadata). */
export const SECTION_1_QUESTIONS: QuestionSeed[] = [
  // 1.1 â€” Who they are
  { questionText: 'Preferred name', questionType: TEXT, isRequired: true, sortOrder: 1, metadata: { specRef: '1.1', prefillKey: 'preferredName' } },
  { questionText: 'Date of birth', questionType: DATE, isRequired: true, sortOrder: 2, metadata: { specRef: '1.1', prefillKey: 'dateOfBirth' } },
  {
    questionText: 'Gender',
    questionType: SINGLE_SELECT,
    sortOrder: 3,
    options: GENDER_OPTIONS,
    metadata: { specRef: '1.1', prefillKey: 'gender' },
  },
  { questionText: 'Address and contact details', questionType: TEXTAREA, sortOrder: 4, metadata: { specRef: '1.1', prefillKey: 'addressContact' } },
  {
    questionText: 'Funding type',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 5,
    options: FUNDING_TYPE_OPTIONS,
    metadata: { specRef: '1.1', fieldKey: 'fundingType' },
  },
  {
    questionText: 'Referral source',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 6,
    options: REFERRAL_SOURCE_OPTIONS,
    metadata: { specRef: '1.1', fieldKey: 'referralSource' },
  },
  {
    questionText: 'Assessment location',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 7,
    options: ASSESSMENT_LOCATION_OPTIONS,
    metadata: { specRef: '1.1', fieldKey: 'assessmentLocation' },
  },
  { questionText: 'Local authority ID (if funded)', questionType: TEXT, sortOrder: 8, metadata: { specRef: '1.1' } },
  // 1.2
  { questionText: 'Family, representative, next of kin, advocate, key contacts', questionType: TEXTAREA, sortOrder: 9, metadata: { specRef: '1.2', prefillKey: 'emergencyContact' } },
  { questionText: 'Representative involved in assessment?', questionType: YES_NO, isRequired: true, sortOrder: 10, metadata: { specRef: '1.2', syncKey: 'representativeInvolved' } },
  { questionText: 'Representative name', questionType: TEXT, sortOrder: 11, metadata: { specRef: '1.2', syncKey: 'representativeName', showWhen: { gateTextIncludes: 'representative involved', yes: true } } },
  { questionText: 'Representative relationship', questionType: TEXT, sortOrder: 12, metadata: { specRef: '1.2', syncKey: 'representativeRelationship' } },
  // 1.3 â€” Person-centred
  { questionText: 'What matters most to the Service User?', questionType: TEXTAREA, isRequired: true, carePlanTrigger: true, sortOrder: 13, metadata: { specRef: '1.3', fieldKey: 'whatMattersMost' } },
  { questionText: 'What are they worried about?', questionType: TEXTAREA, sortOrder: 14, metadata: { specRef: '1.3' } },
  { questionText: 'What do they want support to achieve?', questionType: TEXTAREA, isRequired: true, carePlanTrigger: true, sortOrder: 15, metadata: { specRef: '1.3', fieldKey: 'supportGoals' } },
  { questionText: 'Personal priorities, goals, independence goals', questionType: TEXTAREA, carePlanTrigger: true, sortOrder: 16, metadata: { specRef: '1.3', prefillKey: 'aboutMePriorities' } },
  { questionText: 'Things they want to keep doing independently', questionType: TEXTAREA, sortOrder: 17, metadata: { specRef: '1.3' } },
  { questionText: 'Things they do not want support with', questionType: TEXTAREA, sortOrder: 18, metadata: { specRef: '1.3' } },
  { questionText: 'Important routines (meals, prayer, medication, bedtime)', questionType: TEXTAREA, isRequired: true, sortOrder: 19, metadata: { specRef: '1.3' } },
  {
    questionText: 'Preferred visit times',
    questionType: MULTI_SELECT,
    sortOrder: 20,
    metadata: {
      specRef: '1.3',
      fieldKey: 'preferredVisitTimes',
      optionsLookup: 'medication_administration_rounds',
    },
  },
  // 1.4
  { questionText: 'Morning, meal, evening and bedtime routine', questionType: TEXTAREA, isRequired: true, sortOrder: 21, metadata: { specRef: '1.4', prefillKey: 'aboutMeRoutine' } },
  { questionText: 'Bathing / shower and dressing preferences', questionType: TEXTAREA, sortOrder: 22, metadata: { specRef: '1.4' } },
  { questionText: 'Known triggers (anxiety, distress, confusion)', questionType: TEXTAREA, carePlanTrigger: true, sortOrder: 23, metadata: { specRef: '1.4' } },
  // 1.5
  { questionText: 'Food likes and dislikes', questionType: TEXTAREA, sortOrder: 24, metadata: { specRef: '1.5', prefillKey: 'foodLikes', syncKey: 'foodLikes' } },
  { questionText: 'Activity likes and dislikes', questionType: TEXTAREA, sortOrder: 25, metadata: { specRef: '1.5', prefillKey: 'activityLikes' } },
  { questionText: 'Care preferences and dislikes', questionType: TEXTAREA, sortOrder: 26, metadata: { specRef: '1.5' } },
  // 1.6
  { questionText: 'How should staff support privacy during personal care?', questionType: TEXTAREA, sortOrder: 27, metadata: { specRef: '1.6' } },
  {
    questionText: 'Staff gender preference for personal care',
    questionType: SINGLE_SELECT,
    sortOrder: 28,
    options: STAFF_GENDER_PREFERENCE_OPTIONS,
    metadata: { specRef: '1.6' },
  },
  { questionText: 'Will the Service User accept care from the opposite sex?', questionType: YES_NO, sortOrder: 29, metadata: { specRef: '1.6' } },
  { questionText: 'Comfortable with double-up care?', questionType: YES_NO, sortOrder: 30, metadata: { specRef: '1.6' } },
  { questionText: 'Modesty requirements', questionType: TEXTAREA, sortOrder: 31, metadata: { specRef: '1.6' } },
  { questionText: 'How does the person prefer to be addressed?', questionType: TEXT, isRequired: true, sortOrder: 32, metadata: { specRef: '1.6', prefillKey: 'preferredName' } },
  // 1.7
  { questionText: 'Religion, culture, language, reasonable adjustments', questionType: TEXTAREA, sortOrder: 33, metadata: { specRef: '1.7', prefillKey: 'culture' } },
  { questionText: 'Religious or spiritual needs', questionType: TEXTAREA, sortOrder: 34, metadata: { specRef: '1.7' } },
  { questionText: 'Prayer routine or worship needs', questionType: TEXTAREA, sortOrder: 35, metadata: { specRef: '1.7' } },
  { questionText: 'Religious or cultural dietary requirements', questionType: TEXTAREA, sortOrder: 36, metadata: { specRef: '1.7', syncKey: 'religiousDiet' } },
  { questionText: 'Any equality related risk or need', questionType: TEXTAREA, sortOrder: 37, metadata: { specRef: '1.7' } },
  // 1.8
  {
    questionText: 'Preferred communication format',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 38,
    options: COMMUNICATION_FORMAT_OPTIONS,
    metadata: { specRef: '1.8' },
  },
  { questionText: 'Interpreter required?', questionType: YES_NO, isRequired: true, sortOrder: 39, metadata: { specRef: '1.8', syncKey: 'interpreterRequired' } },
  { questionText: 'Language required', questionType: TEXT, sortOrder: 40, metadata: { specRef: '1.8', prefillKey: 'language', syncKey: 'languageRequired' } },
  { questionText: 'Easy read or large print required?', questionType: YES_NO, sortOrder: 41, metadata: { specRef: '1.8' } },
  { questionText: 'BSL required?', questionType: YES_NO, sortOrder: 42, metadata: { specRef: '1.8' } },
  { questionText: 'Hearing support required?', questionType: YES_NO, sortOrder: 43, metadata: { specRef: '1.8' } },
  { questionText: 'Visual support required?', questionType: YES_NO, sortOrder: 44, metadata: { specRef: '1.8' } },
  // 1.0 â€” Care starting context (last in Â§1)
  { questionText: 'Reason for admission / starting care', questionType: TEXTAREA, isRequired: true, sortOrder: 45, metadata: { specRef: '1.0' } },
  { questionText: 'Previous medical history (summary)', questionType: TEXTAREA, sortOrder: 46, metadata: { specRef: '1.0' } },
  { questionText: 'Care instructions for staff', questionType: TEXTAREA, sortOrder: 47, metadata: { specRef: '1.0', prefillKey: 'careInstructions', syncKey: 'accessInstructions' } },
  { questionText: 'Planned number of carers', questionType: NUMBER, isRequired: true, sortOrder: 48, metadata: { specRef: '1.0', prefillKey: 'plannedCarers' } },
  { questionText: 'Carer numbers / rota note', questionType: TEXTAREA, sortOrder: 49, metadata: { specRef: '1.0' } },
];

/** 14-section enterprise template aligned with canvas-types/initial-assessment-checklist.md */
export const ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS: SectionSeed[] = [
  {
    sectionNumber: 1,
    title: 'Personal Details & Preferences',
    carePlanArea: 'Person Centred',
    description: 'Â§1 â€” person first (1.1â†’1.8 then 1.0). Door codes in Â§3 only.',
    questions: [...SECTION_1_QUESTIONS, ...HOLISTIC_SECTION_1_EXTRA_QUESTIONS],
  },
  {
    sectionNumber: 2,
    title: 'Consent, Capacity and Information Sharing',
    carePlanArea: 'Consent',
    description: 'Spec Â§2 â€” consent, MCA, best interest, sharing',
    questions: [
      { questionText: 'Has the Service User consented to this assessment?', questionType: YES_NO, isRequired: true, sortOrder: 1, metadata: { specRef: '2.1' } },
      {
        questionText: 'Consent given by',
        questionType: SINGLE_SELECT,
        isRequired: true,
        sortOrder: 2,
        options: CONSENT_GIVEN_BY_OPTIONS,
        metadata: { specRef: '2.1', fieldKey: 'consentGivenBy' },
      },
      { questionText: 'Has the Service User consented to receive care and support?', questionType: YES_NO, isRequired: true, sortOrder: 3, metadata: { specRef: '2.2' } },
      { questionText: 'Information explained in a way they understand?', questionType: YES_NO, isRequired: true, sortOrder: 4, metadata: { specRef: '2.3' } },
      { questionText: 'Capacity to consent to assessment appears intact?', questionType: YES_NO, isRequired: true, sortOrder: 5, metadata: { specRef: '2.4' } },
      { questionText: 'MCA required?', questionType: YES_NO, isRequired: true, sortOrder: 6, metadata: { specRef: '2.5' } },
      { questionText: 'MCA completed?', questionType: YES_NO, sortOrder: 7, metadata: { specRef: '2.5' } },
      { questionText: 'Best interest decision required?', questionType: YES_NO, sortOrder: 8, metadata: { specRef: '2.6' } },
      { questionText: 'Best interest decision details', questionType: TEXTAREA, sortOrder: 9, metadata: { specRef: '2.6' } },
      { questionText: 'Family, LPA, deputy, appointee, advocate involvement', questionType: TEXTAREA, sortOrder: 10, metadata: { specRef: '2.7' } },
      { questionText: 'Consent to share with GP', questionType: YES_NO, isRequired: true, sortOrder: 11, metadata: { specRef: '2.8' } },
      { questionText: 'Consent to share with family', questionType: YES_NO, isRequired: true, sortOrder: 12, metadata: { specRef: '2.8' } },
      { questionText: 'Consent to share with pharmacy', questionType: YES_NO, sortOrder: 13, metadata: { specRef: '2.8' } },
      { questionText: 'Consent to share with local authority', questionType: YES_NO, sortOrder: 14, metadata: { specRef: '2.8' } },
      ...MCA_SCREENING_QUESTIONS,
    ],
  },
  {
    sectionNumber: 3,
    title: 'Environmental / Home Safety',
    carePlanArea: 'Environment',
    description: 'Spec Â§3 â€” fire, access, environment checklist, flooring, pets',
    questions: [
      { questionText: 'Any fire safety risks identified?', questionType: YES_NO, isRequired: true, riskFlag: true, sortOrder: 1, metadata: { specRef: '3.1' } },
      { questionText: 'London Fire Brigade informed?', questionType: YES_NO, isRequired: true, sortOrder: 2, metadata: { specRef: '3.2' } },
      { questionText: 'London Fire Brigade contact details', questionType: TEXT, sortOrder: 3, metadata: { specRef: '3.2' } },
      { questionText: 'Can Service User manage home environment safely?', questionType: YES_NO, isRequired: true, sortOrder: 4, metadata: { specRef: '3.3' } },
      { questionText: 'Measures needed if home is unsafe', questionType: TEXTAREA, sortOrder: 5, metadata: { specRef: '3.4' } },
      { questionText: 'Access instructions for staff', questionType: TEXTAREA, isRequired: true, sortOrder: 6, metadata: { specRef: '3.5', fieldKey: 'accessInstructions', prefillKey: 'accessInstruction', syncKey: 'accessInstructions' } },
      { questionText: 'Key safe present?', questionType: YES_NO, sortOrder: 7, metadata: { specRef: '3.5', fieldKey: 'keySafePresent' } },
      { questionText: 'Door entry code (secure — from DOM Care)', questionType: TEXT, sortOrder: 8, metadata: { specRef: '3.5', fieldKey: 'doorCode', prefillKey: 'doorCode', secureField: true } },
      { questionText: 'Key safe code', questionType: TEXT, sortOrder: 10, metadata: { specRef: '3.6', fieldKey: 'keySafeCode', secureField: true } },
      { questionText: 'Key safe location', questionType: TEXT, sortOrder: 9, metadata: { specRef: '3.6', fieldKey: 'keySafeLocation' } },
      { questionText: 'Trip hazards identified?', questionType: YES_NO, sortOrder: 10, metadata: { specRef: '3.7' } },
      { questionText: 'Poor lighting?', questionType: YES_NO, sortOrder: 11, metadata: { specRef: '3.7' } },
      { questionText: 'Heating risk?', questionType: YES_NO, sortOrder: 12, metadata: { specRef: '3.7' } },
      { questionText: 'Pets present?', questionType: YES_NO, sortOrder: 13, metadata: { specRef: '3.8', fieldKey: 'petsPresent' } },
      {
        questionText: 'Pets secured during visits?',
        questionType: YES_NO,
        sortOrder: 14,
        metadata: { specRef: '3.8', fieldKey: 'petsSecuredDuringVisits', ...whenFieldYes('petsPresent') },
      },
      { questionText: 'Smoking in property?', questionType: YES_NO, sortOrder: 15, metadata: { specRef: '3.8', fieldKey: 'smokingInProperty' } },
      {
        questionText: 'Pet infestation or hygiene risk?',
        questionType: YES_NO,
        sortOrder: 16,
        metadata: { specRef: '3.8', fieldKey: 'petInfestationRisk', ...whenFieldYes('petsPresent') },
      },
      { questionText: 'Lone worker risk identified?', questionType: YES_NO, isRequired: true, riskFlag: true, sortOrder: 17, metadata: { specRef: '3.9' } },
      { questionText: 'Staff safety instructions', questionType: TEXTAREA, sortOrder: 18, metadata: { specRef: '3.9' } },
      { questionText: 'Smoke alarm fitted and working?', questionType: YES_NO, sortOrder: 19, metadata: { specRef: '3.10' } },
      {
        questionText: 'Referral required for smoke, CO or fire alarm?',
        questionType: YES_NO,
        carePlanTrigger: true,
        sortOrder: 20,
        metadata: { specRef: '3.10' },
      },
      { questionText: 'Steps or uneven access at entrance?', questionType: YES_NO, sortOrder: 21, metadata: { specRef: '3.10' } },
      { questionText: 'Level access throughout the property?', questionType: YES_NO, sortOrder: 22, metadata: { specRef: '3.10' } },
      { questionText: 'Hoarding or clutter risk?', questionType: YES_NO, riskFlag: true, sortOrder: 23, metadata: { specRef: '3.10' } },
      { questionText: 'Environment / access hazard notes', questionType: TEXTAREA, sortOrder: 24, metadata: { specRef: '3.10' } },
      { questionText: 'Rugs or worn carpet (flooring risk)?', questionType: YES_NO, sortOrder: 25, metadata: { specRef: '3.11' } },
      { questionText: 'Worn carpet on stairs?', questionType: YES_NO, sortOrder: 26, metadata: { specRef: '3.11' } },
      {
        questionText: 'Car parking arrangements when visiting my home',
        questionType: TEXTAREA,
        helpText:
          'Describe where staff can park, restrictions, and anything they should know before arriving (e.g. no roadside parking, permit zones, bus route).',
        sortOrder: 27,
        metadata: { specRef: '3.12', fieldKey: 'carParkingArrangements' },
      },
      {
        questionText: 'Roadside parking available near the home?',
        questionType: YES_NO,
        sortOrder: 28,
        metadata: { specRef: '3.12', fieldKey: 'roadsideParkingAvailable' },
      },
      {
        questionText:
          'Likelihood of harm from car parking at my home (without control measures in place)',
        questionType: SINGLE_SELECT,
        options: CAR_PARKING_LIKELIHOOD_OPTIONS,
        sortOrder: 29,
        metadata: { specRef: '3.12', fieldKey: 'carParkingHarmLikelihood', riskMatrixScore: true },
      },
      {
        questionText: 'How serious could the harm from car parking be?',
        questionType: SINGLE_SELECT,
        options: CAR_PARKING_SEVERITY_OPTIONS,
        sortOrder: 30,
        metadata: { specRef: '3.12', fieldKey: 'carParkingHarmSeverity', riskMatrixScore: true },
      },
      {
        questionText: 'Control measures and actions to reduce car parking harm',
        questionType: TEXTAREA,
        helpText:
          'e.g. familiarise yourself with your route; check safety when opening car doors; take care when manoeuvring your vehicle.',
        carePlanTrigger: true,
        sortOrder: 31,
        metadata: { specRef: '3.12', fieldKey: 'carParkingControlMeasures' },
      },
      {
        questionText: 'Other car parking risks or considerations for staff',
        questionType: TEXTAREA,
        sortOrder: 32,
        metadata: { specRef: '3.12', fieldKey: 'carParkingOtherRisks' },
      },
    ],
  },
  {
    sectionNumber: 4,
    title: 'Physical Assessment / Vital Signs',
    carePlanArea: 'Physical Health',
    description: 'Spec Â§4 â€” vitals, build, monitoring, wellbeing',
    questions: asQuestionSeeds(SECTION_4_QUESTIONS),
  },
  {
    sectionNumber: 5,
    title: 'Breathing, Distress/Pain & Swallowing',
    carePlanArea: 'Respiratory',
    description: 'Spec Â§5 â€” structured multi-select options + legacy catalog',
    questions: asQuestionSeeds(SECTION_5_QUESTIONS),
  },
  {
    sectionNumber: 6,
    title: 'Eating, Drinking, Nutrition and Hydration',
    carePlanArea: 'Nutrition',
    description: 'Spec Â§6',
    questions: asQuestionSeeds(SECTION_6_QUESTIONS),
  },
  {
    sectionNumber: 7,
    title: 'Oral Health and Continence',
    carePlanArea: 'Continence',
    description: 'Spec Â§7',
    questions: asQuestionSeeds(SECTION_7_QUESTIONS),
  },
  {
    sectionNumber: 8,
    title: 'Communication and Sensory Needs',
    carePlanArea: 'Communication',
    description: 'Spec Â§8',
    questions: asQuestionSeeds(SECTION_8_QUESTIONS),
  },
  {
    sectionNumber: 9,
    title: 'Medication Support and Medication Safety',
    carePlanArea: 'Medication',
    description: 'Spec Â§9',
    questions: asQuestionSeeds(SECTION_9_QUESTIONS),
  },
  {
    sectionNumber: 10,
    title: 'Emotional Health, Mental Health and Cognition',
    carePlanArea: 'Mental Health',
    description: 'Spec Â§10 â€” includes Â§10.6a legacy cognitive checklist',
    questions: asQuestionSeeds(SECTION_10_QUESTIONS),
  },
  {
    sectionNumber: 11,
    title: 'Skin Integrity',
    carePlanArea: 'Skin Integrity',
    description: 'Spec §11 — skin, wounds, pressure equipment (Waterlow scoring on separate tab)',
    questions: asQuestionSeeds(SECTION_11_QUESTIONS),
  },
  {
    sectionNumber: 12,
    title: 'Mobility, ADL and Practical Support',
    carePlanArea: 'Mobility',
    description: 'Spec Â§12 â€” Â§12.5aâ€“12.8a transfers, amputation, equipment',
    questions: asQuestionSeeds(SECTION_12_QUESTIONS),
  },
  {
    sectionNumber: 13,
    title: 'Safeguarding, Emergency and Risk Management',
    carePlanArea: 'Safeguarding',
    description: 'Spec Â§13 â€” safeguarding types, emergency, risk matrix stub',
    questions: asQuestionSeeds(SECTION_13_QUESTIONS),
  },
  {
    sectionNumber: 14,
    title: 'Review, Actions, Care Plans and Sign Off',
    carePlanArea: 'Governance',
    description: 'Spec Â§14 â€” governance, review schedule, sign-off',
    questions: asQuestionSeeds(SECTION_14_QUESTIONS),
  },
];
export const ENTERPRISE_TEMPLATE_NAME = 'Initial Assessment — Enterprise';
export const LEGACY_TEMPLATE_NAME = 'Initial Assessment Checklist';

export async function seedInitialAssessmentEnterprise(prisma: PrismaClient): Promise<void> {
  const legacy = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: LEGACY_TEMPLATE_NAME, deletedAt: null },
  });
  if (legacy?.isDefault) {
    await prisma.initialAssessmentTemplate.update({
      where: { id: legacy.id },
      data: { isDefault: false },
    });
  }

  let template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });

  if (!template) {
    template = await prisma.initialAssessmentTemplate.create({
      data: {
        name: ENTERPRISE_TEMPLATE_NAME,
        description:
          '14-section enterprise initial assessment (CQC-aligned). Replaces legacy 28-section checklist as default.',
        version: 7,
        isDefault: true,
        isActive: true,
      },
    });
  } else {
    await prisma.initialAssessmentTemplate.updateMany({
      where: { isDefault: true, id: { not: template.id }, deletedAt: null },
      data: { isDefault: false },
    });
    template = await prisma.initialAssessmentTemplate.update({
      where: { id: template.id },
      data: {
        description:
          '14-section enterprise initial assessment (CQC-aligned). Replaces legacy 28-section checklist as default.',
        version: 7,
        isDefault: true,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  const purged311 = await purgeSection311FlooringQuestions(prisma);
  if (purged311.questions > 0) {
    console.log(
      `[seed] Purged §3.11 flooring: ${purged311.questions} question(s), ${purged311.answers} answer(s).`,
    );
  }

  for (const section of ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS) {
    const sectionRow = await prisma.initialAssessmentSection.upsert({
      where: {
        templateId_sectionNumber: {
          templateId: template.id,
          sectionNumber: section.sectionNumber,
        },
      },
      update: {
        title: section.title,
        description: section.description ?? null,
        carePlanArea: section.carePlanArea ?? null,
        sortOrder: section.sectionNumber,
        isActive: true,
        deletedAt: null,
      },
      create: {
        templateId: template.id,
        sectionNumber: section.sectionNumber,
        title: section.title,
        description: section.description ?? null,
        carePlanArea: section.carePlanArea ?? null,
        sortOrder: section.sectionNumber,
      },
    });

    let sectionQuestions = await prisma.initialAssessmentQuestion.findMany({
      where: { sectionId: sectionRow.id, deletedAt: null },
      select: { id: true, questionText: true, metadata: true },
    });

    for (const q of section.questions) {
      const specRef =
        q.metadata &&
        typeof q.metadata === 'object' &&
        !Array.isArray(q.metadata) &&
        typeof (q.metadata as Record<string, unknown>).specRef === 'string'
          ? ((q.metadata as Record<string, unknown>).specRef as string)
          : null;

      const fieldKey =
        q.metadata &&
        typeof q.metadata === 'object' &&
        !Array.isArray(q.metadata) &&
        typeof (q.metadata as Record<string, unknown>).fieldKey === 'string'
          ? ((q.metadata as Record<string, unknown>).fieldKey as string)
          : null;

      const prefillKey =
        q.metadata &&
        typeof q.metadata === 'object' &&
        !Array.isArray(q.metadata) &&
        typeof (q.metadata as Record<string, unknown>).prefillKey === 'string'
          ? ((q.metadata as Record<string, unknown>).prefillKey as string)
          : null;

      const existing = sectionQuestions.find((row) => {
        if (row.questionText === q.questionText) return true;
        if (!specRef || !row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) {
          return false;
        }
        const rowMeta = row.metadata as Record<string, unknown>;
        if (rowMeta.specRef !== specRef) return false;
        if (fieldKey) return rowMeta.fieldKey === fieldKey;
        if (prefillKey && rowMeta.prefillKey === prefillKey) return true;
        return false;
      });

      const data = {
        questionText: q.questionText,
        helpText: q.helpText ?? null,
        questionType: q.questionType ?? CHECKBOX,
        options: q.options ? (q.options as object) : undefined,
        isRequired: q.isRequired ?? false,
        riskFlag: q.riskFlag ?? false,
        carePlanTrigger: q.carePlanTrigger ?? false,
        sortOrder: q.sortOrder,
        metadata: q.metadata ? (q.metadata as object) : undefined,
        isActive: true,
      };
      if (existing) {
        await prisma.initialAssessmentQuestion.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await prisma.initialAssessmentQuestion.create({
          data: { sectionId: sectionRow.id, ...data },
        });
      }
    }
  }

  const legacyCount = await seedInitialAssessmentLegacyCatalog(prisma);
  if (legacyCount > 0) {
    console.log(`[seed] Imported ${legacyCount} legacy catalog questions into enterprise template.`);
  }

  const pruned311 = await pruneSection311ActiveExtras(prisma);
  if (pruned311 > 0) {
    console.log(`[seed] Pruned ${pruned311} non-canonical §3.11 flooring question(s).`);
  }

  const pruned310 = await pruneSection310ActiveExtras(prisma);
  if (pruned310 > 0) {
    console.log(`[seed] Pruned ${pruned310} non-canonical §3.10 environment question(s).`);
  }

  const pruned35 = await pruneSection35AccessDuplicates(prisma);
  if (pruned35 > 0) {
    console.log(`[seed] Pruned ${pruned35} duplicate §3.5 / §3.6 access question(s).`);
  }

  const pruned38 = await pruneSection38ActiveExtras(prisma);
  if (pruned38 > 0) {
    console.log(`[seed] Pruned ${pruned38} non-canonical §3.8 pets question(s).`);
  }

  const pruned5 = await pruneSection5ActiveExtras(prisma);
  if (pruned5 > 0) {
    console.log(`[seed] Pruned ${pruned5} non-canonical §5 breathing/pain/swallowing question(s).`);
  }

  const pruned6 = await pruneSection6ActiveExtras(prisma);
  if (pruned6 > 0) {
    console.log(`[seed] Pruned ${pruned6} non-canonical §6 nutrition/hydration question(s).`);
  }

  const pruned10 = await pruneSection10ActiveExtras(prisma);
  if (pruned10 > 0) {
    console.log(`[seed] Pruned ${pruned10} non-canonical §10 mental health/cognition question(s).`);
  }

  const phase1Prunes: Array<[string, () => Promise<number>]> = [
    ['§1 profile', () => pruneSection1ActiveExtras(prisma)],
    ['§4 vitals/build', () => pruneSection4ActiveExtras(prisma)],
    ['§7 continence', () => pruneSection7ActiveExtras(prisma)],
    ['§8 communication', () => pruneSection8ActiveExtras(prisma)],
    ['§9 medication', () => pruneSection9ActiveExtras(prisma)],
    ['§11 skin', () => pruneSection11ActiveExtras(prisma)],
    ['§13 safeguarding', () => pruneSection13ActiveExtras(prisma)],
  ];
  for (const [label, fn] of phase1Prunes) {
    const n = await fn();
    if (n > 0) console.log(`[seed] Pruned ${n} non-canonical ${label} question(s).`);
  }

  const pruned12 = await pruneSection12ActiveExtras(prisma);
  if (pruned12 > 0) {
    console.log(`[seed] Pruned ${pruned12} non-canonical §12 mobility/ADL question(s).`);
  }
}
