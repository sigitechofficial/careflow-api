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
import { pruneSection10ActiveExtras, migrateMcaRequiredFromCognitionDuplicate } from './initial-assessment-section-10-mental-health.seed';
import {
  pruneSection1ActiveExtras,
  pruneSection4ActiveExtras,
  pruneSection7ActiveExtras,
  pruneSection8ActiveExtras,
  pruneSection9ActiveExtras,
  pruneSection11ActiveExtras,
  pruneSection13ActiveExtras,
} from './initial-assessment-sections-phase1-prune.seed';
import { SECTION_4_QUESTIONS, remapDiabetesTypeHistoricalAnswers } from './initial-assessment-enterprise-section-4.seed';
import {
  ASSESSMENT_REASON_OPTIONS,
  CAR_PARKING_LIKELIHOOD_OPTIONS,
  CAR_PARKING_SEVERITY_OPTIONS,
  REVIEW_FREQUENCY_OPTIONS,
} from './initial-assessment-enterprise-options';
import { migrateSection31FireQuestions, rehomeFireSafetyQuestionsToSection18 } from './initial-assessment-section-31-fire.seed';
import { whenFieldYes, whenNo, whenYes } from './initial-assessment-enterprise-metadata';
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
import { ABOUT_ME_IA_QUESTIONS } from './initial-assessment-about-me.seed';
import { MCA_SCREENING_QUESTIONS } from './initial-assessment-mca-screening.seed';
import {
  SECTION_11_QUESTIONS,
  SECTION_12_QUESTIONS,
  SECTION_13_QUESTIONS,
  SECTION_14_EXTRA_QUESTIONS,
  SECTION_14_TAIL_QUESTIONS,
} from './initial-assessment-enterprise-sections-11-14.seed';
import {
  SECTION_15_QUESTIONS,
  SECTION_16_QUESTIONS,
  SECTION_17_QUESTIONS,
  SECTION_18_QUESTIONS,
} from './initial-assessment-enterprise-sections-15-18.seed';

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
  /** Earlier wording — lets a reworded question update its existing row instead of creating a duplicate. */
  formerQuestionTexts?: string[];
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

/**
 * Consent tab — the 12 consent questions in the order staff ask them (grouped into panels by specRef in
 * care-admin consent-capacity-steps). Capacity is presumed: §2.4 asks whether there is reason to *doubt*
 * it. Follow-up notes use `showWhen`. Keyed by fieldKey so `ia-template-cleanup` can align templates.
 */
/** §2.6 — MCA s4: the best-interests record must show the person's own views, never just the outcome. */
export const BEST_INTEREST_DETAILS_HELP =
  "Who decided and who was consulted; the person's wishes, feelings, beliefs and values (past and present); any objection or resistance and how it was weighed; less restrictive options considered; the outcome.";

const PURPOSE_EXPLAINED_FIELD_KEY = 'infoExplainedUnderstood';
const UNDERSTANDS_FIELD_KEY = 'understandsAssessmentInfo';
const CONSENT_TO_ASSESSMENT_FIELD_KEY = 'consentToAssessment';
const CONSENT_METHOD_FIELD_KEY = 'consentMethod';
const COMMUNICATION_SUPPORT_FIELD_KEY = 'communicationSupportRequired';
const FAMILY_INVOLVEMENT_FIELD_KEY = 'familyInvolvementConsent';
const INFO_SHARING_FIELD_KEY = 'infoSharingConsent';
const PARTIAL_REFUSAL_FIELD_KEY = 'partialConsentRefusal';
const CAPACITY_DOUBT_FIELD_KEY = 'capacityDoubt';
const LEGAL_AUTHORITY_FIELD_KEY = 'legalAuthority';

const showIfYes = (gateFieldKey: string) => ({ gateFieldKey, yes: true });
const showIfNo = (gateFieldKey: string) => ({ gateFieldKey, no: true });
const showIfSelected = (gateFieldKey: string, values: string[]) => ({ gateFieldKey, selectedIncludes: values });
const opts = (pairs: Array<[string, string]>) => ({ options: pairs.map(([value, label]) => ({ value, label })) });

