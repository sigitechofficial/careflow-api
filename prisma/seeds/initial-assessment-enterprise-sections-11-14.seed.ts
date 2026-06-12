import { InitialAssessmentQuestionType } from '@prisma/client';
import {
  PERSONAL_CARE_LOCATION_OPTIONS,
  SAFEGUARDING_TYPE_OPTIONS,
} from './initial-assessment-enterprise-options';
import { iaMeta, whenYes } from './initial-assessment-enterprise-metadata';
import type { EnterpriseQuestionSeed } from './initial-assessment-enterprise-sections-5-10.seed';

const Y = InitialAssessmentQuestionType.YES_NO;
const T = InitialAssessmentQuestionType.TEXT;
const A = InitialAssessmentQuestionType.TEXTAREA;
const N = InitialAssessmentQuestionType.NUMBER;
const D = InitialAssessmentQuestionType.DATE;
const S = InitialAssessmentQuestionType.SINGLE_SELECT;
const M = InitialAssessmentQuestionType.MULTI_SELECT;

/** Paper Section 6 — Skin Integrity (single block; no 11.1a / 11.2 / 11.3 sub-panels). */
export const SECTION_11_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'Skin condition or concern?', questionType: Y, carePlanTrigger: true, sortOrder: 1, metadata: iaMeta('11.1', { fieldKey: 'skinCondition' }) },
  { questionText: 'Skin condition comment', questionType: A, sortOrder: 2, metadata: iaMeta('11.1') },
  { questionText: 'Currently has ulcers or wounds?', questionType: Y, riskFlag: true, carePlanTrigger: true, sortOrder: 3, metadata: iaMeta('11.1', { fieldKey: 'hasWounds' }) },
  { questionText: 'Ulcers or wounds comment', questionType: A, sortOrder: 4, metadata: iaMeta('11.1') },
  {
    questionText: 'Pressure ulcer risk assessment completed (including photography)?',
    questionType: Y,
    isRequired: true,
    sortOrder: 5,
    metadata: iaMeta('11.1'),
  },
  { questionText: 'Pressure ulcer risk assessment comment', questionType: A, sortOrder: 6, metadata: iaMeta('11.1') },
  { questionText: 'Has wound assessment been completed?', questionType: Y, isRequired: true, sortOrder: 7, metadata: iaMeta('11.1') },
  { questionText: 'Wound assessment comment', questionType: A, sortOrder: 8, metadata: iaMeta('11.1') },
  { questionText: 'Skin / wound notes', questionType: A, sortOrder: 9, metadata: iaMeta('11.1', { fieldKey: 'skinIntegrityComments' }) },
  { questionText: 'Pressure relieving equipment in use?', questionType: Y, sortOrder: 10, metadata: iaMeta('11.1') },
  { questionText: 'Pressure equipment details', questionType: A, sortOrder: 11, metadata: iaMeta('11.1', whenYes('pressure relieving equipment in use')) },
  {
    questionText: 'Further pressure equipment required?',
    questionType: Y,
    carePlanTrigger: true,
    sortOrder: 12,
    metadata: iaMeta('11.1', { fieldKey: 'furtherPressureEquipmentRequired' }),
  },
  { questionText: 'Equipment ordered?', questionType: Y, sortOrder: 13, metadata: iaMeta('11.1', whenYes('further pressure equipment required')) },
  { questionText: 'Date equipment ordered', questionType: D, sortOrder: 14, metadata: iaMeta('11.1', whenYes('equipment ordered')) },
  {
    questionText: 'Pressure equipment order additional comments',
    questionType: A,
    sortOrder: 15,
    metadata: iaMeta('11.1', whenYes('further pressure equipment required')),
  },
  { questionText: 'Fluid chart required?', questionType: Y, sortOrder: 16, metadata: iaMeta('11.1') },
  { questionText: 'Weight monitoring required?', questionType: Y, sortOrder: 17, metadata: iaMeta('11.1') },
  { questionText: 'Waterlow assessment completed?', questionType: Y, sortOrder: 18, metadata: iaMeta('11.4') },
];

