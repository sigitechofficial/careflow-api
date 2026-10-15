import { MedicationAdministrationStatus, MedicationStatusCode } from '@prisma/client';

export type MarCellState = 'due' | 'na' | 'prn' | 'recorded';

export type MarStatusDisplay = {
  code: string;
  label: string;
  color: string;
  textColor: string;
  requiresReview: boolean;
};

const DEFAULT_PENDING: MarStatusDisplay = {
  code: 'Pending',
  label: 'Pending',
  color: '#E0E0E0',
  textColor: '#424242',
  requiresReview: false,
};

const DEFAULT_DUE: MarStatusDisplay = {
  code: 'Due',
  label: 'Due',
  color: '#FEF3C7',
  textColor: '#92400E',
  requiresReview: false,
};

const DEFAULT_NA: MarStatusDisplay = {
  code: 'N/A',
  label: 'N/A',
  color: '#F3F4F6',
  textColor: '#6B7280',
  requiresReview: false,
};

export type MarEventStatusSource = {
  status: MedicationAdministrationStatus;
  statusCode?: string | null;
};

/** Prefer stored MAR code; fall back to Prisma enum mapping. */
export function resolveEventMarStatusCode(event: MarEventStatusSource): string {
  const code = event.statusCode?.trim();
  if (code) return code;
  return administrationStatusToCode(event.status);
}

/** Map Prisma administration enum → MAR short code (§6). */
export function administrationStatusToCode(status: MedicationAdministrationStatus): string {
  switch (status) {
    case MedicationAdministrationStatus.GIVEN:
      return 'G';
    case MedicationAdministrationStatus.REFUSED:
      return 'R';
    case MedicationAdministrationStatus.MISSED:
    case MedicationAdministrationStatus.NOT_GIVEN:
      return 'N';
    case MedicationAdministrationStatus.HELD:
      return 'U';
    case MedicationAdministrationStatus.CANCELLED:
      return 'C';
    case MedicationAdministrationStatus.PENDING:
      return 'Pending';
    default:
      return status;
  }
}

/** Map MAR short code → Prisma enum (prefer configured row when available). */
export function statusCodeToAdministrationStatus(
  code: string,
  row?: Pick<MedicationStatusCode, 'administrationStatus'> | null,
): MedicationAdministrationStatus {
  if (row?.administrationStatus) return row.administrationStatus;
  switch (code) {
    case 'G':
    case 'PG':
    case 'F':
    case 'I':
    case 'S':
    case 'T':
      return MedicationAdministrationStatus.GIVEN;
    case 'R':
      return MedicationAdministrationStatus.REFUSED;
    case 'N':
      return MedicationAdministrationStatus.MISSED;
    case 'C':
      return MedicationAdministrationStatus.CANCELLED;
    case 'U':
    case 'H':
    case 'A':
    case 'O':
    case 'P':
    case 'PCI':
      return MedicationAdministrationStatus.NOT_GIVEN;
    default:
      return MedicationAdministrationStatus.PENDING;
  }
}

export function buildStatusCodeMap(rows: MedicationStatusCode[]): Map<string, MedicationStatusCode> {
  const map = new Map<string, MedicationStatusCode>();
  for (const row of rows) {
    map.set(row.code, row);
  }
  return map;
}

export function displayForCode(
  code: string,
  statusByCode: Map<string, MedicationStatusCode>,
): MarStatusDisplay {
  const row = statusByCode.get(code);
  if (!row) {
    if (code === 'Due') return DEFAULT_DUE;
    if (code === 'N/A') return DEFAULT_NA;
    return { ...DEFAULT_PENDING, code, label: code };
  }
  return {
    code: row.code,
    label: row.label,
    color: row.color,
    textColor: row.textColor,
    requiresReview: row.managerReviewRequirement === 'REQUIRED',
  };
}

/**
 * True when the event is not yet reviewed and either its status code needs review
 * or it is a PRN dose given over its limits.
 */
export function eventPendingManagerReview(
  display: MarStatusDisplay,
  event: { managerReviewedAt: Date | null; prnOverLimit?: boolean | null } | null | undefined,
): boolean {
  return Boolean(
    event &&
      (display.requiresReview || event.prnOverLimit) &&
      event.managerReviewedAt == null,
  );
}

export function legendFromStatusCodes(rows: MedicationStatusCode[]): MarStatusDisplay[] {
  return rows
    .filter((r) => r.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => displayForCode(r.code, buildStatusCodeMap([r])));
}