export const IA_CONSENT_TAB_QUESTIONS: QuestionSeed[] = [
  // 1 — purpose explained
  {
    questionText: 'Has the purpose of this assessment been explained to the service user?',
    formerQuestionTexts: ['Information explained in a way they understand?'],
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 101,
    metadata: { specRef: '2.3', fieldKey: PURPOSE_EXPLAINED_FIELD_KEY },
  },
  {
    questionText: 'Reason / action required',
    formerQuestionTexts: ['Why not, and what is the next step?'],
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 103,
    metadata: {
      specRef: '2.3',
      fieldKey: 'infoNotUnderstoodNextStep',
      showWhen: showIfNo(PURPOSE_EXPLAINED_FIELD_KEY),
    },
  },
  // 2 — understanding
  {
    questionText: 'Does the service user understand the information provided about this assessment?',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 104,
    options: {
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
        { value: 'unsure', label: 'Unsure' },
      ],
    },
    metadata: { specRef: '2.3', fieldKey: UNDERSTANDS_FIELD_KEY, display: 'inline' },
  },
  {
    questionText: 'Please explain',
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 105,
    helpText: 'Not understanding may mean a Mental Capacity Assessment is needed.',
    metadata: {
      specRef: '2.3',
      fieldKey: 'understandsAssessmentInfoDetails',
      showWhen: showIfSelected(UNDERSTANDS_FIELD_KEY, ['no', 'unsure']),
    },
  },
  // 3 — consent to the IA
  {
    questionText: 'Does the service user consent to this Initial Assessment being carried out?',
    formerQuestionTexts: [
      'Consent to this assessment obtained?',
      'Has the Service User consented to this assessment?',
    ],
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 106,
    metadata: { specRef: '2.1', fieldKey: CONSENT_TO_ASSESSMENT_FIELD_KEY },
  },
  {
    questionText: 'Reason / comments',
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 107,
    metadata: {
      specRef: '2.1',
      fieldKey: 'consentToAssessmentNoReason',
      showWhen: showIfNo(CONSENT_TO_ASSESSMENT_FIELD_KEY),
    },
  },
  // 4 — how consent was given (only once they consent)
  {
    questionText: 'How was consent provided?',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 108,
    options: {
      options: [
        { value: 'written', label: 'Written' },
        { value: 'verbal', label: 'Verbal' },
        { value: 'non_verbal', label: 'Non-verbal / implied' },
        { value: 'other', label: 'Other' },
      ],
    },
    metadata: {
      specRef: '2.1',
      fieldKey: CONSENT_METHOD_FIELD_KEY,
      display: 'trailing',
      showWhen: showIfYes(CONSENT_TO_ASSESSMENT_FIELD_KEY),
    },
  },
  {
    questionText: 'How was consent provided — other',
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 109,
    metadata: {
      specRef: '2.1',
      fieldKey: 'consentMethodOther',
      showWhen: showIfSelected(CONSENT_METHOD_FIELD_KEY, ['other']),
    },
  },
  // 5 — communication support
  {
    questionText: 'Does the service user require support to understand information or communicate their decision?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 110,
    metadata: { specRef: '2.3', fieldKey: COMMUNICATION_SUPPORT_FIELD_KEY },
  },
  {
    questionText: 'What support is required?',
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 111,
    helpText: 'e.g. interpreter, BSL, visual aids, advocate, family support.',
    metadata: {
      specRef: '2.3',
      fieldKey: 'communicationSupportDetails',
      showWhen: showIfYes(COMMUNICATION_SUPPORT_FIELD_KEY),
    },
  },
  // 6 — family / representative involvement
  {
    questionText: 'Does the service user consent to family or representatives being involved in this assessment?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 112,
    metadata: { specRef: '2.8', fieldKey: FAMILY_INVOLVEMENT_FIELD_KEY, syncKey: 'representativeInvolved' },
  },
  {
    questionText: 'Representative name',
    questionType: TEXT,
    isRequired: true,
    sortOrder: 113,
    helpText: 'Shared with Personal Details — e.g. Sarah Thompson (main contact).',
    metadata: {
      specRef: '2.8',
      fieldKey: 'familyInvolvedName',
      syncKey: 'representativeName',
      showWhen: showIfYes(FAMILY_INVOLVEMENT_FIELD_KEY),
    },
  },
  {
    questionText: 'Relationship to the service user',
    questionType: TEXT,
    isRequired: true,
    sortOrder: 114,
    metadata: {
      specRef: '2.8',
      fieldKey: 'familyInvolvedRelationship',
      syncKey: 'representativeRelationship',
      showWhen: showIfYes(FAMILY_INVOLVEMENT_FIELD_KEY),
    },
  },
  // 7 — information sharing
  {
    questionText:
      'Does the service user consent to relevant information being shared with authorised people/professionals involved in their care?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 115,
    metadata: { specRef: '2.8', fieldKey: INFO_SHARING_FIELD_KEY },
  },
  {
    questionText: 'Who can information be shared with?',
    questionType: MULTI_SELECT,
    isRequired: true,
    sortOrder: 116,
    options: {
      options: [
        { value: 'gp', label: 'GP' },
        { value: 'district_nurse', label: 'District / community nurse' },
        { value: 'pharmacy', label: 'Pharmacy' },
        { value: 'hospital_ambulance', label: 'Hospital / ambulance' },
        { value: 'local_authority', label: 'Local authority / social worker' },
        { value: 'family_representatives', label: 'Family / representatives' },
        { value: 'other', label: 'Other' },
      ],
    },
    metadata: { specRef: '2.8', fieldKey: 'infoSharingWith', showWhen: showIfYes(INFO_SHARING_FIELD_KEY) },
  },
  {
    questionText: 'What information can be shared / any limits',
    questionType: TEXTAREA,
    sortOrder: 117,
    helpText: 'Include anyone chosen under “Other”.',
    metadata: { specRef: '2.8', fieldKey: 'infoSharingLimits', showWhen: showIfYes(INFO_SHARING_FIELD_KEY) },
  },
  {
    questionText: 'Restrictions / preferences',
    questionType: TEXTAREA,
    sortOrder: 118,
    metadata: { specRef: '2.8', fieldKey: 'infoSharingRestrictions', showWhen: showIfNo(INFO_SHARING_FIELD_KEY) },
  },
  // 8 — parts not consented to
  {
    questionText: 'Is there anything they do not consent to, or any conditions we must follow?',
    formerQuestionTexts: [
      'Are there any parts of the assessment or proposed care that the service user does not consent to?',
    ],
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 119,
    metadata: { specRef: '2.11', fieldKey: PARTIAL_REFUSAL_FIELD_KEY },
  },
  {
    questionText: 'Please specify what they do not consent to or the conditions to follow',
    formerQuestionTexts: ['Please specify what they do not consent to'],
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 120,
    metadata: { specRef: '2.11', fieldKey: 'partialConsentRefusalDetails', showWhen: showIfYes(PARTIAL_REFUSAL_FIELD_KEY) },
  },
  // 9 — reason to doubt capacity (capacity is presumed)
  {
    questionText: 'Is there any reason to doubt the service user’s capacity to make this specific decision?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 121,
    metadata: { specRef: '2.4', fieldKey: CAPACITY_DOUBT_FIELD_KEY },
  },
  {
    questionText: 'Reason for concern',
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 122,
    helpText: 'A Mental Capacity Assessment is then needed (MCA Screening tab).',
    metadata: { specRef: '2.4', fieldKey: 'capacityDoubtReason', showWhen: showIfYes(CAPACITY_DOUBT_FIELD_KEY) },
  },
  // 10 — legal authority for Health & Welfare decisions
  {
    questionText: 'Is anyone legally authorised to make relevant Health & Welfare decisions on their behalf?',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 123,
    options: {
      options: [
        { value: 'no', label: 'No' },
        { value: 'hw_lpa', label: 'Health & Welfare LPA' },
        { value: 'deputy', label: 'Court-appointed Deputy' },
        { value: 'court_order_other', label: 'Court Order / other legal authority' },
        { value: 'unsure', label: 'Unsure' },
      ],
    },
    metadata: { specRef: '2.4', fieldKey: LEGAL_AUTHORITY_FIELD_KEY, display: 'trailing' },
  },
  {
    questionText: 'Name',
    questionType: TEXT,
    isRequired: true,
    sortOrder: 124,
    metadata: {
      specRef: '2.4',
      fieldKey: 'legalAuthorityName',
      showWhen: showIfSelected(LEGAL_AUTHORITY_FIELD_KEY, ['hw_lpa', 'deputy', 'court_order_other']),
    },
  },
  {
    questionText: 'Relationship / role',
    questionType: TEXT,
    isRequired: true,
    sortOrder: 125,
    metadata: {
      specRef: '2.4',
      fieldKey: 'legalAuthorityRole',
      showWhen: showIfSelected(LEGAL_AUTHORITY_FIELD_KEY, ['hw_lpa', 'deputy', 'court_order_other']),
    },
  },
  {
    questionText: 'Evidence / document seen',
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 126,
    helpText: 'e.g. LPA registration / OPG check, court order reference. Upload the copy below.',
    metadata: {
      specRef: '2.4',
      fieldKey: 'legalAuthorityEvidence',
      showWhen: showIfSelected(LEGAL_AUTHORITY_FIELD_KEY, ['hw_lpa', 'deputy', 'court_order_other']),
    },
  },
  {
    questionText: 'What needs to be checked?',
    questionType: TEXTAREA,
    isRequired: true,
    sortOrder: 127,
    helpText: 'e.g. family mentioned an LPA — ask for a copy / check with the Office of the Public Guardian.',
    metadata: {
      specRef: '2.4',
      fieldKey: 'legalAuthorityUnsureNote',
      showWhen: showIfSelected(LEGAL_AUTHORITY_FIELD_KEY, ['unsure']),
    },
  },
];

