import { ComplianceCategory } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { CARE_COMPLIANCE_CATALOG } from './care-compliance-catalog';
import {
  DEPRECATED_COMPLIANCE_CODES,
  WORKFORCE_CERTIFICATION_NAMES,
  WORKFORCE_COMPLIANCE_ADDITIONS,
  WORKFORCE_COMPLIANCE_SUPPLEMENT,
  WORKFORCE_REVIEW_TYPES,
  WORKFORCE_SKILL_NAMES,
} from './workforce-catalog';

describe('workforce-catalog', () => {
  it('compliance codes are unique across legacy + supplement + additions', () => {
    const codes = [
      ...CARE_COMPLIANCE_CATALOG.map((c) => c.code),
      ...WORKFORCE_COMPLIANCE_SUPPLEMENT.map((c) => c.code),
      ...WORKFORCE_COMPLIANCE_ADDITIONS.map((c) => c.code),
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('expiring compliance types have defaultValidityMonths when hasExpiry is true', () => {
    for (const t of WORKFORCE_COMPLIANCE_ADDITIONS) {
      if (t.hasExpiry) {
        expect(t.defaultValidityMonths).toBeGreaterThan(0);
      }
    }
  });

  it('compliance categories are valid enum values', () => {
    const valid = new Set(Object.values(ComplianceCategory));
    for (const t of WORKFORCE_COMPLIANCE_ADDITIONS) {
      expect(valid.has(t.category)).toBe(true);
    }
  });

  it('deprecated supervision codes exist in legacy catalog only', () => {
    const legacyCodes = new Set(CARE_COMPLIANCE_CATALOG.map((c) => c.code));
    for (const code of DEPRECATED_COMPLIANCE_CODES) {
      expect(legacyCodes.has(code)).toBe(true);
    }
  });

  it('skill and certification names are unique', () => {
    expect(new Set(WORKFORCE_SKILL_NAMES).size).toBe(WORKFORCE_SKILL_NAMES.length);
    expect(new Set(WORKFORCE_CERTIFICATION_NAMES).size).toBe(WORKFORCE_CERTIFICATION_NAMES.length);
  });

  it('review type codes are unique', () => {
    const codes = WORKFORCE_REVIEW_TYPES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
