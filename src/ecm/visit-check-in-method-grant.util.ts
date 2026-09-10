import { VisitCheckInMethodGrantStatus } from '@prisma/client';

export type CheckInMethodGrantSnapshot = {
  status: string;
  expiresAt: Date | string;
  consumedAt?: Date | string | null;
};

export function isAuthorisedManualGrantActive(
  grant: CheckInMethodGrantSnapshot | null | undefined,
  now = new Date(),
): boolean {
  if (!grant) return false;
  if (grant.status !== VisitCheckInMethodGrantStatus.AUTHORISED && grant.status !== 'AUTHORISED') {
    return false;
  }
  if (grant.consumedAt) return false;
  return !isCheckInMethodGrantExpired(grant, now);
}

/** Reuse the latest row instead of creating another request for the same visit day. */
export function shouldReuseCheckInMethodGrant(
  grant: CheckInMethodGrantSnapshot | null | undefined,
  now = new Date(),
): boolean {
  if (!grant) return false;
  if (isCheckInMethodGrantExpired(grant, now)) return false;
  if (grant.status === VisitCheckInMethodGrantStatus.PENDING || grant.status === 'PENDING') {
    return true;
  }
  return isAuthorisedManualGrantActive(grant, now);
}

function isCheckInMethodGrantExpired(
  grant: CheckInMethodGrantSnapshot,
  now: Date,
): boolean {
  const expires =
    grant.expiresAt instanceof Date ? grant.expiresAt : new Date(grant.expiresAt);
  return !Number.isFinite(expires.getTime()) || expires.getTime() <= now.getTime();
}

export function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export type VisitCheckInMethodGrantDto = {
  id: string;
  scheduledJobId: string;
  employeeId: string;
  employeeName: string | null;
  operationalDay: string;
  status: string;
  carerNote: string | null;
  officeNote: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  isMockedLocation: boolean;
  locationUnavailable: boolean;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  consumedAt: string | null;
  ecmExceptionId: string | null;
  manualEnabled: boolean;
};

export function mapVisitCheckInMethodGrant(
  row: {
    id: string;
    scheduledJobId: string;
    employeeId: string;
    operationalDay: string;
    status: string;
    carerNote: string | null;
    officeNote: string | null;
    latitude: unknown;
    longitude: unknown;
    accuracyMeters: unknown;
    distanceMeters: number | null;
    isMockedLocation: boolean;
    locationUnavailable: boolean;
    requestedAt: Date;
    expiresAt: Date;
    decidedAt: Date | null;
    decidedById: string | null;
    decidedByName: string | null;
    consumedAt: Date | null;
    ecmExceptionId: string | null;
  },
  opts?: { employeeName?: string | null; now?: Date },
): VisitCheckInMethodGrantDto {
  const now = opts?.now ?? new Date();
  return {
    id: row.id,
    scheduledJobId: row.scheduledJobId,
    employeeId: row.employeeId,
    employeeName: opts?.employeeName ?? null,
    operationalDay: row.operationalDay,
    status: row.status,
    carerNote: row.carerNote,
    officeNote: row.officeNote,
    latitude: toNullableNumber(row.latitude),
    longitude: toNullableNumber(row.longitude),
    accuracyMeters: toNullableNumber(row.accuracyMeters),
    distanceMeters: row.distanceMeters,
    isMockedLocation: row.isMockedLocation,
    locationUnavailable: row.locationUnavailable,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedById: row.decidedById,
    decidedByName: row.decidedByName,
    consumedAt: row.consumedAt?.toISOString() ?? null,
    ecmExceptionId: row.ecmExceptionId,
    manualEnabled: isAuthorisedManualGrantActive(row, now),
  };
}
