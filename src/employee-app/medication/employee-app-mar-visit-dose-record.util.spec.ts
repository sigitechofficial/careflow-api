import {
  dueTimesInVisitWindow,
  pickVisitDoseRecords,
  recordIsForVisitDose,
  visitDoseRecordWhere,
} from './employee-app-mar-visit-dose-record.util';

const base = { serviceUserId: 'su-1', visitId: 'visit-1', medicationId: 'med-1' };

describe('visitDoseRecordWhere', () => {
  it('matches a scheduled dose by visit, medicine and administration time', () => {
    expect(
      visitDoseRecordWhere({ ...base, isPrn: false, schedule: { id: 'sch-1', dueTime: '08:00' } }),
    ).toEqual({
      serviceUserId: 'su-1',
      serviceUserMedicationId: 'med-1',
      visitId: 'visit-1',
      isPrn: false,
      deletedAt: null,
      OR: [
        { medicationScheduleId: 'sch-1' },
        { medicationScheduleId: null },
        { schedule: { dueTime: '08:00' } },
      ],
    });
  });

  it('matches a PRN dose by visit and medicine only', () => {
    expect(
      visitDoseRecordWhere({ ...base, isPrn: true, schedule: { id: 'sch-1', dueTime: '08:00' } }),
    ).toEqual({
      serviceUserId: 'su-1',
      serviceUserMedicationId: 'med-1',
      visitId: 'visit-1',
      isPrn: true,
      deletedAt: null,
    });
  });

  it('does not filter by time when the medicine has no schedule', () => {
    expect(visitDoseRecordWhere({ ...base, isPrn: false, schedule: null })).not.toHaveProperty('OR');
  });
});

const evening = {
  visitId: 'visit-evening',
  window: { startHm: '18:00', endHm: '18:30' },
  timeZone: 'Europe/London',
};

describe('recordIsForVisitDose', () => {
  it('does not let the morning dose tick the evening dose', () => {
    expect(
      recordIsForVisitDose(
        { serviceUserMedicationId: 'med-1', visitId: 'visit-morning', schedule: { dueTime: '08:00' } },
        ['18:10'],
        evening,
      ),
    ).toBe(false);
  });

  it('accepts a record saved on this visit', () => {
    expect(
      recordIsForVisitDose(
        { serviceUserMedicationId: 'med-1', visitId: 'visit-evening', schedule: { dueTime: '08:00' } },
        ['18:10'],
        evening,
      ),
    ).toBe(true);
  });

  it('accepts the same dose recorded by the office or on an overlapping visit', () => {
    expect(
      recordIsForVisitDose(
        { serviceUserMedicationId: 'med-1', visitId: null, schedule: { dueTime: '18:10' } },
        ['18:10'],
        evening,
      ),
    ).toBe(true);
    expect(
      recordIsForVisitDose(
        { serviceUserMedicationId: 'med-1', visitId: 'visit-other', schedule: { dueTime: '18:10' } },
        ['18:10'],
        evening,
      ),
    ).toBe(true);
  });

  it('places a record with no administration time and no visit by its clock time', () => {
    // 2026-10-12 is in BST (UTC+1): 17:15Z is 18:15 in London.
    const inWindow = {
      serviceUserMedicationId: 'med-1',
      visitId: null,
      scheduledDateTime: new Date('2026-10-12T17:15:00.000Z'),
    };
    const morning = { ...inWindow, scheduledDateTime: new Date('2026-10-12T07:00:00.000Z') };
    expect(recordIsForVisitDose(inWindow, ['18:10'], evening)).toBe(true);
    expect(recordIsForVisitDose(morning, ['18:10'], evening)).toBe(false);
  });

  it('keeps the day-wide match when the visit has no window', () => {
    expect(
      recordIsForVisitDose(
        { serviceUserMedicationId: 'med-1', visitId: 'visit-morning', schedule: { dueTime: '08:00' } },
        [],
        { ...evening, window: null },
      ),
    ).toBe(true);
  });
});

describe('pickVisitDoseRecords', () => {
  it('returns the newest matching record per medicine and ignores other doses', () => {
    const records = [
      { id: 'r3', serviceUserMedicationId: 'a', visitId: 'visit-evening', schedule: { dueTime: '18:10' } },
      { id: 'r2', serviceUserMedicationId: 'a', visitId: 'visit-evening', schedule: { dueTime: '18:10' } },
      { id: 'r1', serviceUserMedicationId: 'a', visitId: 'visit-morning', schedule: { dueTime: '08:00' } },
      { id: 'r0', serviceUserMedicationId: 'b', visitId: 'visit-morning', schedule: { dueTime: '08:00' } },
    ];
    const picked = pickVisitDoseRecords(
      records,
      new Map([
        ['a', ['18:10']],
        ['b', ['18:10']],
      ]),
      evening,
    );
    expect(picked.size).toBe(1);
    expect(picked.get('a')?.id).toBe('r3');
  });
});

describe('pickVisitDoseRecords — own record first', () => {
  it('prefers the record saved on this visit over a newer one from another visit', () => {
    const records = [
      { id: 'other-visit', serviceUserMedicationId: 'a', visitId: 'visit-other', schedule: { dueTime: '18:10' } },
      { id: 'own', serviceUserMedicationId: 'a', visitId: 'visit-evening', schedule: { dueTime: '18:10' } },
    ];
    const picked = pickVisitDoseRecords(records, new Map([['a', ['18:10']]]), evening);
    expect(picked.get('a')?.id).toBe('own');
  });
});

describe('dueTimesInVisitWindow', () => {
  it('keeps only the times inside the visit window', () => {
    expect(
      dueTimesInVisitWindow([{ dueTime: '08:00' }, { dueTime: '18:10' }], evening.window),
    ).toEqual(['18:10']);
  });
});