/** Consent tab questions replaced by the list above — soft-deleted by `ia-template-cleanup` (answers kept). */
export const IA_CONSENT_TAB_RETIRED_FIELD_KEYS = [
  'infoExplainedHow',
  // merged into "anything they do not consent to, or conditions we must follow?"
  'consentRestrictions',
  'consentRestrictionsDetails',
  // assessor + date are recorded at sign-off (§14.8) and in the audit trail
  'consentRecordedByName',
  'consentRecordedByRole',
  'consentRecordedDate',
  'consentRecordedTime',
  // representative now asked once (name / relationship synced with Personal Details)
  'familyInvolvedWho',
  'familyInvolvementNoNote',
  'consentGivenBy',
  'capacityToConsentIntact',
  'consentShareWithFamily',
  'shareWithFamilyWho',
] as const;

/** UX display order for Â§1: 1.1â†’1.8 then 1.0 (specRef unchanged in metadata). */
/** §1.7 — non-religious culture / heritage (replaces the retired combined "Religion, culture, language…" field). */
export const IA_CULTURAL_BACKGROUND_QUESTION: QuestionSeed = {
  questionText: 'Cultural background and practices',
  questionType: TEXTAREA,
  sortOrder: 33,
  metadata: { specRef: '1.7', fieldKey: 'culturalBackground', prefillKey: 'aboutMe_whereIAmFrom' },
};

/**
 * §2.9 Deprivation of liberty — screening first, never a legal conclusion. Restrictions are recorded
 * in the Core IA (§2.9a, Personal Details → daily living); a concern goes to manager / legal review
 * and the legal route and status are recorded (Mental Capacity tab). Whether arrangements amount to
 * a deprivation of liberty is a multifactorial judgement for the commissioner / court
 * ([2026] UKSC 16) — no single factor (such as "supervision + not free to leave") decides it.
 * The four detail keys are unchanged, so saved authorisation details carry over.
 */
