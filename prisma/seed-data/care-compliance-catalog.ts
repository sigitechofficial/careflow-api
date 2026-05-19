import { ComplianceCategory } from '@prisma/client';

/** Care-sector compliance document types (legacy CareAdmin checklist). */
export type CareComplianceTypeDef = {
  name: string;
  code: string;
  category: ComplianceCategory;
  hasExpiry: boolean;
  defaultValidityMonths: number | null;
  requiresDocument: boolean;
  requiresVerification: boolean;
  isMandatoryByDefault: boolean;
};

function cat(c: keyof typeof ComplianceCategory): ComplianceCategory {
  return ComplianceCategory[c];
}

/** Display order matches legacy employee compliance screen. */
export const CARE_COMPLIANCE_CATALOG: CareComplianceTypeDef[] = [
  { name: 'DBS Code', code: 'DBS_CODE', category: cat('SAFEGUARDING'), hasExpiry: true, defaultValidityMonths: 36, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'ANNUAL APPRAISAL', code: 'ANNUAL_APPRAISAL', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'APPLICATION FORM', code: 'APPLICATION_FORM', category: cat('EMPLOYMENT'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'BIOMETRIC CARD', code: 'BIOMETRIC_CARD', category: cat('RIGHT_TO_WORK'), hasExpiry: true, defaultValidityMonths: 36, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'CONSENT OF CARER HAND BOOK', code: 'CARER_HANDBOOK_CONSENT', category: cat('EMPLOYMENT'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'COVID VACCINATIONS', code: 'COVID_VACCINATIONS', category: cat('CLINICAL'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: false, isMandatoryByDefault: false },
  { name: 'Covid-19', code: 'COVID_19', category: cat('CLINICAL'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: false, isMandatoryByDefault: false },
  { name: 'DBS', code: 'DBS', category: cat('SAFEGUARDING'), hasExpiry: true, defaultValidityMonths: 36, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'EMPLOYMENT CONTRACT', code: 'EMPLOYMENT_CONTRACT', category: cat('EMPLOYMENT'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'Employee share code letter', code: 'EMPLOYEE_SHARE_CODE', category: cat('RIGHT_TO_WORK'), hasExpiry: true, defaultValidityMonths: 24, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'FLU JOB', code: 'FLU_JOB', category: cat('CLINICAL'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: false, isMandatoryByDefault: false },
  { name: 'Health & Social Care L5', code: 'HEALTH_SOCIAL_CARE_L5', category: cat('TRAINING'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
  { name: 'ID PASSPORT', code: 'ID_PASSPORT', category: cat('IDENTITY'), hasExpiry: true, defaultValidityMonths: 120, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'INDUCTION CHECK LIST', code: 'INDUCTION_CHECKLIST', category: cat('TRAINING'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'JOB DESCRIPTION', code: 'JOB_DESCRIPTION', category: cat('EMPLOYMENT'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'Letters from the Home Office', code: 'HOME_OFFICE_LETTER', category: cat('RIGHT_TO_WORK'), hasExpiry: true, defaultValidityMonths: 24, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
  { name: 'MEDICAL QUESTIONNAIRE', code: 'MEDICAL_QUESTIONNAIRE', category: cat('HEALTH_AND_SAFETY'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'NEW STARTER FORM', code: 'NEW_STARTER_FORM', category: cat('EMPLOYMENT'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'OFFER LETTER', code: 'OFFER_LETTER', category: cat('EMPLOYMENT'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'PROBATION', code: 'PROBATION', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 6, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'PROOF ADDRESS', code: 'PROOF_ADDRESS', category: cat('IDENTITY'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'QUALIFICATION', code: 'QUALIFICATION', category: cat('TRAINING'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
  { name: 'REFERENCE 1', code: 'REFERENCE_1', category: cat('EMPLOYMENT'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'REFERENCE 2', code: 'REFERENCE_2', category: cat('EMPLOYMENT'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'SKILL FOR CARE CODE OF CONDUCT', code: 'SKILLS_FOR_CARE_CODE', category: cat('TRAINING'), hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'Supervision', code: 'SUPERVISION', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'Supervision 1', code: 'SUPERVISION_1', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'Supervision 2', code: 'SUPERVISION_2', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'supervision 3', code: 'SUPERVISION_3', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'Supervision 4', code: 'SUPERVISION_4', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'Supervison 4', code: 'SUPERVISION_4_ALT', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
  { name: 'Supervision 5', code: 'SUPERVISION_5', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'SUPERVISION 7', code: 'SUPERVISION_7', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'supervision 7', code: 'SUPERVISION_7_ALT', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
  { name: 'Supervision 8', code: 'SUPERVISION_8', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
  { name: 'supervision base on concern', code: 'SUPERVISION_CONCERN', category: cat('EMPLOYMENT'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
  { name: 'TRAINING', code: 'TRAINING', category: cat('TRAINING'), hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
];
