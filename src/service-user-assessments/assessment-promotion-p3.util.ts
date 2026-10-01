import { Prisma } from '@prisma/client';
import { isPainToolComplete } from '../initial-assessments/initial-assessment-abbey.util';

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

type TherapyAideMemoireItem = {
  checked?: boolean;
  details?: string;
};

type TherapyAideMemoireMetadata = {
  choking?: TherapyAideMemoireItem;
  chestInfections?: TherapyAideMemoireItem;
  speechConcern?: TherapyAideMemoireItem;
  mobilityChange?: TherapyAideMemoireItem;
  selfCareChange?: TherapyAideMemoireItem;
  carePackageConcern?: TherapyAideMemoireItem;
  furtherReferralRequired?: boolean | null;
  referralCompleted?: boolean | null;
  referralDate?: string;
};

const THERAPY_SCREENING_ITEMS: Array<{
  key: keyof Pick<
    TherapyAideMemoireMetadata,
    'choking' | 'chestInfections' | 'speechConcern' | 'mobilityChange' | 'selfCareChange' | 'carePackageConcern'
  >;
  detailsRequired: boolean;
}> = [
  { key: 'choking', detailsRequired: false },
  { key: 'chestInfections', detailsRequired: false },
  { key: 'speechConcern', detailsRequired: true },
  { key: 'mobilityChange', detailsRequired: true },
  { key: 'selfCareChange', detailsRequired: true },
  { key: 'carePackageConcern', detailsRequired: true },
];

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
  /** IA Consent tab gate; only "yes" is a consent record. */
  photographyNeeded?: 'yes' | 'no' | 'not_now';
  statementsAgreed?: boolean;
  professionalName?: string;
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
] as const;

/** Must match careflow-admin `MOVING_HANDLING_RISK_FILTER_QUESTIONS` / task definitions. */
const MOVING_HANDLING_RISK_KEYS = [
  'historyOfFalls',
  'unsteadyMobilising',
  'anxiousAboutFalls',
  'confused',
  'aged65PlusFallRiskMeds',
  'sensoryOrMotorImpairment',
] as const;

const MOVING_HANDLING_TASK_IDS = [
  'walking',
  'gettingInOutOfBed',
  'transfersBedToChair',
  'moveUpBed',
  'toileting',
  'bathOrShower',
] as const;

export function isPainAssessmentComplete(metadata: Prisma.JsonValue | null | undefined): boolean {
  const pain = metaBlock<PainAssessmentMetadata>(metadata, 'painAssessment');
  return isPainToolComplete(pain);
}

export function isTherapyAideMemoireComplete(
  metadata: Prisma.JsonValue | null | undefined,
): boolean {
  const meta = extractTherapyAideMemoire(metadata) as TherapyAideMemoireMetadata | undefined;
  if (!meta) return false;
  for (const item of THERAPY_SCREENING_ITEMS) {
    const state = meta[item.key];
    if (!boolAnswered(state?.checked)) return false;
    if (state?.checked === true && item.detailsRequired && !state.details?.trim()) return false;
  }
  if (!boolAnswered(meta.furtherReferralRequired)) return false;
  if (meta.furtherReferralRequired === true) {
    if (!boolAnswered(meta.referralCompleted)) return false;
    if (meta.referralCompleted === true && !meta.referralDate?.trim()) return false;
  }
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
  return MOVING_HANDLING_TASK_IDS.every((id) => {
    const task = (tasks as Record<string, unknown>)[id];
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

  const yesNoIds = [
    'endOfLifeCarePlan',
    'awareOfDying',
    'medicationAssessed',
    'medicationAvailable',
    'interventionDiscussion',
    'carersAwareWishes',
    'capacityEndOfLife',
    'comfortDiscussWishes',
    'terminalResidence',
    'hospiceHospitalTransfer',
    'funeralArrangements',
    'contactNextOfKin',
    'reviewWishesFuture',
    'capacityLastWishes',
    'dnrInPlace',
  ] as const;
  const triIds = ['medicalAidRecovery', 'lastWill'] as const;

  for (const id of yesNoIds) {
    const value = row[`${id}Answer`];
    if (value !== true && value !== false) return false;
  }
  for (const id of triIds) {
    const value = row[`${id}TriAnswer`];
    if (value !== 'yes' && value !== 'no' && value !== 'unknown') return false;
  }
  return true;
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
  if (row.photographyNeeded === 'no' || row.photographyNeeded === 'not_now') return false;
  // Compact IA record (Consent tab): confirmed statements replace the paper form's typed signatures.
  if (row.photographyNeeded === 'yes') {
    return Boolean(
      row.statementsAgreed &&
        row.consentPrintName?.trim() &&
        row.consentDate?.trim() &&
        row.professionalName?.trim(),
    );
  }
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
  if (pain?.therapyAideMemoire && typeof pain.therapyAideMemoire === 'object') {
    return pain.therapyAideMemoire;
  }
  return metaBlock<Record<string, unknown>>(metadata, 'therapyAideMemoire');
}
