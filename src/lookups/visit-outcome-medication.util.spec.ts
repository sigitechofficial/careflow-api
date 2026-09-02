import { MedicationStatusCodeFieldRequirement } from '@prisma/client';
import {
  isRecordableMedicationStatusCode,
  mapMedicationOutcomesFromStatusCodes,
  medicationAllowsReasons,
} from './visit-outcome-medication.util';

describe('visit-outcome-medication.util', () => {
  it('skips Pending from the carer catalog', () => {
    expect(isRecordableMedicationStatusCode('Pending')).toBe(false);
    expect(isRecordableMedicationStatusCode('G')).toBe(true);
  });

  it('allows reasons only when the MAR status requires or optionally wants a reason', () => {
    expect(
      medicationAllowsReasons(MedicationStatusCodeFieldRequirement.NOT_REQUIRED),
    ).toBe(false);
    expect(
      medicationAllowsReasons(MedicationStatusCodeFieldRequirement.OPTIONAL),
    ).toBe(true);
    expect(
      medicationAllowsReasons(MedicationStatusCodeFieldRequirement.REQUIRED),
    ).toBe(true);
  });

  it('uses MAR status labels/colours and attaches nested reasons by code', () => {
    const mapped = mapMedicationOutcomesFromStatusCodes({
      statusCodes: [
        {
          code: 'G',
          label: 'Given',
          color: '#2E7D32',
          textColor: '#FFFFFF',
          reasonRequirement: MedicationStatusCodeFieldRequirement.NOT_REQUIRED,
          sortOrder: 10,
        },
        {
          code: 'R',
          label: 'Refused',
          color: '#E53935',
          textColor: '#FFFFFF',
          reasonRequirement: MedicationStatusCodeFieldRequirement.REQUIRED,
          sortOrder: 20,
        },
        {
          code: 'Pending',
          label: 'Pending',
          color: '#E0E0E0',
          textColor: '#424242',
          reasonRequirement: MedicationStatusCodeFieldRequirement.NOT_REQUIRED,
          sortOrder: 150,
        },
      ],
      reasonsByCode: new Map([
        [
          'R',
          [{ label: 'Client declined medication', requiresNotes: false, sortOrder: 10 }],
        ],
      ]),
    });

    expect(mapped.map((row) => row.code)).toEqual(['G', 'R']);
    expect(mapped[0]).toMatchObject({
      label: 'Given',
      color: '#2E7D32',
      allowsReasons: false,
      reasons: [],
    });
    expect(mapped[1].reasons).toEqual([
      {
        label: 'Client declined medication',
        requiresNotes: false,
        enabled: true,
        sortOrder: 10,
      },
    ]);
  });
});