const DOL_RESTRICTIONS_FIELD_KEY = 'dolRestrictions';
const DOL_CONCERN_FIELD_KEY = 'dolConcern';
const DOL_STATUS_FIELD_KEY = 'dolAuthorisationStatus';
const DOL_AUTHORISED = ['authorised_cop', 'authorised_dols'];
/** Retired by the screening-first flow (answers kept; mapped to `dolAuthorisationStatus` on open IAs). */
export const IA_DOL_RETIRED_FIELD_KEYS = ['dolsLpsAuthorisationInPlace', 'dolAuthorisationType', 'dolReferredAwaiting'] as const;
export const IA_DEPRIVATION_OF_LIBERTY_QUESTIONS: QuestionSeed[] = [
  {
    questionText: "Will the proposed care involve any arrangements that restrict the person's movement, freedom or choices?",
    questionType: MULTI_SELECT,
    isRequired: true,
    sortOrder: 14,
    helpText:
      'Tick what applies. A normal key safe or door entry for carers is an access arrangement, not a restriction. A diagnosis on its own is never a restriction.',
    options: opts([
      ['none', 'No restrictions'],
      ['doors_locked_to_stop_leaving', 'Doors locked or keys withheld to stop the person leaving'],
      ['not_allowed_out_alone', 'Not allowed to go out alone'],
      ['continuous_supervision', 'Continuous supervision'],
      ['monitoring_controls_movement', 'Sensors / GPS / cameras used to control movement'],
      ['covert_medication', 'Covert medication'],
      ['sedating_medication', 'Medication given to calm or sedate'],
      ['bed_rails_or_belts', 'Bed rails or lap belts'],
      ['physical_intervention', 'Physical intervention or restraint'],
      ['restricted_contact', 'Restricted contact with others'],
      ['other', 'Other'],
    ]),
    metadata: { specRef: '2.9a', fieldKey: DOL_RESTRICTIONS_FIELD_KEY },
  },
  {
    questionText: 'Restrictions — what, when and why',
    questionType: TEXTAREA,
    sortOrder: 15,
    metadata: {
      specRef: '2.9a',
      fieldKey: 'dolRestrictionsDetails',
      showWhen: showIfSelected(DOL_RESTRICTIONS_FIELD_KEY, [
        'doors_locked_to_stop_leaving',
        'not_allowed_out_alone',
        'continuous_supervision',
        'monitoring_controls_movement',
        'covert_medication',
        'sedating_medication',
        'bed_rails_or_belts',
        'physical_intervention',
        'restricted_contact',
        'other',
      ]),
    },
  },
  {
    questionText: 'Could these arrangements potentially amount to a deprivation of liberty?',
    questionType: SINGLE_SELECT,
    sortOrder: 16,
    helpText:
      "Consider all the circumstances together: the type, duration, effect and manner of the restrictions, their purpose, the person's wishes and any objection, sedation, and how normal the arrangements are. No single factor decides it — raise any concern; it is not decided here.",
    options: opts([
      ['yes', 'Yes'],
      ['no', 'No'],
      ['unsure', 'Unsure'],
    ]),
    metadata: {
      specRef: '2.9',
      fieldKey: DOL_CONCERN_FIELD_KEY,
      showWhen: showIfSelected(DOL_RESTRICTIONS_FIELD_KEY, [
        'doors_locked_to_stop_leaving',
        'not_allowed_out_alone',
        'continuous_supervision',
        'monitoring_controls_movement',
        'covert_medication',
        'sedating_medication',
        'bed_rails_or_belts',
        'physical_intervention',
        'restricted_contact',
        'other',
      ]),
    },
  },
  {
    questionText: "Circumstances — how the restrictions affect the person, their purpose, and the person's wishes or objection",
    questionType: TEXTAREA,
    sortOrder: 17,
    metadata: { specRef: '2.9', fieldKey: 'dolCircumstances', showWhen: showIfSelected(DOL_CONCERN_FIELD_KEY, ['yes', 'unsure']) },
  },
  {
    questionText: 'Manager / legal review',
    questionType: SINGLE_SELECT,
    sortOrder: 18,
    options: opts([
      ['referred_manager', 'Referred to the manager'],
      ['referred_legal', 'Referred for legal advice'],
      ['reviewed', 'Reviewed — outcome recorded below'],
    ]),
    metadata: { specRef: '2.9', fieldKey: 'dolManagerReview', showWhen: showIfSelected(DOL_CONCERN_FIELD_KEY, ['yes', 'unsure']) },
  },
  {
    questionText: 'Review outcome and next steps',
    questionType: TEXTAREA,
    sortOrder: 19,
    metadata: { specRef: '2.9', fieldKey: 'dolReviewOutcome', showWhen: showIfSelected(DOL_CONCERN_FIELD_KEY, ['yes', 'unsure']) },
  },
  {
    questionText: 'Legal route and status',
    questionType: SINGLE_SELECT,
    sortOrder: 20,
    helpText:
      'Care at home or in supported living is authorised through the Court of Protection; DoLS covers care homes and hospitals only (for example during respite). The commissioning body usually applies.',
    options: opts([
      ['not_required_after_review', 'Not required after review'],
      ['raised_with_commissioner', 'Concern raised with the commissioning body'],
      ['application_made', 'Application made — awaiting decision'],
      ['authorised_cop', 'Authorised — Court of Protection order'],
      ['authorised_dols', 'Authorised — DoLS (care home or hospital stay)'],
      ['expired', 'Authorisation expired'],
      ['unknown', 'Not known — to be checked'],
    ]),
    metadata: { specRef: '2.9', fieldKey: DOL_STATUS_FIELD_KEY, showWhen: showIfSelected(DOL_CONCERN_FIELD_KEY, ['yes', 'unsure']) },
  },
  {
    questionText: 'Authorising body (court / local authority)',
    questionType: TEXT,
    sortOrder: 21,
    metadata: { specRef: '2.9', fieldKey: 'dolsAuthorisingBody', showWhen: showIfSelected(DOL_STATUS_FIELD_KEY, DOL_AUTHORISED) },
  },
  {
    questionText: 'Authorisation reference',
    questionType: TEXT,
    sortOrder: 22,
    metadata: { specRef: '2.9', fieldKey: 'dolsReference', showWhen: showIfSelected(DOL_STATUS_FIELD_KEY, DOL_AUTHORISED) },
  },
  {
    questionText: 'Authorisation expiry / review date',
    questionType: DATE,
    sortOrder: 23,
    metadata: { specRef: '2.9', fieldKey: 'dolsExpiryDate', showWhen: showIfSelected(DOL_STATUS_FIELD_KEY, DOL_AUTHORISED) },
  },
  {
    questionText: 'Conditions / restrictions carers must follow',
    questionType: TEXTAREA,
    sortOrder: 24,
    metadata: { specRef: '2.9', fieldKey: 'dolsDetails', showWhen: showIfSelected(DOL_STATUS_FIELD_KEY, DOL_AUTHORISED) },
  },
];