export const SECTION_12_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'Uses hoist or sling?', questionType: Y, riskFlag: true, carePlanTrigger: true, sortOrder: 1, metadata: iaMeta('12.5a', { fieldKey: 'usesHoistOrSling' }) },
  { questionText: 'Restricted to bed?', questionType: Y, riskFlag: true, sortOrder: 2, metadata: iaMeta('12.5a') },
  { questionText: 'Any amputation?', questionType: Y, carePlanTrigger: true, sortOrder: 3, metadata: iaMeta('12.5b') },
  { questionText: 'Uses prosthesis?', questionType: Y, sortOrder: 4, metadata: iaMeta('12.5b', whenYes('any amputation')) },
  { questionText: 'Prosthesis care notes', questionType: A, sortOrder: 5, metadata: iaMeta('12.5b', whenYes('uses prosthesis')) },
  { questionText: 'Transfer support required?', questionType: Y, carePlanTrigger: true, sortOrder: 6, metadata: iaMeta('12.5c', { fieldKey: 'transferSupportRequired' }) },
  { questionText: 'Independent with all transfers?', questionType: Y, sortOrder: 7, metadata: iaMeta('12.5c') },
  { questionText: 'Transfer comments', questionType: A, sortOrder: 8, metadata: iaMeta('12.5c') },
  { questionText: 'Personal care completed in — locations', questionType: M, sortOrder: 9, options: PERSONAL_CARE_LOCATION_OPTIONS, metadata: iaMeta('12.5d', { fieldKey: 'personalCareLocations' }) },
  { questionText: 'Other personal care location details', questionType: T, sortOrder: 10, metadata: iaMeta('12.5d') },
  { questionText: 'Falls in last 12 months?', questionType: Y, riskFlag: true, carePlanTrigger: true, sortOrder: 11, metadata: iaMeta('12.7', { fieldKey: 'fallsLast12Months' }) },
  { questionText: 'Number of falls (last 12 months)', questionType: N, sortOrder: 12, metadata: iaMeta('12.7', whenYes('falls in last 12 months')) },
  { questionText: 'Most recent fall date', questionType: D, sortOrder: 13, metadata: iaMeta('12.7', whenYes('falls in last 12 months')) },
  { questionText: 'Injury caused by fall?', questionType: Y, sortOrder: 14, metadata: iaMeta('12.7', whenYes('falls in last 12 months')) },
  { questionText: 'All mobilising aids in good working order?', questionType: Y, sortOrder: 15, metadata: iaMeta('12.8') },
  { questionText: 'Hoist / profiling bed / air mattress in use?', questionType: Y, sortOrder: 16, metadata: iaMeta('12.8', { fieldKey: 'clinicalEquipmentInUse' }) },
  { questionText: 'Further equipment required to be ordered?', questionType: Y, sortOrder: 17, metadata: iaMeta('12.10') },
  { questionText: 'Further equipment details', questionType: A, sortOrder: 18, metadata: iaMeta('12.10', whenYes('further equipment required to be ordered')) },
  { questionText: 'Daily living equipment ordered?', questionType: Y, sortOrder: 19, metadata: iaMeta('12.10', whenYes('further equipment required to be ordered')) },
  { questionText: 'Date daily living equipment ordered', questionType: D, sortOrder: 20, metadata: iaMeta('12.10', whenYes('daily living equipment ordered')) },
  { questionText: 'Finance support required?', questionType: Y, riskFlag: true, sortOrder: 21, metadata: iaMeta('12.12', { fieldKey: 'financeSupportRequired' }) },
  { questionText: 'Finance support consent in place?', questionType: Y, sortOrder: 22, metadata: iaMeta('12.13', whenYes('finance support required')) },
];

