import {
  applyImmigrationRtwRequirementFlags,
  isImmigrationRtwDocCode,
  matchesNeedsImmigrationRtwFilter,
  requiresImmigrationRtwDocuments,
} from './immigration-rtw-requirement.util';

describe('immigration-rtw-requirement.util', () => {
  it('identifies biometric and share-code codes', () => {
    expect(isImmigrationRtwDocCode('BIOMETRIC_CARD')).toBe(true);
    expect(isImmigrationRtwDocCode('employee_share_code')).toBe(true);
    expect(isImmigrationRtwDocCode('HOME_OFFICE_LETTER')).toBe(false);
    expect(isImmigrationRtwDocCode('DBS')).toBe(false);
  });

  it('does not require immigration RTW for British/Irish/not_applicable', () => {
    expect(requiresImmigrationRtwDocuments('british_citizen')).toBe(false);
    expect(requiresImmigrationRtwDocuments('irish_citizen')).toBe(false);
    expect(requiresImmigrationRtwDocuments('not_applicable')).toBe(false);
  });

  it('requires immigration RTW for visa / limited leave routes', () => {
    expect(requiresImmigrationRtwDocuments('skilled_worker')).toBe(true);
    expect(requiresImmigrationRtwDocuments('health_care_worker')).toBe(true);
    expect(requiresImmigrationRtwDocuments('student_visa')).toBe(true);
    expect(requiresImmigrationRtwDocuments('settled_status')).toBe(true);
    expect(requiresImmigrationRtwDocuments('pre_settled_euss')).toBe(true);
  });

  it('does not force RTW when immigration status is unset', () => {
    expect(requiresImmigrationRtwDocuments(null)).toBe(false);
    expect(requiresImmigrationRtwDocuments(undefined)).toBe(false);
    expect(requiresImmigrationRtwDocuments('unknown_status')).toBe(false);
  });

  it('forces biometric mandatory for outsiders and off for British', () => {
    const base = { isMandatory: false, blocksAllocation: false };
    expect(applyImmigrationRtwRequirementFlags('BIOMETRIC_CARD', 'skilled_worker', base)).toEqual({
      isMandatory: true,
      blocksAllocation: true,
    });
    expect(applyImmigrationRtwRequirementFlags('BIOMETRIC_CARD', 'british_citizen', base)).toEqual({
      isMandatory: false,
      blocksAllocation: false,
    });
    expect(applyImmigrationRtwRequirementFlags('DBS', 'skilled_worker', { isMandatory: true, blocksAllocation: true })).toEqual({
      isMandatory: true,
      blocksAllocation: true,
    });
  });

  it('keeps British citizens when filtering to No RTW required', () => {
    expect(matchesNeedsImmigrationRtwFilter('british_citizen', false)).toBe(true);
    expect(matchesNeedsImmigrationRtwFilter('irish_citizen', false)).toBe(true);
    expect(matchesNeedsImmigrationRtwFilter('british_citizen', true)).toBe(false);
    expect(matchesNeedsImmigrationRtwFilter('skilled_worker', false)).toBe(false);
    expect(matchesNeedsImmigrationRtwFilter('skilled_worker', true)).toBe(true);
    expect(matchesNeedsImmigrationRtwFilter('british_citizen', undefined)).toBe(true);
  });
});
