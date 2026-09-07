import { pickEffectiveEmployeeFunderPayAssignment } from './pay-card-assignment.util';

describe('pickEffectiveEmployeeFunderPayAssignment', () => {
  const at = new Date('2026-09-07T12:00:00.000Z');

  it('picks employee+funder override effective on visit date', () => {
    const picked = pickEffectiveEmployeeFunderPayAssignment(
      [
        {
          id: 'a',
          employeeId: 'emp-1',
          funderId: 'council-a',
          payCardId: 'card-15',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
        },
        {
          id: 'b',
          employeeId: 'emp-1',
          funderId: 'council-b',
          payCardId: 'card-17',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      ].filter((r) => r.funderId === 'council-b'),
      at,
    );
    expect(picked?.payCardId).toBe('card-17');
  });

  it('ignores expired and future assignments', () => {
    const picked = pickEffectiveEmployeeFunderPayAssignment(
      [
        {
          id: 'old',
          employeeId: 'emp-1',
          funderId: 'council-a',
          payCardId: 'card-old',
          effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2025-12-31T00:00:00.000Z'),
        },
        {
          id: 'future',
          employeeId: 'emp-1',
          funderId: 'council-a',
          payCardId: 'card-future',
          effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
          effectiveTo: null,
        },
        {
          id: 'current',
          employeeId: 'emp-1',
          funderId: 'council-a',
          payCardId: 'card-current',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      ],
      at,
    );
    expect(picked?.payCardId).toBe('card-current');
  });

  it('returns null when no effective override exists (fallback to default card)', () => {
    const picked = pickEffectiveEmployeeFunderPayAssignment([], at);
    expect(picked).toBeNull();
  });
});
