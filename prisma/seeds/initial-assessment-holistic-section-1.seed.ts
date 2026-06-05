import { InitialAssessmentQuestionType } from '@prisma/client';
import {
  ACCOMMODATION_TYPE_OPTIONS,
  LPOA_SCOPE_OPTIONS,
} from './initial-assessment-enterprise-options';

const TEXT = InitialAssessmentQuestionType.TEXT;
const TEXTAREA = InitialAssessmentQuestionType.TEXTAREA;
const YES_NO = InitialAssessmentQuestionType.YES_NO;
const DATE = InitialAssessmentQuestionType.DATE;
const SINGLE_SELECT = InitialAssessmentQuestionType.SINGLE_SELECT;

/** Extra §1 fields for holistic assessment document parity (upserted by questionText). */
export const HOLISTIC_SECTION_1_EXTRA_QUESTIONS = [
  { questionText: 'Client legal name', questionType: TEXT, isRequired: true, sortOrder: 81, metadata: { specRef: '1.1', fieldKey: 'clientLegalName', prefillKey: 'legalName' } },
  { questionText: 'Ethnicity', questionType: TEXT, sortOrder: 82, metadata: { specRef: '1.1', fieldKey: 'ethnicity', prefillKey: 'ethnicity' } },
  { questionText: 'Languages spoken', questionType: TEXT, sortOrder: 83, metadata: { specRef: '1.1', fieldKey: 'languagesSpoken' } },
  { questionText: 'NHS number', questionType: TEXT, sortOrder: 84, metadata: { specRef: '1.1', fieldKey: 'nhsNumber', prefillKey: 'nhsNumber' } },
  { questionText: 'Beliefs', questionType: TEXTAREA, sortOrder: 85, metadata: { specRef: '1.1', fieldKey: 'beliefs' } },
  { questionText: 'Communication needs', questionType: TEXTAREA, sortOrder: 86, metadata: { specRef: '1.1', fieldKey: 'communicationNeeds' } },
  { questionText: 'PO number', questionType: TEXT, sortOrder: 87, metadata: { specRef: '1.1', fieldKey: 'poNumber' } },
  { questionText: 'GP contact details', questionType: TEXTAREA, sortOrder: 88, metadata: { specRef: '1.1', fieldKey: 'gpContactDetails', prefillKey: 'gpContact' } },
  { questionText: 'Key safe present?', questionType: YES_NO, sortOrder: 89, metadata: { specRef: '1.1', fieldKey: 'keySafePresentHolistic' } },
  { questionText: 'Key safe code', questionType: TEXT, sortOrder: 90, metadata: { specRef: '1.1', fieldKey: 'keySafeCodeHolistic', secureField: true } },
  { questionText: 'Pendant / telecare in use?', questionType: YES_NO, sortOrder: 91, metadata: { specRef: '1.1', fieldKey: 'pendantTelecare' } },
  { questionText: 'Assessment completed date and time', questionType: DATE, sortOrder: 92, metadata: { specRef: '1.1', fieldKey: 'assessmentCompletedAt' } },
  { questionText: 'Assessor name', questionType: TEXT, sortOrder: 93, metadata: { specRef: '1.1', fieldKey: 'assessorName' } },
  { questionText: 'Assessor designation', questionType: TEXT, sortOrder: 94, metadata: { specRef: '1.1', fieldKey: 'assessorDesignation' } },
  { questionText: 'LPOA appointed?', questionType: SINGLE_SELECT, sortOrder: 95, options: LPOA_SCOPE_OPTIONS, metadata: { specRef: '1.1', fieldKey: 'lpoaAppointed' } },
  { questionText: 'LPOA contact details', questionType: TEXTAREA, sortOrder: 96, metadata: { specRef: '1.1', fieldKey: 'lpoaContactDetails' } },
  { questionText: 'LPOA designation', questionType: TEXT, sortOrder: 97, metadata: { specRef: '1.1', fieldKey: 'lpoaDesignation' } },
  { questionText: 'LPOA name', questionType: TEXT, sortOrder: 98, metadata: { specRef: '1.1', fieldKey: 'lpoaName' } },
  { questionText: 'Social worker contact', questionType: TEXTAREA, sortOrder: 99, metadata: { specRef: '1.1', fieldKey: 'socialWorkerContact' } },
  { questionText: 'Care manager contact', questionType: TEXTAREA, sortOrder: 100, metadata: { specRef: '1.1', fieldKey: 'careManagerContact' } },
  { questionText: 'Mental health team contact', questionType: TEXTAREA, sortOrder: 101, metadata: { specRef: '1.1', fieldKey: 'mentalHealthTeamContact' } },
  { questionText: 'Advocate contact', questionType: TEXTAREA, sortOrder: 102, metadata: { specRef: '1.1', fieldKey: 'advocateContact' } },
  { questionText: 'Allergies (summary)', questionType: TEXTAREA, sortOrder: 103, metadata: { specRef: '1.0', fieldKey: 'allergiesSummary', prefillKey: 'allergies' } },
  { questionText: 'Does the client receive support from an informal carer?', questionType: YES_NO, sortOrder: 110, metadata: { specRef: '1.2', fieldKey: 'informalCarerSupport' } },
  { questionText: 'Informal carer name', questionType: TEXT, sortOrder: 111, metadata: { specRef: '1.2', fieldKey: 'informalCarerName', showWhen: { gateTextIncludes: 'informal carer', yes: true } } },
  { questionText: 'Informal carer contact (if different)', questionType: TEXTAREA, sortOrder: 112, metadata: { specRef: '1.2', fieldKey: 'informalCarerContact' } },
  { questionText: 'Is the client receiving a care package?', questionType: YES_NO, sortOrder: 113, metadata: { specRef: '1.2', fieldKey: 'receivingCarePackage' } },
  { questionText: 'Care package comments', questionType: TEXTAREA, sortOrder: 114, metadata: { specRef: '1.2', fieldKey: 'carePackageComments' } },
  { questionText: 'Details of other care agencies involved with client', questionType: TEXTAREA, sortOrder: 115, metadata: { specRef: '1.2', fieldKey: 'otherCareAgencies' } },
  { questionText: 'Does the carer require a carer’s assessment?', questionType: YES_NO, sortOrder: 116, metadata: { specRef: '1.2', fieldKey: 'carerAssessmentRequired' } },
  { questionText: 'Carer assessment referral made?', questionType: YES_NO, sortOrder: 117, metadata: { specRef: '1.2', fieldKey: 'carerAssessmentReferralMade', showWhen: { gateTextIncludes: 'carer’s assessment', yes: true } } },
  { questionText: 'Carer assessment referral date', questionType: DATE, sortOrder: 118, metadata: { specRef: '1.2', fieldKey: 'carerAssessmentReferralDate', showWhen: { gateTextIncludes: 'referral made', yes: true } } },
  {
    questionText: 'Type of living accommodation',
    questionType: SINGLE_SELECT,
    sortOrder: 119,
    options: ACCOMMODATION_TYPE_OPTIONS,
    metadata: { specRef: '1.2', fieldKey: 'accommodationType' },
  },
  { questionText: 'Other accommodation (please state)', questionType: TEXT, sortOrder: 120, metadata: { specRef: '1.2', fieldKey: 'accommodationOther' } },
  { questionText: 'Is client able to answer front door?', questionType: YES_NO, sortOrder: 121, metadata: { specRef: '1.2', fieldKey: 'canAnswerFrontDoor' } },
  { questionText: 'Does the client live alone?', questionType: YES_NO, sortOrder: 122, metadata: { specRef: '1.2', fieldKey: 'livesAlone' } },
  { questionText: 'Instructions for gaining access to client’s home', questionType: TEXTAREA, sortOrder: 123, metadata: { specRef: '1.2', fieldKey: 'homeAccessInstructions', prefillKey: 'accessInstruction' } },
  { questionText: 'Any identified risks to visiting staff members?', questionType: TEXTAREA, sortOrder: 124, metadata: { specRef: '1.2', fieldKey: 'staffVisitRisks' } },
  { questionText: 'Lifestyle, role and choices', questionType: TEXTAREA, sortOrder: 125, metadata: { specRef: '1.2', fieldKey: 'lifestyleRoleChoices' } },
] as const;