/**
 * §1.9 recent hospital stay, §1.10 social wellbeing, §1.11 smoking / alcohol / drugs — content a UK
 * home-care IA should capture that the template did not. Rendered on the Personal Details tab.
 */
export const IA_MISSING_CONTENT_SECTION_1_QUESTIONS: QuestionSeed[] = [
  // §1.9 Recent hospital stay
  {
    questionText: 'In hospital in the last 6 months?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 300,
    helpText: 'Set automatically when the referral source is hospital discharge.',
    metadata: { specRef: '1.9', fieldKey: 'recentHospitalStay' },
  },
  {
    questionText: 'Hospital, ward and reason for stay',
    questionType: TEXTAREA,
    sortOrder: 301,
    metadata: { specRef: '1.9', fieldKey: 'hospitalStayDetails', ...whenFieldYes('recentHospitalStay') },
  },
  {
    questionText: 'Discharge date',
    questionType: DATE,
    sortOrder: 302,
    metadata: { specRef: '1.9', fieldKey: 'hospitalDischargeDate', ...whenFieldYes('recentHospitalStay') },
  },
  {
    questionText: 'Discharge summary received?',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 303,
    options: opts([
      ['received', 'Received'],
      ['requested_awaited', 'Requested — awaited'],
      ['not_available', 'Not available'],
    ]),
    metadata: { specRef: '1.9', fieldKey: 'dischargeSummaryStatus', ...whenFieldYes('recentHospitalStay') },
  },
  {
    questionText: 'Follow-up needed after discharge',
    questionType: MULTI_SELECT,
    sortOrder: 304,
    options: opts([
      ['gp_review', 'GP review'],
      ['district_nurse', 'District / community nurse'],
      ['outpatient', 'Hospital outpatient appointment'],
      ['reablement', 'Reablement (physio / OT)'],
      ['medication_changes', 'Medication changes to check'],
      ['none', 'None'],
    ]),
    metadata: { specRef: '1.9', fieldKey: 'dischargeFollowUps', ...whenFieldYes('recentHospitalStay') },
  },
  {
    questionText: 'Hospital admissions in the last 12 months',
    questionType: NUMBER,
    sortOrder: 305,
    metadata: { specRef: '1.9', fieldKey: 'hospitalAdmissions12Months', ...whenFieldYes('recentHospitalStay') },
  },
  // §1.10 Social wellbeing (Care Act 2014 wellbeing)
  {
    questionText: 'How often does the person feel lonely?',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 310,
    helpText: 'ONS loneliness question — ask the person directly where possible.',
    options: opts([
      ['often_always', 'Often / always'],
      ['some_of_the_time', 'Some of the time'],
      ['occasionally', 'Occasionally'],
      ['hardly_ever', 'Hardly ever'],
      ['never', 'Never'],
      ['unable_to_say', 'Unable to say'],
    ]),
    metadata: { specRef: '1.10', fieldKey: 'lonelinessFrequency' },
  },
  {
    questionText: 'Contact with family or friends',
    questionType: SINGLE_SELECT,
    sortOrder: 311,
    options: opts([
      ['daily', 'Daily'],
      ['few_times_week', 'A few times a week'],
      ['weekly', 'Weekly'],
      ['less_than_weekly', 'Less than weekly'],
      ['rarely_never', 'Rarely / never'],
    ]),
    metadata: { specRef: '1.10', fieldKey: 'socialContactFrequency' },
  },
  {
    questionText: 'Would like support to be more socially connected?',
    questionType: YES_NO,
    carePlanTrigger: true,
    sortOrder: 312,
    metadata: { specRef: '1.10', fieldKey: 'wantsSocialConnectionSupport' },
  },
  {
    questionText: 'Support wanted (befriending, day centre, social prescribing)',
    questionType: TEXTAREA,
    sortOrder: 313,
    metadata: {
      specRef: '1.10',
      fieldKey: 'socialConnectionSupportDetails',
      ...whenFieldYes('wantsSocialConnectionSupport'),
    },
  },
  {
    questionText: 'Does the person care for anyone else (child, partner, relative)?',
    questionType: YES_NO,
    sortOrder: 314,
    metadata: { specRef: '1.10', fieldKey: 'caresForOthers' },
  },
  {
    questionText: 'Caring responsibilities — details',
    questionType: TEXTAREA,
    sortOrder: 315,
    metadata: { specRef: '1.10', fieldKey: 'caringResponsibilitiesDetails', ...whenFieldYes('caresForOthers') },
  },
  // §1.11 Smoking, alcohol and drugs (the person's own use)
  {
    questionText: 'Smoking status',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 320,
    helpText: 'Current smoker also records "Smoking in property" on the Fire Safety tab.',
    options: opts([
      ['never', 'Never smoked'],
      ['ex_smoker', 'Ex-smoker'],
      ['current_smoker', 'Current smoker'],
      ['vapes', 'Vapes / e-cigarettes'],
    ]),
    metadata: { specRef: '1.11', fieldKey: 'smokingStatus' },
  },
  {
    questionText: 'Alcohol use',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 321,
    options: opts([
      ['none', 'None'],
      ['occasional', 'Occasional'],
      ['within_guidelines', 'Regular — within guidelines'],
      ['above_14_units', 'Above 14 units a week'],
      ['concern_dependence', 'Concern / dependence'],
    ]),
    metadata: { specRef: '1.11', fieldKey: 'alcoholUse' },
  },
  {
    questionText: 'Non-prescribed or recreational drug use?',
    questionType: SINGLE_SELECT,
    sortOrder: 322,
    options: opts([
      ['no', 'No'],
      ['yes', 'Yes'],
      ['declined', 'Declined to say'],
    ]),
    metadata: { specRef: '1.11', fieldKey: 'recreationalDrugUse' },
  },
  {
    questionText: 'Substance use — support / plan notes',
    questionType: TEXTAREA,
    sortOrder: 323,
    helpText:
      'Complete when alcohol is above guidelines, there is a dependence concern or drug use — include any referral to a substance-misuse service.',
    metadata: { specRef: '1.11', fieldKey: 'substanceUseSupportNotes' },
  },
  // Specialist screening (Core IA): these answers decide whether ACP / End of Life are needed.
  {
    questionText: 'Would the person like to talk about their future care wishes now (advance care planning)?',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 330,
    helpText: 'Person-led: only "Yes, now" opens the Advance Care Planning tab. Nobody is pressed to discuss this.',
    options: opts([
      ['yes_now', 'Yes, now'],
      ['not_now', 'Not now — offer again later'],
      ['declined', 'Declined'],
      ['unable_now', 'Not able to take part now'],
    ]),
    metadata: { specRef: '1.3', fieldKey: 'acpDiscussionOffered' },
  },
  {
    questionText: 'Why is the person not able to take part now?',
    questionType: TEXTAREA,
    sortOrder: 331,
    helpText: 'For example, unwell or capacity for this decision in doubt — record who was consulted, if anyone.',
    metadata: { specRef: '1.3', fieldKey: 'acpUnableReason', showWhen: showIfSelected('acpDiscussionOffered', ['unable_now']) },
  },
  {
    questionText: 'Is palliative or end-of-life care currently relevant or documented by an appropriate healthcare professional?',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 332,
    helpText:
      'Answer from what the person, their GP / clinical team or their records say — the assessor does not decide this. Unsure creates a follow-up to check with the GP or clinical team.',
    options: opts([
      ['yes', 'Yes'],
      ['no', 'No'],
      ['unsure', 'Unsure — needs clinical clarification'],
    ]),
    metadata: { specRef: '1.0', fieldKey: 'eolRelevant' },
  },
  {
    questionText: 'End of life — who documented it / what needs clarifying',
    questionType: TEXTAREA,
    sortOrder: 333,
    metadata: { specRef: '1.0', fieldKey: 'eolRelevantDetails', showWhen: showIfSelected('eolRelevant', ['yes', 'unsure']) },
  },
];

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
    metadata: {
      specRef: '1.1',
      fieldKey: 'fundingType',
      optionsLookup: 'service_user_funding_types',
    },
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
  // "Representative involved?" is asked once, on the Consent tab (familyInvolvementConsent).
  { questionText: 'Representative name', questionType: TEXT, sortOrder: 11, metadata: { specRef: '1.2', syncKey: 'representativeName', showWhen: { gateFieldKey: 'familyInvolvementConsent', yes: true } } },
  { questionText: 'Representative relationship', questionType: TEXT, sortOrder: 12, metadata: { specRef: '1.2', syncKey: 'representativeRelationship', showWhen: { gateFieldKey: 'familyInvolvementConsent', yes: true } } },
  // 1.3 â€” Person-centred
  { questionText: 'What matters most to the Service User?', questionType: TEXTAREA, isRequired: true, carePlanTrigger: true, sortOrder: 13, metadata: { specRef: '1.3', fieldKey: 'whatMattersMost', prefillKey: 'aboutMe_whatIsMostImportantToMe' } },
  { questionText: 'What are they worried about?', questionType: TEXTAREA, sortOrder: 14, metadata: { specRef: '1.3' } },
  { questionText: 'What do they want support to achieve?', questionType: TEXTAREA, isRequired: true, carePlanTrigger: true, sortOrder: 15, metadata: { specRef: '1.3', fieldKey: 'supportGoals' } },
  // "Personal priorities, goals, independence goals" removed — duplicate of supportGoals (both had carePlanTrigger)
  { questionText: 'Things they want to keep doing independently', questionType: TEXTAREA, sortOrder: 17, metadata: { specRef: '1.3' } },
  { questionText: 'Things they do not want support with', questionType: TEXTAREA, sortOrder: 18, metadata: { specRef: '1.3' } },
  // "Important routines (meals, prayer, medication, bedtime)" removed — duplicate of 1.4 routine narrative
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
  // "Activity likes and dislikes" removed — covered by About Me Hobbies and interests / Activities
  // "Care preferences and dislikes" removed — covered by 1.6 privacy/gender/modesty + About Me happy/unhappy
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
  // 1.6 "How does the person prefer to be addressed?" removed — duplicate of 1.1 Preferred name
  // 1.7
  IA_CULTURAL_BACKGROUND_QUESTION,
  ...IA_MISSING_CONTENT_SECTION_1_QUESTIONS,
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
  { questionText: 'Language required', questionType: TEXT, sortOrder: 40, metadata: { specRef: '1.8', prefillKey: 'languageName', syncKey: 'languageRequired' } },
  { questionText: 'Easy read or large print required?', questionType: YES_NO, sortOrder: 41, metadata: { specRef: '1.8' } },
  // 1.8 BSL / Hearing support / Visual support removed — covered by §8.3–8.6 clinical fields
  // 1.0 â€” Care starting context (last in Â§1)
  { questionText: 'Reason for admission / starting care', questionType: TEXTAREA, isRequired: true, sortOrder: 45, metadata: { specRef: '1.0' } },
  { questionText: 'Previous medical history (summary)', questionType: TEXTAREA, sortOrder: 46, metadata: { specRef: '1.0' } },
  { questionText: 'Care instructions for staff', questionType: TEXTAREA, sortOrder: 47, metadata: { specRef: '1.0', fieldKey: 'careInstructions', prefillKey: 'careInstructions' } },
  // Not required: DOM Care / the visit plan own staffing; the manager decides double-up (not the IA).
  { questionText: 'Planned number of carers', questionType: NUMBER, sortOrder: 48, metadata: { specRef: '1.0', prefillKey: 'plannedCarers' } },
  { questionText: 'Carer numbers / rota note', questionType: TEXTAREA, sortOrder: 49, metadata: { specRef: '1.0' } },
];

