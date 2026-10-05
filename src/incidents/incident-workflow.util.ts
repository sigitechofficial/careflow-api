import {
  IncidentPrivacyLevel,
  IncidentSeverity,
  IncidentStatus,
} from '@prisma/client';
import { operationalDayBounds } from '../common/utils/operational-day.util';

/**
 * Status flow (v2):
 *   Reported → Under Review → Under Investigation → Actions Required → Awaiting Closure → Closed
 *   Under Review can skip straight to Awaiting Closure (minor, no investigation needed).
 *   Awaiting Closure / Actions Required can go back to Under Investigation (reason required).
 *   Reopening a closed incident is an EVENT (reopenCount / lastReopenedAt) that returns it to
 *   Under Review. REOPENED is legacy only and is never set by new changes.
 * Reported → Under Review happens through "Start review" (owner + reviewStartedAt).
 */
export const INCIDENT_STATUS_TRANSITIONS: Record<
  IncidentStatus,
  IncidentStatus[]
> = {
  [IncidentStatus.REPORTED]: [IncidentStatus.UNDER_REVIEW],
  [IncidentStatus.UNDER_REVIEW]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.AWAITING_CLOSURE,
  ],
  [IncidentStatus.UNDER_INVESTIGATION]: [
    IncidentStatus.ACTIONS_REQUIRED,
    IncidentStatus.AWAITING_CLOSURE,
  ],
  [IncidentStatus.ACTIONS_REQUIRED]: [
    IncidentStatus.AWAITING_CLOSURE,
    IncidentStatus.UNDER_INVESTIGATION,
  ],
  [IncidentStatus.AWAITING_CLOSURE]: [
    IncidentStatus.CLOSED,
    IncidentStatus.UNDER_INVESTIGATION,
  ],
  [IncidentStatus.CLOSED]: [IncidentStatus.UNDER_REVIEW],
  // Legacy rows (migrated to UNDER_REVIEW, kept for type completeness).
  [IncidentStatus.REOPENED]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.AWAITING_CLOSURE,
  ],
};

/** Closed → Under Review: needs incidents.reopen and a reason; counted as a reopen. */
export function isReopenTransition(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  return from === IncidentStatus.CLOSED && to === IncidentStatus.UNDER_REVIEW;
}

/** Back to Under Investigation from later stages: a reason is required. */
export function isSendBackTransition(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  return (
    to === IncidentStatus.UNDER_INVESTIGATION &&
    (from === IncidentStatus.AWAITING_CLOSURE ||
      from === IncidentStatus.ACTIONS_REQUIRED)
  );
}

/**
 * occurredAt range for list / analytics filters. Date-only values (YYYY-MM-DD) mean whole days in the
 * organisation timezone — UTC days would put e.g. 00:30 BST on the previous day. Full ISO date-times
 * are used as given.
 */
export function incidentOccurredAtRange(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  timeZone: string,
): { gte?: Date; lte?: Date } | undefined {
  if (!dateFrom && !dateTo) return undefined;
  const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  return {
    ...(dateFrom
      ? { gte: isDay(dateFrom) ? operationalDayBounds(dateFrom, timeZone).start : new Date(dateFrom) }
      : {}),
    ...(dateTo
      ? { lte: isDay(dateTo) ? operationalDayBounds(dateTo, timeZone).end : new Date(dateTo) }
      : {}),
  };
}

export function canTransitionIncidentStatus(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  if (from === to) return false;
  return INCIDENT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that count as "open" for dashboards / trend logic. */
export const OPEN_INCIDENT_STATUSES: IncidentStatus[] = [
  IncidentStatus.REPORTED,
  IncidentStatus.UNDER_REVIEW,
  IncidentStatus.UNDER_INVESTIGATION,
  IncidentStatus.ACTIONS_REQUIRED,
  IncidentStatus.AWAITING_CLOSURE,
  IncidentStatus.REOPENED,
];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  REPORTED: 'Reported',
  UNDER_REVIEW: 'Under Review',
  UNDER_INVESTIGATION: 'Under Investigation',
  ACTIONS_REQUIRED: 'Actions Required',
  AWAITING_CLOSURE: 'Awaiting Closure',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
};

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const INCIDENT_SEVERITY_RANK: Record<IncidentSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const INCIDENT_PRIVACY_LABELS: Record<IncidentPrivacyLevel, string> = {
  NORMAL: 'Normal',
  RESTRICTED: 'Restricted',
  HIGHLY_CONFIDENTIAL: 'Highly Confidential',
};

/** Rank used for privacy access checks (higher = needs more clearance). */
export const INCIDENT_PRIVACY_RANK: Record<IncidentPrivacyLevel, number> = {
  NORMAL: 0,
  RESTRICTED: 1,
  HIGHLY_CONFIDENTIAL: 2,
};

/** Checklist codes for "immediate actions taken" captured during reporting. */
/** "What was done?" on the office raise form. Who was told is recorded separately (who-informed keys). */
export const IMMEDIATE_ACTION_CODES = [
  'FIRST_AID',
  'INJURY_CHECK',
  'AREA_MADE_SAFE',
  'EQUIPMENT_OUT_OF_USE',
  'MEDICATION_WITHHELD',
  'EVIDENCE_PRESERVED',
  'NO_ACTION_NEEDED',
  'OTHER',
] as const;

/**
 * "Who was informed?" keys accepted from the office raise form (static for now).
 * Same keys as the carer-app catalog defaults, plus police and NHS 111.
 */
export const OFFICE_WHO_INFORMED_KEYS = [
  'office',
  'on_call_manager',
  'family_nok',
  'gp',
  'emergency_999',
  'nhs_111',
  'police',
  'safeguarding_lead',
  'local_authority',
  'no_one_yet',
] as const;

export type ImmediateActionCode = (typeof IMMEDIATE_ACTION_CODES)[number];

export const IMMEDIATE_ACTION_LABELS: Record<ImmediateActionCode, string> = {
  FIRST_AID: 'First aid given',
  INJURY_CHECK: 'Person checked for injuries',
  AREA_MADE_SAFE: 'Area made safe',
  EQUIPMENT_OUT_OF_USE: 'Equipment taken out of use',
  MEDICATION_WITHHELD: 'Medication withheld',
  EVIDENCE_PRESERVED: 'Evidence preserved',
  NO_ACTION_NEEDED: 'No action needed',
  OTHER: 'Other',
};

/**
 * Format a human incident reference: INC-2026-000128.
 * The sequence value is zero-padded to 6 digits.
 */
export function formatIncidentReference(
  year: number,
  sequence: number,
): string {
  return `INC-${year}-${String(sequence).padStart(6, '0')}`;
}
