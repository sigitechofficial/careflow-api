import {
  categoryDetailsLabel,
  diffCorrectableState,
  type CorrectableIncidentState,
} from './incident-correction.util';

const base: CorrectableIncidentState = {
  occurredAt: '2026-10-01T09:00:00.000Z',
  categoryId: 'cat-1',
  subtypeId: null,
  affectedPersonKinds: ['SERVICE_USER', 'EMPLOYEE'],
  primaryServiceUserId: 'su-1',
  primaryEmployeeId: null,
  primaryPersonName: null,
  involvedServiceUserIds: ['su-1'],
  involvedEmployeeIds: [],
  locationId: 'loc-1',
  scheduledJobId: null,
  categoryDetails: { a: 1, b: { c: 2 } },
  ambulanceAttended: null,
  takenToAe: false,
  admittedToHospital: null,
  immediateActionCodes: ['FIRST_AID', 'AREA_MADE_SAFE'],
  whoInformedKeys: ['office'],
  severity: 'LOW',
  privacyLevel: 'NORMAL',
};

describe('diffCorrectableState', () => {
  it('finds nothing when the state is the same', () => {
    expect(diffCorrectableState(base, { ...base })).toEqual([]);
  });

  it('ignores order in unordered lists, key order in details and the same instant', () => {
    expect(
      diffCorrectableState(base, {
        ...base,
        occurredAt: '2026-10-01T09:00:00Z',
        affectedPersonKinds: ['EMPLOYEE', 'SERVICE_USER'],
        immediateActionCodes: ['AREA_MADE_SAFE', 'FIRST_AID'],
        categoryDetails: { b: { c: 2 }, a: 1 },
      }),
    ).toEqual([]);
  });

  it('treats an empty details object as no details', () => {
    expect(
      diffCorrectableState({ ...base, categoryDetails: null }, { ...base, categoryDetails: {} }),
    ).toEqual([]);
  });

  it('reports changed fields in display order with old and new values', () => {
    const diff = diffCorrectableState(base, {
      ...base,
      severity: 'HIGH',
      categoryId: 'cat-2',
      involvedServiceUserIds: ['su-1', 'su-2'],
      takenToAe: null,
    });
    expect(diff.map((d) => d.fieldKey)).toEqual([
      'categoryId',
      'involvedServiceUserIds',
      'takenToAe',
      'severity',
    ]);
    expect(diff[0]).toEqual({ fieldKey: 'categoryId', from: 'cat-1', to: 'cat-2' });
  });

  it('keeps order meaningful for involved people (primary first)', () => {
    const diff = diffCorrectableState(
      { ...base, involvedServiceUserIds: ['su-1', 'su-2'] },
      { ...base, involvedServiceUserIds: ['su-2', 'su-1'] },
    );
    expect(diff.map((d) => d.fieldKey)).toEqual(['involvedServiceUserIds']);
  });
});

describe('categoryDetailsLabel', () => {
  it('summarises details readably', () => {
    expect(
      categoryDetailsLabel({ medicationName: 'Paracetamol', marEntryAffected: true, empty: '' }),
    ).toBe('Medication name: Paracetamol; Mar entry affected: yes');
    expect(categoryDetailsLabel(null)).toBe('—');
  });
});
