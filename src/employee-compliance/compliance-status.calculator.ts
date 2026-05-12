import { EmployeeComplianceStatus } from '@prisma/client';

/** UTC calendar-day start for consistent expiry rules (documented in README). */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isExpired(
  expiryDate: Date | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!expiryDate) return false;
  return startOfUtcDay(expiryDate).getTime() < startOfUtcDay(today).getTime();
}

/** True when expiry is today or in the future within `renewalBeforeDays` (inclusive of today). */
export function isExpiringSoon(
  expiryDate: Date | null | undefined,
  renewalBeforeDays: number,
  today: Date = new Date(),
): boolean {
  if (!expiryDate || renewalBeforeDays < 0) return false;
  if (isExpired(expiryDate, today)) return false;
  const t0 = startOfUtcDay(today).getTime();
  const exp = startOfUtcDay(expiryDate).getTime();
  const horizon = t0 + renewalBeforeDays * 86_400_000;
  return exp <= horizon;
}

export type ComplianceTypeCalc = {
  hasExpiry: boolean;
  requiresDocument: boolean;
  requiresVerification: boolean;
};

export type EmployeeComplianceCalc = {
  rejectedAt: Date | null;
  submittedAt: Date | null;
  verifiedAt: Date | null;
  expiryDate: Date | null;
  issueDate: Date | null;
  isNoLongerRequired: boolean;
  documentUrl: string | null;
};

export function calculateComplianceStatus(
  row: EmployeeComplianceCalc,
  type: ComplianceTypeCalc | null,
  renewalBeforeDays: number,
  hasNonDeletedDocument: boolean,
  today: Date = new Date(),
): EmployeeComplianceStatus {
  if (row.isNoLongerRequired) return EmployeeComplianceStatus.NO_LONGER_REQUIRED;
  if (row.rejectedAt) return EmployeeComplianceStatus.REJECTED;

  const hasDoc = hasNonDeletedDocument || Boolean(row.documentUrl?.trim());
  const hasExpiry = type?.hasExpiry !== false;
  const requiresDoc = type?.requiresDocument !== false;
  const requiresVerification = type?.requiresVerification !== false;

  if (hasExpiry && row.expiryDate && isExpired(row.expiryDate, today)) {
    return EmployeeComplianceStatus.EXPIRED;
  }

  if (row.verifiedAt) {
    if (hasExpiry && row.expiryDate && isExpiringSoon(row.expiryDate, renewalBeforeDays, today)) {
      return EmployeeComplianceStatus.EXPIRING_SOON;
    }
    return EmployeeComplianceStatus.VALID;
  }

  if (row.submittedAt) {
    if (requiresVerification) {
      return EmployeeComplianceStatus.PENDING_REVIEW;
    }
    if (hasExpiry && row.expiryDate && isExpiringSoon(row.expiryDate, renewalBeforeDays, today)) {
      return EmployeeComplianceStatus.EXPIRING_SOON;
    }
    return EmployeeComplianceStatus.VALID;
  }

  if (requiresDoc && !hasDoc) {
    return EmployeeComplianceStatus.MISSING;
  }

  return EmployeeComplianceStatus.REQUIRED;
}