export const SECTION_13_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'Any safeguarding concerns identified?', questionType: Y, isRequired: true, riskFlag: true, sortOrder: 1, metadata: iaMeta('13.1', { fieldKey: 'safeguardingConcern' }) },
  { questionText: 'Safeguarding concern types', questionType: M, sortOrder: 2, options: SAFEGUARDING_TYPE_OPTIONS, metadata: iaMeta('13.2', { fieldKey: 'safeguardingTypes', ...whenYes('safeguarding concerns identified') }) },
  { questionText: 'Safeguarding concern details', questionType: A, sortOrder: 3, metadata: iaMeta('13.1', whenYes('safeguarding concerns identified')) },
  { questionText: 'Immediate action taken?', questionType: A, sortOrder: 4, metadata: iaMeta('13.7', whenYes('safeguarding concerns identified')) },
  { questionText: 'Manager informed?', questionType: Y, sortOrder: 5, metadata: iaMeta('13.7', whenYes('safeguarding concerns identified')) },
  { questionText: 'Manager informed date and time', questionType: T, sortOrder: 6, metadata: iaMeta('13.7', whenYes('manager informed')) },
  { questionText: 'Local authority safeguarding referral required?', questionType: Y, sortOrder: 7, metadata: iaMeta('13.7', whenYes('safeguarding concerns identified')) },
  { questionText: 'Safeguarding referral made?', questionType: Y, sortOrder: 8, metadata: iaMeta('13.7', whenYes('local authority safeguarding referral required')) },
  { questionText: 'Safeguarding referral date', questionType: D, sortOrder: 9, metadata: iaMeta('13.7', whenYes('safeguarding referral made')) },
  { questionText: 'Safeguarding reference number', questionType: T, sortOrder: 10, metadata: iaMeta('13.7') },
  { questionText: 'Emergency contact 1 recorded?', questionType: Y, isRequired: true, sortOrder: 11, metadata: iaMeta('13.3') },
  { questionText: 'No response procedure agreed?', questionType: Y, isRequired: true, sortOrder: 12, metadata: iaMeta('13.5', { fieldKey: 'noResponseProcedureAgreed' }) },
  { questionText: 'What should staff do if no answer?', questionType: A, sortOrder: 13, metadata: iaMeta('13.5', whenYes('no response procedure agreed')) },
  { questionText: 'Should staff contact office if no response?', questionType: Y, sortOrder: 14, metadata: iaMeta('13.5') },
  { questionText: 'When should emergency services be contacted?', questionType: A, sortOrder: 15, metadata: iaMeta('13.5') },
  { questionText: 'GP name', questionType: T, sortOrder: 16, metadata: iaMeta('13.9', { prefillKey: 'gpName' }) },
  { questionText: 'GP practice and phone', questionType: A, sortOrder: 17, metadata: iaMeta('13.9') },
  { questionText: 'Pharmacy name and phone', questionType: A, sortOrder: 18, metadata: iaMeta('13.9') },
  { questionText: 'Preferred hospital', questionType: T, sortOrder: 19, metadata: iaMeta('13.9') },
  { questionText: 'District nurse involved?', questionType: Y, sortOrder: 20, metadata: iaMeta('13.9') },
  { questionText: 'DNACPR or ReSPECT in place?', questionType: Y, sortOrder: 21, metadata: iaMeta('13.6') },
  { questionText: 'ReSPECT / DNACPR location and summary', questionType: A, sortOrder: 22, metadata: iaMeta('13.6', whenYes('dnacpr or respect in place')) },
  { questionText: 'Reviewed monthly (legacy additional risk flag)?', questionType: Y, sortOrder: 23, metadata: iaMeta('13.15') },
  { questionText: 'Additional risk guidelines required?', questionType: Y, sortOrder: 24, metadata: iaMeta('13.15') },
  { questionText: 'Additional risk guidelines details', questionType: A, sortOrder: 25, metadata: iaMeta('13.15', whenYes('additional risk guidelines required')) },
  { questionText: 'Risk matrix entry required for identified risks?', questionType: Y, sortOrder: 26, metadata: iaMeta('13.7', { riskMatrixStub: true }) },
  { questionText: 'Safeguarding / emergency notes', questionType: A, sortOrder: 27, metadata: iaMeta('13.5') },
];

export const SECTION_14_EXTRA_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'Representative involved in sign-off?', questionType: Y, sortOrder: 7, metadata: iaMeta('14.6', { fieldKey: 'representativeInvolved', syncKey: 'representativeInvolved' }) },
  { questionText: 'Representative name', questionType: T, sortOrder: 8, metadata: iaMeta('14.6', { syncKey: 'representativeName', ...whenYes('representative involved in sign-off') }) },
  { questionText: 'Representative relationship', questionType: T, sortOrder: 9, metadata: iaMeta('14.6', { syncKey: 'representativeRelationship', ...whenYes('representative involved in sign-off') }) },
  { questionText: 'Service user / representative signature obtained?', questionType: Y, isRequired: true, sortOrder: 10, metadata: iaMeta('14.6', { fieldKey: 'suSignatureObtained' }) },
  { questionText: 'Care plan recommendations reviewed?', questionType: Y, sortOrder: 11, metadata: iaMeta('14.3') },
  { questionText: 'Actions generated and reviewed?', questionType: Y, sortOrder: 12, metadata: iaMeta('14.4') },
];

export const SECTION_14_TAIL_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'Manager review required?', questionType: Y, sortOrder: 13, metadata: iaMeta('14.7') },
  { questionText: 'Approved for care start?', questionType: Y, sortOrder: 14, metadata: iaMeta('14.7') },
  { questionText: 'Assessor declaration confirmed?', questionType: Y, isRequired: true, sortOrder: 15, metadata: iaMeta('14.5') },
  { questionText: 'Assessor name', questionType: T, isRequired: true, sortOrder: 16, metadata: iaMeta('14.8', { fieldKey: 'assessorName' }) },
  { questionText: 'Assessor designation / role', questionType: T, sortOrder: 17, metadata: iaMeta('14.8', { fieldKey: 'assessorRole' }) },
  { questionText: 'Assessor sign-off date', questionType: D, isRequired: true, sortOrder: 18, metadata: iaMeta('14.8', { fieldKey: 'assessorSignDate' }) },
  { questionText: 'Review and sign-off notes', questionType: A, sortOrder: 19, metadata: iaMeta('14.1') },
];
