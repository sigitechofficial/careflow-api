import { compartmentDraftsFromSchedules, canLinkMedicationToPack } from './medication-pack-membership.util';
import { MedicationKind } from '@prisma/client';

describe('compartmentDraftsFromSchedules', () => {
  it('dedupes the same morning slot from two pack medicines', () => {
    const morning = {
      name: 'Morning',
      time: '08:00',
      windowStart: '07:00',
      windowEnd: '10:00',
      sortOrder: 1,
    };
    const drafts = compartmentDraftsFromSchedules([
      { dueTime: '08:00', round: morning },
      { dueTime: '08:00', round: morning },
    ]);
    expect(drafts).toEqual([
      {
        label: 'Morning',
        dueTime: '08:00',
        windowStart: '07:00',
        windowEnd: '10:00',
        sortOrder: 1,
      },
    ]);
  });

  it('falls back to due time when the schedule has no round', () => {
    expect(compartmentDraftsFromSchedules([{ dueTime: '08:00', round: null }])).toEqual([
      {
        label: '08:00',
        dueTime: '08:00',
        windowStart: null,
        windowEnd: null,
        sortOrder: 0,
      },
    ]);
  });
});

describe('canLinkMedicationToPack', () => {
  it('blocks PRN and controlled drugs', () => {
    expect(
      canLinkMedicationToPack({
        medicationKind: MedicationKind.PRN,
        isControlledMedication: false,
      }),
    ).toBe(false);
    expect(
      canLinkMedicationToPack({
        medicationKind: MedicationKind.REGULAR,
        isControlledMedication: true,
      }),
    ).toBe(false);
    expect(
      canLinkMedicationToPack({
        medicationKind: MedicationKind.REGULAR,
        isControlledMedication: false,
      }),
    ).toBe(true);
  });
});
