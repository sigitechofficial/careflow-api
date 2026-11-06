import { defaultExpiryFromValidity } from './validity-default.util';

describe('defaultExpiryFromValidity', () => {
  it('adds calendar months, clamping to the month end', () => {
    expect(defaultExpiryFromValidity(new Date('2026-01-15T00:00:00Z'), 36)?.toISOString()).toBe('2029-01-15T00:00:00.000Z');
    expect(defaultExpiryFromValidity(new Date('2026-08-31T00:00:00Z'), 6)?.toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });

  it('gives no default without a start date or a period', () => {
    expect(defaultExpiryFromValidity(null, 12)).toBeNull();
    expect(defaultExpiryFromValidity(new Date('2026-01-15T00:00:00Z'), null)).toBeNull();
    expect(defaultExpiryFromValidity(new Date('2026-01-15T00:00:00Z'), 0)).toBeNull();
    expect(defaultExpiryFromValidity(new Date('invalid'), 12)).toBeNull();
  });
});
