import { Prisma } from '@prisma/client';

function metadataObject(metadata: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

function metaBlock<T extends Record<string, unknown>>(
  metadata: Prisma.JsonValue | null | undefined,
  key: string,
): T | undefined {
  const row = metadataObject(metadata)[key];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  return row as T;
}

export function boolAnswered(value: boolean | null | undefined): boolean {
  return value === true || value === false;
}

type PainAssessmentMetadata = {
  nrsScore?: number;
  abbey?: Record<string, unknown>;
};

type TherapyAideMemoireMetadata = {
  furtherReferralRequired?: boolean | null;
  referralCompleted?: boolean | null;
  referralDate?: string;
};

type MovingHandlingMetadata = {
  riskFilter?: Record<string, boolean | null | undefined>;
  tasks?: Record<string, unknown>;
};

type EnvironmentAssessmentMetadata = Record<string, boolean | null | undefined | string>;

type AdvanceCarePlanningMetadata = {
  dateCompleted?: string;
  legalAdvanceDecision?: boolean | null;
  personalValues?: string;
  carePreferences?: string;
  concernsAndFears?: string;
};

type PhotographyConsentMetadata = {
  surname?: string;
  firstNames?: string;
  consentSubjectName?: string;
  consentSignature?: string;
  consentDate?: string;
  consentPrintName?: string;
};

const ENVIRONMENT_BOOL_KEYS = [
  'homeHazards',
  'furniturePosition',
  'lightingRequirements',
  'temperatureSupport',
  'pets',
  'externalHazards',
  'infectionControlRisks',
  'carePlanCompleted',
] as const;

const MOVING_HANDLING_RISK_KEYS = [
  'totallyIndependentLowRisk',
  'bedBound',
  'weightBearing',
  'needsHoist',
  'needsTwoStaff',
  'needsSpecialistEquipment',
] as const;

export function isPainAssessmentComplete(metadata: Prisma.JsonValue | null | undefined): boolean {
  const pain = metaBlock<PainAssessmentMetadata>(metadata, 'painAssessment');
  if (!pain) return false;
  if (pain.nrsScore != null && Number.isFinite(pain.nrsScore)) return true;
  const abbey = pain.abbey;
  if (!abbey || typeof abbey !== 'object') return false;
  return Object.values(abbey).some((v) => typeof v === 'number' && Number.isFinite(v));
}

export function isTherapyAideMemoireComplete(
  metadata: Prisma.JsonValue | null | undefined,
): boolean {
  const pain = metaBlock<{ therapyAideMemoire?: TherapyAideMemoireMetadata }>(
    metadata,
    'painAssessment',
  );
  const meta = pain?.therapyAideMemoire;
  if (!meta) return false;
  if (!boolAnswered(meta.furtherReferralRequired)) return false;
  if (!boolAnswered(meta.referralCompleted)) return false;
  if (meta.referralCompleted === true && !meta.referralDate?.trim()) return false;
  return true;
}

export function isMovingHandlingComplete(metadata: Prisma.JsonValue | null | undefined): boolean {
  const row = metaBlock<MovingHandlingMetadata>(metadata, 'movingHandlingOperations');
  if (!row?.riskFilter) return false;
  const rf = row.riskFilter;
  const riskAnswered = MOVING_HANDLING_RISK_KEYS.every((k) => boolAnswered(rf[k]));
  if (!riskAnswered) return false;
  if (rf.totallyIndependentLowRisk === true) return true;
  const tasks = row.tasks;
  if (!tasks || typeof tasks !== 'object') return false;
  return Object.values(tasks).some((task) => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return false;
    return (task as Record<string, unknown>).capability != null;
  });
}

export function isEnvironmentAssessmentComplete(
  metadata: Prisma.JsonValue | null | undefined,
): boolean {
  const row = metaBlock<EnvironmentAssessmentMetadata>(metadata, 'environmentAssessment');
  if (!row) return false;
  return ENVIRONMENT_BOOL_KEYS.every((k) => boolAnswered(row[k] as boolean | null | undefined));
}

export function isAdvanceCarePlanningComplete(
  metadata: Prisma.JsonValue | null | undefined,
): boolean {
  const row = metaBlock<AdvanceCarePlanningMetadata>(metadata, 'advanceCarePlanning');
  if (!row) return false;
  if (!row.dateCompleted?.trim()) return false;
  if (!boolAnswered(row.legalAdvanceDecision)) return false;
  if (!row.personalValues?.trim()) return false;
  if (!row.carePreferences?.trim()) return false;
  if (!row.concernsAndFears?.trim()) return false;
  return true;
}

export function isEndOfLifeAssessmentComplete(
  metadata: Prisma.JsonValue | null | undefined,
): boolean {
  const row = metaBlock<Record<string, unknown>>(metadata, 'endOfLifeAssessment');
  if (!row) return false;
  const answered = Object.entries(row).filter(
    ([k, v]) => !k.endsWith('Notes') && (typeof v === 'boolean' || v === 'unknown'),
  );
  return answered.length >= 3;
}

export function isMentalCapacityChecklistComplete(
  metadata: Prisma.JsonValue | null | undefined,
): boolean {
  const row = metaBlock<Record<string, unknown>>(metadata, 'mentalCapacityChecklist');
  if (!row?.assessmentType) return false;
  const boolKeys = Object.entries(row).filter(([, v]) => typeof v === 'boolean');
  return boolKeys.length >= 4;
}

export function isPhotographyConsentComplete(
  metadata: Prisma.JsonValue | null | undefined,
): boolean {
  const row = metaBlock<PhotographyConsentMetadata>(metadata, 'photographyConsent');
  if (!row) return false;
  return Boolean(
    row.surname?.trim() &&
      row.firstNames?.trim() &&
      row.consentSubjectName?.trim() &&
      row.consentSignature?.trim() &&
      row.consentDate?.trim() &&
      row.consentPrintName?.trim(),
  );
}

export function extractTherapyAideMemoire(metadata: Prisma.JsonValue | null | undefined) {
  const pain = metaBlock<{ therapyAideMemoire?: Record<string, unknown> }>(
    metadata,
    'painAssessment',
  );
  return pain?.therapyAideMemoire;
}
