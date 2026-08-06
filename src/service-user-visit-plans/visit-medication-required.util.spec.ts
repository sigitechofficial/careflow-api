import {
  loadRoundsWithScheduledMedication,
  resolveMedicationRequiredForSlot,
} from './visit-medication-required.util';

describe('visit-medication-required.util', () => {
  it('is false when slot has a round code but no scheduled meds for that round', () => {
    expect(
      resolveMedicationRequiredForSlot({
        medicationRoundCode: 'MORNING',
        slotCode: 'MORNING',
        roundsWithScheduledMedication: new Set(['MIDDAY']),
      }),
    ).toBe(false);
  });

  it('is true when SU has scheduled meds for the slot round', () => {
    expect(
      resolveMedicationRequiredForSlot({
        medicationRoundCode: 'MORNING',
        slotCode: 'MORNING',
        roundsWithScheduledMedication: new Set(['MORNING', 'EVENING']),
      }),
    ).toBe(true);
  });

  it('is false when there is no round/slot code', () => {
    expect(
      resolveMedicationRequiredForSlot({
        medicationRoundCode: null,
        slotCode: null,
        roundsWithScheduledMedication: new Set(['MORNING']),
      }),
    ).toBe(false);
  });

  it('loads round codes from active non-PRN schedules', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        schedules: [
          { round: { code: 'morning' } },
          { round: { code: 'EVENING' } },
        ],
      },
    ]);
    const rounds = await loadRoundsWithScheduledMedication(
      { serviceUserMedication: { findMany } } as never,
      'su-1',
    );
    expect([...rounds].sort()).toEqual(['EVENING', 'MORNING']);
  });
});
