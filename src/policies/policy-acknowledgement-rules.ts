import { PolicyAcknowledgementStatus } from '@prisma/client';
import { RBAC_LEVEL_TO_IDENTITY_ROLE_NAME } from '../employee-employment/rbac-employment-sync.config';
import type { PolicyMatchContext } from './policy-targeting';

/**
 * Staff read-and-acknowledge rules (pure; the service does the loading).
 *
 * - A staff member must acknowledge a policy when its current version is PUBLISHED, has
 *   acknowledgementRequired, and the employee matches the version's audience and applicability.
 * - Minor versions do not need re-acknowledging: an acknowledgement of any earlier published version
 *   of the same document with the same major number counts. A new major version needs a new one.
 * - Staff have 14 days. The clock starts when the major version first needed acknowledging (a minor
 *   correction does not restart it), or on the employee's start date for staff who joined later.
 */

export const POLICY_ACKNOWLEDGEMENT_DUE_DAYS = 14;

export const POLICY_ACKNOWLEDGEMENT_CHANNEL = {
  WEB: 'WEB',
  EMPLOYEE_APP: 'EMPLOYEE_APP',
} as const;

export type PolicyAcknowledgementChannel =
  (typeof POLICY_ACKNOWLEDGEMENT_CHANNEL)[keyof typeof POLICY_ACKNOWLEDGEMENT_CHANNEL];

const DAY_MS = 24 * 60 * 60 * 1000;

export type EmploymentTargetingFields = {
  roleId: string | null;
  jobTitleId: string | null;
  workAreaId: string | null;
  locationId: string | null;
  baseLocationId: string | null;
  floorLocations?: Array<{ locationId: string }>;
  rbacLevel?: { name: string } | null;
};

/** Branch ids for an employee (same derivation as users.service employmentLocationIdsForEmail). */
export function employmentBranchIds(employment: EmploymentTargetingFields | null | undefined): string[] {
  if (!employment) return [];
  const ids = new Set<string>();
  if (employment.locationId) ids.add(employment.locationId);
  if (employment.baseLocationId) ids.add(employment.baseLocationId);
  for (const floor of employment.floorLocations ?? []) ids.add(floor.locationId);
  return [...ids];
}

/** Identity role name implied by the employment RBAC level (see RbacEmploymentSyncService). */
export function identityRoleNameForRbacLevel(rbacLevelName: string | null | undefined): string | null {
  const name = rbacLevelName?.trim();
  if (!name) return null;
  return RBAC_LEVEL_TO_IDENTITY_ROLE_NAME[name] ?? name;
}

/**
 * Policy match context for an employee (not a signed-in user):
 * roleIds = employment role + identity role of the employment RBAC level + roles of a linked User
 * account (same email); assignedLocationIds = employment branches, or null (unrestricted) when the
 * employee has none. No link query and no service context — staff duties are organisation-level.
 */
export function buildEmployeeMatchContext(params: {
  employment: EmploymentTargetingFields | null | undefined;
  /** Identity Role ids from the linked User account and the RBAC-level mapping. */
  identityRoleIds?: string[];
}): PolicyMatchContext {
  const employment = params.employment ?? null;
  const roleIds = new Set<string>(params.identityRoleIds ?? []);
  if (employment?.roleId) roleIds.add(employment.roleId);
  const branches = employmentBranchIds(employment);
  return {
    assignedLocationIds: branches.length ? branches : null,
    roleIds: [...roleIds],
    jobTitleId: employment?.jobTitleId ?? null,
    workAreaId: employment?.workAreaId ?? null,
    serviceTypeCode: null,
    locationId: null,
  };
}

export type AckVersionRow = {
  id: string;
  versionMajor: number;
  versionMinor: number;
  publishedAt: Date | null;
  acknowledgementRequired: boolean;
};

export type AckRow = {
  id: string;
  versionId: string;
  status: PolicyAcknowledgementStatus;
  viewedAt: Date | null;
  acknowledgedAt: Date | null;
};

export type AcknowledgementState = {
  status: PolicyAcknowledgementStatus;
  viewedAt: Date | null;
  acknowledgedAt: Date | null;
  /** Version whose acknowledgement counts (current, or an earlier minor of the same major). */
  acknowledgedVersionId: string | null;
  dueAt: Date | null;
  overdue: boolean;
};

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * When the obligation started for the current version: the first publication, in the same major
 * line, of a version that required acknowledgement (minor corrections do not restart the clock).
 */
