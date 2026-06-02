import { MedicationKind } from '@prisma/client';
import { computeSchedulePreview } from './medication-schedule-preview.util';

describe('computeSchedulePreview', () => {
  it('counts daily slots for 30 days with 3 times', () => {
    const result = computeSchedulePreview({
      startDate: '2026-05-01',
      endDate: '2026-05-30',
      medicationKind: MedicationKind.REGULAR,
      schedules: [
        { dueTime: '08:00', roundName: 'Morning' },
        { dueTime: '12:00', roundName: 'Midday' },
        { dueTime: '18:00', roundName: 'Evening' },
      ],
    });
    expect(result.dayCount).toBe(30);
    expect(result.totalDueSlots).toBe(90);
    expect(result.scheduleType).toBe('daily');
  });

  it('returns zero for PRN with note', () => {
    const result = computeSchedulePreview({
      startDate: '2026-05-01',
      endDate: '2026-05-30',
      medicationKind: MedicationKind.PRN,
      schedules: [{ dueTime: '08:00' }],
    });
    expect(result.totalDueSlots).toBe(0);
    expect(result.prnNote).toBeTruthy();
  });
});
