import { EmployeeComplianceStatus } from '@prisma/client';
import {
  calculateComplianceStatus,
  isExpired,
  isExpiringSoon,
  startOfUtcDay,
} from './compliance-status.calculator';

describe('compliance-status.calculator', () => {
  const baseType = {
    hasExpiry: true,
    requiresDocument: true,
    requiresVerification: true,
  };

  it('startOfUtcDay normalizes to UTC midnight', () => {
    const d = new Date('2026-06-15T22:00:00.000Z');
    const s = startOfUtcDay(d);
    expect(s.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('isExpired uses UTC day boundary', () => {
    const today = new Date('2026-05-20T12:00:00.000Z');
    expect(isExpired(new Date('2026-05-19T23:59:59.999Z'), today)).toBe(true);
    expect(isExpired(new Date('2026-05-20T00:00:00.000Z'), today)).toBe(false);
    expect(isExpired(new Date('2026-05-21T00:00:00.000Z'), today)).toBe(false);
  });

  it('isExpiringSoon respects renewal window', () => {
    const today = new Date('2026-05-20T12:00:00.000Z');
    expect(isExpiringSoon(new Date('2026-06-10T00:00:00.000Z'), 30, today)).toBe(true);
    expect(isExpiringSoon(new Date('2026-08-01T00:00:00.000Z'), 30, today)).toBe(false);
  });

  it('returns REJECTED when rejectedAt set', () => {
    const st = calculateComplianceStatus(
      {
        rejectedAt: new Date(),
        submittedAt: null,
        verifiedAt: null,
        expiryDate: null,
        issueDate: null,
        isNoLongerRequired: false,
        documentUrl: null,
      },
      baseType,
      30,
      true,
    );
    expect(st).toBe(EmployeeComplianceStatus.REJECTED);
  });

  it('returns NO_LONGER_REQUIRED when flag set', () => {
    const st = calculateComplianceStatus(
      {
        rejectedAt: null,
        submittedAt: null,
        verifiedAt: null,
        expiryDate: null,
        issueDate: null,
        isNoLongerRequired: true,
        documentUrl: null,
      },
      baseType,
      30,
      false,
    );
    expect(st).toBe(EmployeeComplianceStatus.NO_LONGER_REQUIRED);
  });

  it('returns MISSING when document required and none', () => {
    const st = calculateComplianceStatus(
      {
        rejectedAt: null,
        submittedAt: null,
        verifiedAt: null,
        expiryDate: null,
        issueDate: null,
        isNoLongerRequired: false,
        documentUrl: null,
      },
      baseType,
      30,
      false,
    );
    expect(st).toBe(EmployeeComplianceStatus.MISSING);
  });

  it('returns PENDING_REVIEW when submitted and verification required', () => {
    const st = calculateComplianceStatus(
      {
        rejectedAt: null,
        submittedAt: new Date(),
        verifiedAt: null,
        expiryDate: null,
        issueDate: null,
        isNoLongerRequired: false,
        documentUrl: null,
      },
      baseType,
      30,
      true,
    );
    expect(st).toBe(EmployeeComplianceStatus.PENDING_REVIEW);
  });

  it('returns VALID when verified and not expired', () => {
    const st = calculateComplianceStatus(
      {
        rejectedAt: null,
        submittedAt: new Date(),
        verifiedAt: new Date(),
        expiryDate: new Date('2030-01-01T00:00:00.000Z'),
        issueDate: null,
        isNoLongerRequired: false,
        documentUrl: null,
      },
      baseType,
      30,
      true,
      new Date('2026-05-20T12:00:00.000Z'),
    );
    expect(st).toBe(EmployeeComplianceStatus.VALID);
  });
});
