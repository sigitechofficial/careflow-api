import {
  IncidentPrivacyLevel,
  IncidentSeverity,
  IncidentStatus,
} from '@prisma/client';

/**
 * Allowed workflow transitions. The reporting → closure lifecycle plus the
 * pragmatic short-circuit paths for simple incidents and the reopen path.
 * Enforced in the service so statuses can never move arbitrarily.
 */
export const INCIDENT_STATUS_TRANSITIONS: Record<
  IncidentStatus,
  IncidentStatus[]
> = {
  [IncidentStatus.REPORTED]: [
    IncidentStatus.AWAITING_REVIEW,
    IncidentStatus.UNDER_INVESTIGATION,
  ],
  [IncidentStatus.AWAITING_REVIEW]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.ACTIONS_REQUIRED,
    IncidentStatus.AWAITING_CLOSURE,
  ],
  [IncidentStatus.UNDER_INVESTIGATION]: [
    IncidentStatus.ACTIONS_REQUIRED,
    IncidentStatus.AWAITING_CLOSURE,
  ],
  [IncidentStatus.ACTIONS_REQUIRED]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.AWAITING_CLOSURE,
  ],
  [IncidentStatus.AWAITING_CLOSURE]: [
    IncidentStatus.CLOSED,
    IncidentStatus.ACTIONS_REQUIRED,
    IncidentStatus.UNDER_INVESTIGATION,
  ],
  [IncidentStatus.CLOSED]: [IncidentStatus.REOPENED],
  [IncidentStatus.REOPENED]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.ACTIONS_REQUIRED,
    IncidentStatus.AWAITING_CLOSURE,
  ],
};

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
  IncidentStatus.AWAITING_REVIEW,
  IncidentStatus.UNDER_INVESTIGATION,
  IncidentStatus.ACTIONS_REQUIRED,
  IncidentStatus.AWAITING_CLOSURE,
  IncidentStatus.REOPENED,
];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  REPORTED: 'Reported',
  AWAITING_REVIEW: 'Awaiting Review',
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
export const IMMEDIATE_ACTION_CODES = [
  'FIRST_AID',
  'EMERGENCY_SERVICES',
  'GP_CONTACTED',
  'MANAGER_CONTACTED',
  'FAMILY_INFORMED',
  'AREA_MADE_SAFE',
  'MEDICATION_WITHHELD',
  'OTHER',
] as const;

export type ImmediateActionCode = (typeof IMMEDIATE_ACTION_CODES)[number];

export const IMMEDIATE_ACTION_LABELS: Record<ImmediateActionCode, string> = {
  FIRST_AID: 'First aid provided',
  EMERGENCY_SERVICES: 'Emergency services contacted',
  GP_CONTACTED: 'GP contacted',
  MANAGER_CONTACTED: 'Manager contacted',
  FAMILY_INFORMED: 'Family / NOK informed',
  AREA_MADE_SAFE: 'Area made safe',
  MEDICATION_WITHHELD: 'Medication withheld',
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
