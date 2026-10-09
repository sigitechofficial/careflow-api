import { pickAssignmentForDay, previousDay } from './employee-pay-card-assignment.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const created = new Date('2026-10-09T10:00:00.000Z');

describe('pickAssignmentForDay', () => {
  // Carer on the shared card from the start, promoted to a personal card from 2026-11-01.
  const promotion = d('2026-11-01');
  const rows = [
    { id: 'old', payCardId: 'standard', effectiveFrom: null, effectiveTo: previousDay(promotion), createdAt: created },
    { id: 'new', payCardId: 'senior', effectiveFrom: promotion, effectiveTo: null, createdAt: created },
  ];

  it('keeps the old card for visits before the promotion date', () => {
    expect(pickAssignmentForDay(rows, '2026-10-31')?.payCardId).toBe('standard');
    expect(pickAssignmentForDay(rows, '2025-01-01')?.payCardId).toBe('standard');
  });

  it('uses the new card from the promotion date onwards', () => {
    expect(pickAssignmentForDay(rows, '2026-11-01')?.payCardId).toBe('senior');
    expect(pickAssignmentForDay(rows, '2027-03-15')?.payCardId).toBe('senior');
  });

  it('returns null before a first card that starts on a date (matching applies)', () => {
    const dated = [{ id: 'a', payCardId: 'senior', effectiveFrom: promotion, effectiveTo: null, createdAt: created }];
    expect(pickAssignmentForDay(dated, '2026-10-15')).toBeNull();
  });

  it('ignores a row replaced on the day it started', () => {
    const sameDay = [
      { id: 'a', payCardId: 'x', effectiveFrom: promotion, effectiveTo: previousDay(promotion), createdAt: created },
      { id: 'b', payCardId: 'y', effectiveFrom: promotion, effectiveTo: null, createdAt: new Date(created.getTime() + 1000) },
    ];
    expect(pickAssignmentForDay(sameDay, '2026-11-01')?.payCardId).toBe('y');
  });

  it('returns an unassigned period (null card) as its own row', () => {
    const unassigned = [
      { id: 'a', payCardId: 'standard', effectiveFrom: null, effectiveTo: d('2026-10-31'), createdAt: created },
      { id: 'b', payCardId: null, effectiveFrom: promotion, effectiveTo: null, createdAt: created },
    ];
    expect(pickAssignmentForDay(unassigned, '2026-11-05')?.payCardId).toBeNull();
  });
});
