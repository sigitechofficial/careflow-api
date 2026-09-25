import {
  loadScheduledMedicationDueTimes,
  resolveMedicationRequiredForSlot,
} from './visit-medication-required.util';

describe('visit-medication-required.util', () => {
  it('is true when a dueTime falls in the slot window', () => {
    expect(
      resolveMedicationRequiredForSlot({
        plannedStartTime: '09:00',
        plannedEndTime: '10:00',
        scheduledDueTimes: ['07:00', '09:30'],
      }),
    ).toBe(true);
  });

  it('is false when no dueTime falls in the slot window', () => {
    expect(
      resolveMedicationRequiredForSlot({
        plannedStartTime: '06:00',
        plannedEndTime: '08:00',
        scheduledDueTimes: ['09:30', '18:00'],
      }),
    ).toBe(false);
  });

  it('is false when slot times are missing', () => {
    expect(
      resolveMedicationRequiredForSlot({
        plannedStartTime: null,
        plannedEndTime: '10:00',
        scheduledDueTimes: ['09:30'],
      }),
    ).toBe(false);
  });

  it('loads due times from active non-PRN schedules', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        schedules: [{ dueTime: '09:30' }, { dueTime: '18:00' }],
      },
    ]);
    const times = await loadScheduledMedicationDueTimes(
      { serviceUserMedication: { findMany } } as never,
      'su-1',
    );
    expect(times.sort()).toEqual(['09:30', '18:00']);
  });
});