/** 14-section enterprise template aligned with canvas-types/initial-assessment-checklist.md */
export const ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS: SectionSeed[] = [
  {
    sectionNumber: 1,
    title: 'Personal Details & Preferences',
    carePlanArea: 'Person Centred',
    description: 'Â§1 â€” person first (1.1â†’1.8 then 1.0). Door codes in Â§3 only.',
    questions: [...SECTION_1_QUESTIONS, ...asQuestionSeeds(ABOUT_ME_IA_QUESTIONS), ...HOLISTIC_SECTION_1_EXTRA_QUESTIONS],
  },
  {
    sectionNumber: 2,
    title: 'Consent, Capacity and Information Sharing',
    carePlanArea: 'Consent',
    description: 'Spec Â§2 â€” consent, MCA, best interest, sharing',
    questions: [
      ...IA_CONSENT_TAB_QUESTIONS.filter((q) => q.metadata?.specRef === '2.1'),
      { questionText: 'Has the Service User consented to receive care and support?', questionType: YES_NO, isRequired: true, sortOrder: 3, metadata: { specRef: '2.2', fieldKey: 'consentToCare' } },
      ...IA_CONSENT_TAB_QUESTIONS.filter((q) => q.metadata?.specRef !== '2.1'),
      { questionText: 'MCA required?', questionType: YES_NO, isRequired: true, sortOrder: 6, metadata: { specRef: '2.5', fieldKey: 'mcaRequired' } },
      { questionText: 'MCA completed?', questionType: YES_NO, sortOrder: 7, metadata: { specRef: '2.5', fieldKey: 'mcaCompleted' } },
      { questionText: 'Best interest decision required?', questionType: YES_NO, sortOrder: 8, metadata: { specRef: '2.6', fieldKey: 'bestInterestDecisionRequired' } },
      { questionText: 'Best interest decision details', helpText: BEST_INTEREST_DETAILS_HELP, questionType: TEXTAREA, sortOrder: 9, metadata: { specRef: '2.6', fieldKey: 'bestInterestDecisionDetails' } },
      ...IA_DEPRIVATION_OF_LIBERTY_QUESTIONS,
      ...MCA_SCREENING_QUESTIONS,
    ],
  },
  {
    sectionNumber: 3,
    title: 'Environmental / Home Safety',
    carePlanArea: 'Environment',
    description: 'Spec §3 — access, environment checklist, flooring, pets, parking',
    questions: [
      {
        questionText: 'Can client manage home environment safely?',
        questionType: YES_NO,
        isRequired: true,
        sortOrder: 5,
        metadata: { specRef: '3.3', fieldKey: 'manageHomeEnvironmentSafely' },
      },
      {
        questionText: 'If no, what measure should be taken?',
        questionType: TEXTAREA,
        sortOrder: 6,
        metadata: {
          specRef: '3.4',
          fieldKey: 'homeEnvironmentSafetyMeasures',
          ...whenNo('Can client manage home environment safely?'),
        },
      },
      { questionText: 'Access instructions for staff', questionType: TEXTAREA, isRequired: true, sortOrder: 6, metadata: { specRef: '3.5', fieldKey: 'accessInstructions', prefillKey: 'accessInstruction', syncKey: 'accessInstructions' } },
      { questionText: 'Door entry code (secure — from DOM Care)', questionType: TEXT, sortOrder: 8, metadata: { specRef: '3.5', fieldKey: 'doorCode', prefillKey: 'doorCode', secureField: true } },
      { questionText: 'Key safe location', questionType: TEXT, sortOrder: 9, metadata: { specRef: '3.6', fieldKey: 'keySafeLocation' } },
      { questionText: 'Trip hazards identified?', questionType: YES_NO, sortOrder: 10, metadata: { specRef: '3.7' } },
      { questionText: 'Pets present?', questionType: YES_NO, sortOrder: 13, metadata: { specRef: '3.8', fieldKey: 'petsPresent' } },
      {
        questionText: 'Pets secured during visits?',
        questionType: YES_NO,
        sortOrder: 14,
        metadata: { specRef: '3.8', fieldKey: 'petsSecuredDuringVisits', ...whenFieldYes('petsPresent') },
      },
      {
        questionText: 'Pet infestation or hygiene risk?',
        questionType: YES_NO,
        sortOrder: 16,
        metadata: { specRef: '3.8', fieldKey: 'petInfestationRisk', ...whenFieldYes('petsPresent') },
      },
      // Lone-worker risk is now captured via the Environment Assessment control field
      // (loneWorkerRiskIdentified) and scored by the aggregated LONE_WORKER path, so this
      // legacy question no longer carries riskFlag (would otherwise double-emit a risk).
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
  {
    sectionNumber: 15,
    title: 'Infection and Clinical Precautions',
    carePlanArea: 'Infection',
    description: 'Spec §15 — infection precautions, PPE, and staff instructions',
    questions: asQuestionSeeds(SECTION_15_QUESTIONS),
  },
  {
    sectionNumber: 16,
    title: 'Personal Emergency Evacuation Plan',
    carePlanArea: 'Environment',
    description: 'Spec §16 — person-specific evacuation assistance, equipment, procedure, and review',
    questions: asQuestionSeeds(SECTION_16_QUESTIONS),
  },
  {
    sectionNumber: 17,
    title: 'Bed Rails',
    carePlanArea: 'Mobility',
    description: 'Spec §17 — initial bed rail screen (in use, reason, alternatives, entrapment, review)',
    questions: asQuestionSeeds(SECTION_17_QUESTIONS),
  },
  {
    sectionNumber: 18,
    title: 'Fire Safety',
    carePlanArea: 'Environment',
    description: 'Spec §18 — property fire hazards, alarms, smoking, cooking, and escape arrangements',
    questions: asQuestionSeeds(SECTION_18_QUESTIONS),
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
          'Enterprise initial assessment (CQC-aligned). Replaces legacy 28-section checklist as default.',
        version: 8,
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
          'Enterprise initial assessment (CQC-aligned). Replaces legacy 28-section checklist as default.',
        version: 8,
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
    await prisma.initialAssessmentSection.upsert({
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
  }

  const rehomedFire = await rehomeFireSafetyQuestionsToSection18(prisma);
  if (rehomedFire > 0) {
    console.log(`[seed] Rehomed ${rehomedFire} fire-safety question(s) to §18 without changing IDs.`);
  }

  for (const section of ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS) {
    const sectionRow = await prisma.initialAssessmentSection.findFirst({
      where: { templateId: template.id, sectionNumber: section.sectionNumber, deletedAt: null },
    });
    if (!sectionRow) continue;

    const sectionQuestions = await prisma.initialAssessmentQuestion.findMany({
      where: { sectionId: sectionRow.id },
      select: { id: true, questionText: true, metadata: true, deletedAt: true },
    });
    const usedIds = new Set<string>();

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
        if (usedIds.has(row.id)) return false;
        if (row.questionText === q.questionText) return true;
        if (q.formerQuestionTexts?.includes(row.questionText)) return true;
        if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) {
          return false;
        }
        const rowMeta = row.metadata as Record<string, unknown>;
        if (fieldKey && rowMeta.fieldKey === fieldKey) return true;
        if (!specRef || rowMeta.specRef !== specRef) return false;
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
        usedIds.add(existing.id);
        await prisma.initialAssessmentQuestion.update({
          where: { id: existing.id },
          data: { ...data, deletedAt: null },
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

  const migratedFire = await migrateSection31FireQuestions(prisma);
  if (migratedFire > 0) {
    console.log(`[seed] Aligned ${migratedFire} Environment home-safety question(s).`);
  }

  const remappedDiabetes = await remapDiabetesTypeHistoricalAnswers(prisma);
  if (remappedDiabetes > 0) {
    console.log(`[seed] Remapped ${remappedDiabetes} historical diabetes type answer(s) (Type A/B → type_1/type_2).`);
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

  const migratedMca = await migrateMcaRequiredFromCognitionDuplicate(prisma);
  if (migratedMca > 0) {
    console.log(`[seed] Migrated ${migratedMca} cognition MCA-required answer(s) → Consent §2.5.`);
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

export type EnterpriseSectionUpsertResult = {
  templateId: string;
  templateName: string;
  templateVersion: number;
  sections: Array<{
    sectionNumber: number;
    sectionId: string;
    sectionCreated: boolean;
    questionsCreated: number;
    questionsUpdated: number;
    fieldKeys: string[];
  }>;
};

/**
 * Idempotent upsert of selected enterprise sections onto the EXISTING default template.
 * Does not create the template, prune other sections, or rehome fire questions.
 */
export async function upsertEnterpriseTemplateSections(
  prisma: PrismaClient,
  sectionNumbers: number[],
): Promise<EnterpriseSectionUpsertResult> {
  const wanted = new Set(sectionNumbers);
  const specs = ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS.filter((s) => wanted.has(s.sectionNumber));
  if (specs.length !== sectionNumbers.length) {
    const found = new Set(specs.map((s) => s.sectionNumber));
    const missing = sectionNumbers.filter((n) => !found.has(n));
    throw new Error(`Enterprise seed has no definition for section(s): ${missing.join(', ')}`);
  }

  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) {
    throw new Error(
      `Enterprise template "${ENTERPRISE_TEMPLATE_NAME}" not found — refusing to create a new template`,
    );
  }

  const result: EnterpriseSectionUpsertResult = {
    templateId: template.id,
    templateName: template.name,
    templateVersion: template.version,
    sections: [],
  };

  for (const section of specs) {
    const before = await prisma.initialAssessmentSection.findUnique({
      where: {
        templateId_sectionNumber: {
          templateId: template.id,
          sectionNumber: section.sectionNumber,
        },
      },
      select: { id: true },
    });

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

    const sectionQuestions = await prisma.initialAssessmentQuestion.findMany({
      where: { sectionId: sectionRow.id },
      select: { id: true, questionText: true, metadata: true, deletedAt: true },
    });
    const usedIds = new Set<string>();
    let questionsCreated = 0;
    let questionsUpdated = 0;
    const fieldKeys: string[] = [];

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

      if (fieldKey) fieldKeys.push(fieldKey);

      const existing = sectionQuestions.find((row) => {
        if (usedIds.has(row.id)) return false;
        if (row.questionText === q.questionText) return true;
        if (q.formerQuestionTexts?.includes(row.questionText)) return true;
        if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) {
          return false;
        }
        const rowMeta = row.metadata as Record<string, unknown>;
        if (fieldKey && rowMeta.fieldKey === fieldKey) return true;
        if (!specRef || rowMeta.specRef !== specRef) return false;
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
        usedIds.add(existing.id);
        await prisma.initialAssessmentQuestion.update({
          where: { id: existing.id },
          data: { ...data, deletedAt: null },
        });
        questionsUpdated += 1;
      } else {
        await prisma.initialAssessmentQuestion.create({
          data: { sectionId: sectionRow.id, ...data },
        });
        questionsCreated += 1;
      }
    }

    result.sections.push({
      sectionNumber: section.sectionNumber,
      sectionId: sectionRow.id,
      sectionCreated: !before,
      questionsCreated,
      questionsUpdated,
      fieldKeys,
    });
  }

  return result;
}
