import {
  actorDisplayName,
  normalizeOptionalLocationId,
  toIsoDate,
  toLocationAudit,
} from './location-management.util';

describe('location-management audit helpers', () => {
  it('prefers full name then email', () => {
    expect(
      actorDisplayName({ firstName: 'Super', lastName: 'Admin', email: 'a@x.com' }),
    ).toBe('Super Admin');
    expect(actorDisplayName({ firstName: null, lastName: null, email: 'a@x.com' })).toBe(
      'a@x.com',
    );
    expect(actorDisplayName(null)).toBeNull();
  });

  it('serializes dates and actor names', () => {
    const createdAt = new Date('2026-09-06T10:00:00.000Z');
    expect(
      toLocationAudit({
        createdAt,
        updatedAt: createdAt,
        createdBy: { firstName: 'Super', lastName: 'Admin', email: 'a@x.com' },
        updatedBy: null,
      }),
    ).toEqual({
      createdAt: '2026-09-06T10:00:00.000Z',
      updatedAt: '2026-09-06T10:00:00.000Z',
      createdByName: 'Super Admin',
      updatedByName: null,
    });
    expect(toIsoDate(null)).toBeNull();
  });

  it('treats blank locationId as unscoped', () => {
    expect(normalizeOptionalLocationId('  ')).toBeUndefined();
    expect(normalizeOptionalLocationId('loc-1')).toBe('loc-1');
  });
});