export function acknowledgementClockStart(current: AckVersionRow, versions: AckVersionRow[]): Date | null {
  const candidates = [current, ...versions].filter(
    (v) =>
      v.versionMajor === current.versionMajor &&
      v.versionMinor <= current.versionMinor &&
      v.acknowledgementRequired &&
      v.publishedAt,
  );
  let earliest: Date | null = null;
  for (const v of candidates) {
    if (!earliest || v.publishedAt!.getTime() < earliest.getTime()) earliest = v.publishedAt!;
  }
  return earliest;
}

/** Due date = clock start + 14 days; staff who started after the clock started get 14 days from their start. */
export function acknowledgementDueAt(clockStart: Date | null, employeeStartedAt?: Date | null): Date | null {
  if (!clockStart) return null;
  const start =
    employeeStartedAt && employeeStartedAt.getTime() > clockStart.getTime() ? employeeStartedAt : clockStart;
  return addDays(start, POLICY_ACKNOWLEDGEMENT_DUE_DAYS);
}

export function isAcknowledgementOverdue(
  dueAt: Date | null,
  acknowledgedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!dueAt || acknowledgedAt) return false;
  return now.getTime() > dueAt.getTime();
}

/**
 * Status for one employee against the current published version.
 * An ACKNOWLEDGED row for the current version, or for an earlier published minor version of the
 * same major, counts. Viewing is tracked on the current version only.
 */
export function resolveAcknowledgementState(params: {
  current: AckVersionRow;
  /** Every version of the document (only published ones are considered for carry-over). */
  versions: AckVersionRow[];
  /** This employee's acknowledgement rows for the document's versions. */
  acknowledgements: AckRow[];
  employeeStartedAt?: Date | null;
  now?: Date;
}): AcknowledgementState {
  const { current } = params;
  const byId = new Map(params.versions.map((v) => [v.id, v]));
  byId.set(current.id, current);

  const counting = params.acknowledgements
    .filter((row) => row.status === PolicyAcknowledgementStatus.ACKNOWLEDGED && row.acknowledgedAt)
    .filter((row) => {
      if (row.versionId === current.id) return true;
      const version = byId.get(row.versionId);
      return (
        !!version &&
        !!version.publishedAt &&
        version.versionMajor === current.versionMajor &&
        version.versionMinor < current.versionMinor
      );
    })
    .sort((a, b) => b.acknowledgedAt!.getTime() - a.acknowledgedAt!.getTime());

  const own = params.acknowledgements.find((row) => row.versionId === current.id) ?? null;
  const dueAt = acknowledgementDueAt(acknowledgementClockStart(current, params.versions), params.employeeStartedAt);
  const ack = counting[0] ?? null;

  if (ack) {
    return {
      status: PolicyAcknowledgementStatus.ACKNOWLEDGED,
      viewedAt: own?.viewedAt ?? ack.viewedAt ?? null,
      acknowledgedAt: ack.acknowledgedAt,
      acknowledgedVersionId: ack.versionId,
      dueAt,
      overdue: false,
    };
  }

  const viewedAt = own?.viewedAt ?? null;
  return {
    status: viewedAt ? PolicyAcknowledgementStatus.VIEWED : PolicyAcknowledgementStatus.PENDING,
    viewedAt,
    acknowledgedAt: null,
    acknowledgedVersionId: null,
    dueAt,
    overdue: isAcknowledgementOverdue(dueAt, null, params.now),
  };
}

/** Manager report totals. viewedOnly = opened but not acknowledged; notOpened = never opened. */
export function summariseAcknowledgementStates(states: Array<Pick<AcknowledgementState, 'status' | 'overdue'>>) {
  const totals = { required: states.length, acknowledged: 0, viewedOnly: 0, notOpened: 0, overdue: 0 };
  for (const state of states) {
    if (state.status === PolicyAcknowledgementStatus.ACKNOWLEDGED) totals.acknowledged += 1;
    else if (state.status === PolicyAcknowledgementStatus.VIEWED) totals.viewedOnly += 1;
    else totals.notOpened += 1;
    if (state.overdue) totals.overdue += 1;
  }
  return totals;
}

/** Manager branch scope: null = all employees; otherwise employees in at least one of the manager's branches. */
export function employeeInManagerScope(
  managerLocationIds: string[] | null | undefined,
  employeeBranchIds: string[],
): boolean {
  if (managerLocationIds == null) return true;
  return employeeBranchIds.some((id) => managerLocationIds.includes(id));
}
