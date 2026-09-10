import {
  employeeAppAccessPayload,
  employeeAppKeySafePayload,
} from './employee-app-access.util';

describe('employee-app-access.util', () => {
  const addr = {
    addressLine1: '14 Elm Court',
    addressLine2: null,
    town: 'Riverside',
    postcode: 'SW1A 1AA',
    keySafeNumber: ' 4821 ',
    accessInstructions: '  Key safe left of front door. ',
    accessMethod: 'key_safe',
    keySafeLocation: '  Left of front door ',
    deletedAt: null,
  };

  it('maps office address fields onto visit keySafe', () => {
    expect(employeeAppKeySafePayload(addr)).toEqual({
      address: '14 Elm Court, Riverside, SW1A 1AA',
      code: '4821',
      accessNote: 'Key safe left of front door.',
      accessMethod: 'key_safe',
      accessMethodLabel: 'Key safe',
      keySafeLocation: 'Left of front door',
    });
  });

  it('maps the same fields onto client profile access', () => {
    expect(employeeAppAccessPayload(addr)).toEqual({
      keySafeCode: '4821',
      note: 'Key safe left of front door.',
      address: '14 Elm Court, Riverside, SW1A 1AA',
      accessMethod: 'key_safe',
      accessMethodLabel: 'Key safe',
      keySafeLocation: 'Left of front door',
    });
  });

  it('returns null when nothing is set', () => {
    expect(employeeAppKeySafePayload({ keySafeNumber: '  ', accessInstructions: '' })).toBeNull();
    expect(employeeAppAccessPayload(null)).toBeNull();
  });
});
