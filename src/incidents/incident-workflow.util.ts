import {
  IncidentPrivacyLevel,
  IncidentSeverity,
  IncidentStatus,
} from '@prisma/client';
import { operationalDayBounds } from '../common/utils/operational-day.util';

/**
 * Allowed workflow transitions.
 * Primary path: Raise (REPORTED) → Investigate → AWAITING_CLOSURE → CLOSED.
 * Re-investigate returns to UNDER_INVESTIGATION from CLOSED / AWAITING_CLOSURE.
 * Legacy statuses remain reachable for existing rows.
 */
export const INCIDENT_STATUS_TRANSITIONS: Record<
  IncidentStatus,
  IncidentStatus[]
> = {
  [IncidentStatus.REPORTED]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.AWAITING_REVIEW,
  ],
  [IncidentStatus.AWAITING_REVIEW]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.ACTIONS_REQUIRED,
    IncidentStatus.AWAITING_CLOSURE,
  ],
  [IncidentStatus.UNDER_INVESTIGATION]: [
    IncidentStatus.AWAITING_CLOSURE,
    IncidentStatus.ACTIONS_REQUIRED,
  ],
  [IncidentStatus.ACTIONS_REQUIRED]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.AWAITING_CLOSURE,
  ],
  [IncidentStatus.AWAITING_CLOSURE]: [
    IncidentStatus.CLOSED,
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.ACTIONS_REQUIRED,
  ],
  [IncidentStatus.CLOSED]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.REOPENED,
  ],
  [IncidentStatus.REOPENED]: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.AWAITING_CLOSURE,
    IncidentStatus.ACTIONS_REQUIRED,
  ],
};

/** Statuses from which moving to UNDER_INVESTIGATION counts as re-investigate. */
export const REINVESTIGATE_FROM_STATUSES: IncidentStatus[] = [
  IncidentStatus.CLOSED,
  IncidentStatus.AWAITING_CLOSURE,
  IncidentStatus.REOPENED,
];

export function isReinvestigateTransition(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  return (
    to === IncidentStatus.UNDER_INVESTIGATION &&
    REINVESTIGATE_FROM_STATUSES.includes(from)
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
