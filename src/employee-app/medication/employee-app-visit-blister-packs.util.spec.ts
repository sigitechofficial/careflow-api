import { MedicationPackStatus, MedicationPackType } from '@prisma/client';
import { buildVisitBlisterPacks } from './employee-app-visit-blister-packs.util';

describe('employee-app-visit-blister-packs.util', () => {
  it('groups pack medicines by visit round compartment', () => {
    const packs = buildVisitBlisterPacks({
      visitRound: { code: 'MORNING', name: 'Morning', dueTime: '08:00' },
      allergyLower: [],
      eventByMed: new Map(),
      packs: [
        {
          id: 'pack-1',
          name: 'Morning blister',
          packType: MedicationPackType.BLISTER,
          status: MedicationPackStatus.ACTIVE,
          roundLabel: 'Morning',
          compartments: [
            {
              id: 'comp-am',
              label: 'Morning',
              dueTime: '08:00',
              windowStart: '07:00',
              windowEnd: '10:00',
              witnessRequired: false,
            },
            {
              id: 'comp-pm',
              label: 'Evening',
              dueTime: '18:00',
              windowStart: null,
              windowEnd: null,
              witnessRequired: false,
            },
          ],
          members: [
            {
              id: 'member-1',
              serviceUserMedicationId: 'med-1',
              serviceUserMedication: {
                id: 'med-1',
                medicationName: 'Paracetamol',
                dose: '1 tablet',
                strength: '500mg',
                instructions: null,
                howAssisted: 'Prompting',
                isControlledMedication: false,
                route: { name: 'Oral' },
                medicationPack: null,
                schedules: [{ id: 'sch-1', dueTime: '08:00', round: { name: 'Morning' } }],
              },
            },
          ],
        },
      ],
    });

    expect(packs).toHaveLength(1);
    expect(packs[0]?.compartments).toHaveLength(1);
    expect(packs[0]?.compartments[0]?.medicines[0]?.scheduledDoseId).toBe('med-1:08:00');
    expect(packs[0]?.compartments[0]?.canRecordRound).toBe(true);
    expect(packs[0]?.compartments[0]?.medicines[0]?.done).toBe(false);
    expect(packs[0]?.compartments[0]?.medicines[0]?.howAssisted).toBe('Prompting');
  });

  it('echoes MAR admin fields on recorded blister medicines', () => {
    const packs = buildVisitBlisterPacks({
      visitRound: { code: 'MORNING', name: 'Morning', dueTime: '08:00' },
      allergyLower: [],
      eventByMed: new Map([
        [
          'med-1',
          {
            id: 'evt-1',
            status: 'GIVEN',
            statusCode: 'G',
            supportLevel: 'Assisted',
            timeGiven: '09:15',
            outcomeLabel: 'Given',
            notes: 'test note',
            actualDateTime: new Date('2026-08-12T09:15:00.000Z'),
          },
        ],
      ]),
      packs: [
        {
          id: 'pack-1',
          name: 'Morning blister',
          packType: MedicationPackType.BLISTER,
          status: MedicationPackStatus.ACTIVE,
          roundLabel: 'Morning',
          compartments: [
            {
              id: 'comp-am',
              label: 'Morning',
              dueTime: '08:00',
              windowStart: '07:00',
              windowEnd: '10:00',
              witnessRequired: false,
            },
          ],
          members: [
            {
              id: 'member-1',
              serviceUserMedicationId: 'med-1',
              serviceUserMedication: {
                id: 'med-1',
                medicationName: 'Paracetamol',
                dose: '1 tablet',
                strength: '500mg',
                instructions: null,
                howAssisted: 'Prompting',
                isControlledMedication: false,
                route: { name: 'Oral' },
                medicationPack: null,
                schedules: [{ id: 'sch-1', dueTime: '08:00', round: { name: 'Morning' } }],
              },
            },
          ],
        },
      ],
    });

    expect(packs[0]?.compartments[0]?.medicines[0]).toMatchObject({
      scheduledDoseId: 'med-1:08:00',
      done: true,
      outcomeCode: 'G',
      supportLevel: 'Assisted',
      notes: 'test note',
      timeGiven: '09:15',
    });
  });

  it('hides ended pack medicines unless already recorded today', () => {
    const packs = buildVisitBlisterPacks({
      visitRound: { code: 'MORNING', name: 'Morning', dueTime: '08:00' },
      allergyLower: [],
      eventByMed: new Map(),
      visitAt: new Date('2026-09-11T06:00:00.000Z'),
      packs: [
        {
          id: 'pack-1',
          name: 'Morning blister',
          packType: MedicationPackType.BLISTER,
          status: MedicationPackStatus.ACTIVE,
          roundLabel: 'Morning',
          compartments: [
            {
              id: 'comp-am',
              label: 'Morning',
              dueTime: '08:00',
              windowStart: '07:00',
              windowEnd: '10:00',
              witnessRequired: false,
            },
          ],
          members: [
            {
              id: 'member-1',
              serviceUserMedicationId: 'med-1',
              serviceUserMedication: {
                id: 'med-1',
                medicationName: 'Ramipril',
                dose: '1 tablet',
                strength: '2.5 mg',
                instructions: null,
                isControlledMedication: false,
                route: { name: 'Oral' },
                medicationPack: null,
                endDate: new Date('2026-09-10T23:19:33.795Z'),
                schedules: [{ id: 'sch-1', dueTime: '08:00', round: { name: 'Morning' } }],
              },
            },
          ],
        },
      ],
    });

    expect(packs).toHaveLength(0);
  });

  it('hides a weekly pack medicine on a day it is not due', () => {
    const build = (visitDayKey: string) =>
      buildVisitBlisterPacks({
        visitRound: null,
        visitWindow: { startHm: '07:30', endHm: '09:30' },
        visitDayKey,
        allergyLower: [],
        eventByMed: new Map(),
        packs: [
          {
            id: 'pack-1',
            name: 'Morning blister',
            packType: MedicationPackType.BLISTER,
            status: MedicationPackStatus.ACTIVE,
            roundLabel: 'Morning',
            compartments: [
              {
                id: 'comp-am',
                label: 'Morning',
                dueTime: '08:00',
                windowStart: '07:00',
                windowEnd: '10:00',
                witnessRequired: false,
              },
            ],
            members: [
              {
                id: 'member-1',
                serviceUserMedicationId: 'med-1',
                serviceUserMedication: {
                  id: 'med-1',
                  medicationName: 'Alendronic acid',
                  dose: '1 tablet',
                  strength: '70 mg',
                  instructions: null,
                  isControlledMedication: false,
                  route: { name: 'Oral' },
                  medicationPack: null,
                  startDate: new Date('2026-10-01T00:00:00.000Z'),
                  schedulePattern: 'WEEKLY',
                  frequencyIntervalDays: 1,
                  schedules: [
                    {
                      id: 'sch-1',
                      dueTime: '08:00',
                      daysOfWeek: ['TUESDAY'],
                      round: { name: 'Morning' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

    // 2026-10-12 is a Monday, 2026-10-13 a Tuesday.
    expect(build('2026-10-12')).toHaveLength(0);
    expect(build('2026-10-13')[0]?.compartments[0]?.medicines).toHaveLength(1);
  });
});
