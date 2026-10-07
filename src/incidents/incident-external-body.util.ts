import type { IncidentExternalBody } from '@prisma/client';
import { dateOnlyKey } from './incident-investigation.util';

/**
 * External bodies involved alongside the internal investigation (local authority safeguarding,
 * police, CQC…). Pure rules shared by the service and its tests.
 */

export const EXTERNAL_BODY_TYPES = [
  'LOCAL_AUTHORITY_SAFEGUARDING',
  'POLICE',
  'CQC',
  'HSE',
  'CORONER',
  'COMMISSIONER',
  'OTHER',
] as const;
export type ExternalBodyType = (typeof EXTERNAL_BODY_TYPES)[number];

export const EXTERNAL_BODY_TYPE_LABELS: Record<ExternalBodyType, string> = {
  LOCAL_AUTHORITY_SAFEGUARDING: 'Local authority safeguarding',
  POLICE: 'Police',
  CQC: 'CQC',
  HSE: 'HSE',
  CORONER: 'Coroner',
  COMMISSIONER: 'Commissioner / ICB',
  OTHER: 'Other',
};

/** LEAD: they lead and we support · SUPPORTING: joint · INFORMED: information only. */
export const EXTERNAL_BODY_ROLES = ['LEAD', 'SUPPORTING', 'INFORMED'] as const;
export type ExternalBodyRole = (typeof EXTERNAL_BODY_ROLES)[number];

export const EXTERNAL_BODY_STATUSES = [
  'REFERRED',
  'IN_PROGRESS',
  'CONCLUDED',
  'NO_FURTHER_ACTION',
] as const;
export type ExternalBodyStatus = (typeof EXTERNAL_BODY_STATUSES)[number];

export const EXTERNAL_BODY_STATUS_LABELS: Record<ExternalBodyStatus, string> = {
  REFERRED: 'Referred',
  IN_PROGRESS: 'In progress',
  CONCLUDED: 'Concluded',
  NO_FURTHER_ACTION: 'No further action',
};

/** Still running: closing the incident while one of these is open needs a reason. */
export const OPEN_EXTERNAL_BODY_STATUSES: readonly ExternalBodyStatus[] = [
  'REFERRED',
  'IN_PROGRESS',
];

export function isExternalBodyOpen(status: string): boolean {
  return (OPEN_EXTERNAL_BODY_STATUSES as readonly string[]).includes(status);
}

export type ExternalBodyValues = {
  bodyType: string;
  organisationName: string | null;
  referredOn: string;
  status: string;
  outcome: string | null;
  outcomeDate: string | null;
};

/**
 * Problems with a body record (empty = valid). Dates are YYYY-MM-DD; `today` is the
 * organisation's operational day.
 */
export function externalBodyErrors(
  v: ExternalBodyValues,
  today: string,
): string[] {
  const errors: string[] = [];
  if (v.bodyType === 'OTHER' && !v.organisationName?.trim()) {
    errors.push('Name the organisation');
  }
  if (v.referredOn > today)
    errors.push('The referral date can’t be in the future');
  if (!isExternalBodyOpen(v.status)) {
    if (!v.outcome?.trim()) errors.push('Record their outcome');
    if (!v.outcomeDate) errors.push('Give the outcome date');
  }
  if (v.outcomeDate) {
    if (v.outcomeDate > today)
      errors.push('The outcome date can’t be in the future');
    if (v.outcomeDate < v.referredOn)
      errors.push('The outcome date can’t be before the referral');
  }
  return errors;
}

/** "Police (West Yorkshire Police)" — used in audit / timeline lines. */
export function externalBodyName(row: {
  bodyType: string;
  organisationName: string | null;
}): string {
  const label =
    EXTERNAL_BODY_TYPE_LABELS[row.bodyType as ExternalBodyType] ?? row.bodyType;
  const org = row.organisationName?.trim();
  if (!org) return label;
  return row.bodyType === 'OTHER' ? org : `${label} (${org})`;
}

/** Shape sent to the admin (dates as YYYY-MM-DD). */
export function mapExternalBody(row: IncidentExternalBody) {
  return {
    id: row.id,
    incidentId: row.incidentId,
    bodyType: row.bodyType,
    organisationName: row.organisationName,
    referredOn: dateOnlyKey(row.referredOn)!,
    referenceNumber: row.referenceNumber,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    role: row.role,
    status: row.status,
    outcome: row.outcome,
    outcomeDate: dateOnlyKey(row.outcomeDate),
    informationProvided: row.informationProvided,
    informationReceived: row.informationReceived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
