export type AssessmentConsentGivenBy =
  | 'service_user'
  | 'representative'
  | 'lpa'
  | 'deputy'
  | 'best_interest'
  | 'imca';

export type AssessmentConsentMethod = 'verbal' | 'written' | 'electronic';

export type AssessmentConsentMetadata = {
  consentObtained?: boolean | null;
  givenBy?: AssessmentConsentGivenBy | null;
  personName?: string;
  personRelationship?: string;
  method?: AssessmentConsentMethod | null;
  consentDate?: string;
  capacityIntact?: boolean | null;
  evidenceNote?: string;
  declinedReason?: string;
  assessmentKey?: string;
  assessmentTitle?: string;
};

const GIVEN_BY = new Set<string>([
  'service_user',
  'representative',
  'lpa',
  'deputy',
  'best_interest',
  'imca',
]);

const METHODS = new Set<string>(['verbal', 'written', 'electronic']);

export function isAssessmentConsentCaptureExempt(assessmentKey: string): boolean {
  return assessmentKey === 'photography-consent';
}

export function normalizeAssessmentConsentMetadata(raw: unknown): AssessmentConsentMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as AssessmentConsentMetadata;
  const givenBy =
    typeof row.givenBy === 'string' && GIVEN_BY.has(row.givenBy)
      ? (row.givenBy as AssessmentConsentGivenBy)
      : null;
  const method =
    typeof row.method === 'string' && METHODS.has(row.method)
      ? (row.method as AssessmentConsentMethod)
      : null;

  return {
    consentObtained:
      row.consentObtained === true || row.consentObtained === false ? row.consentObtained : null,
    givenBy,
    personName: typeof row.personName === 'string' ? row.personName : '',
    personRelationship: typeof row.personRelationship === 'string' ? row.personRelationship : '',
    method,
    consentDate: typeof row.consentDate === 'string' ? row.consentDate : '',
    capacityIntact:
      row.capacityIntact === true || row.capacityIntact === false ? row.capacityIntact : null,
    evidenceNote: typeof row.evidenceNote === 'string' ? row.evidenceNote : '',
    declinedReason: typeof row.declinedReason === 'string' ? row.declinedReason : '',
    assessmentKey: typeof row.assessmentKey === 'string' ? row.assessmentKey : undefined,
    assessmentTitle: typeof row.assessmentTitle === 'string' ? row.assessmentTitle : undefined,
  };
}

export function extractAssessmentConsentFromSnapshot(
  snapshot?: Record<string, unknown> | null,
): AssessmentConsentMetadata | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const raw = snapshot.assessmentConsent;
  if (!raw || typeof raw !== 'object') return null;
  return normalizeAssessmentConsentMetadata(raw);
}

function boolAnswered(value: boolean | null | undefined): boolean {
  return value === true || value === false;
}

export function validateAssessmentConsentForCompletion(
  snapshot: Record<string, unknown>,
  assessmentKey: string,
  source: string,
): string | null {
  if (source !== 'MANUAL') return null;
  if (isAssessmentConsentCaptureExempt(assessmentKey)) return null;

  const consent = extractAssessmentConsentFromSnapshot(snapshot);
  if (!consent) return 'Assessment consent must be recorded before saving this completion.';

  if (!boolAnswered(consent.consentObtained)) {
    return 'Confirm whether consent was obtained for this assessment.';
  }

  if (consent.consentObtained === false) {
    if (!consent.declinedReason?.trim()) {
      return 'Document why consent was not obtained (declined or unable to proceed).';
    }
    return null;
  }

  if (!consent.givenBy) return 'Select who gave consent for this assessment.';
  if (!consent.method) return 'Select how consent was recorded for this assessment.';
  if (!consent.consentDate?.trim()) return 'Consent date is required for this assessment.';

  if (consent.givenBy !== 'service_user') {
    if (!consent.personName?.trim()) {
      return 'Enter the name of the person who gave consent for this assessment.';
    }
    if (!consent.personRelationship?.trim()) {
      return 'Enter the relationship or role of the person who gave consent for this assessment.';
    }
  }

  if (!boolAnswered(consent.capacityIntact)) {
    return 'Confirm whether capacity to consent was intact at the time of this assessment.';
  }

  return null;
}
