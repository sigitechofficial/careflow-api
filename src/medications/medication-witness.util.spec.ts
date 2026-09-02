import {
  buildMedicationWitnessEcho,
  medicationWitnessTimelineDetail,
  resolveMedicationWitnessColumns,
} from './medication-witness.util';

describe('medication-witness.util', () => {
  it('clears witness on non-controlled medication', () => {
    expect(
      resolveMedicationWitnessColumns(false, {
        witnessPresent: true,
        witnessName: 'Aisha Khan',
        witnessRelationCode: 'RELATIVE',
        witnessRelationDetail: 'Daughter',
      }),
    ).toEqual({
      witnessPresent: null,
      witnessName: null,
      witnessRelationCode: null,
      witnessRelationDetail: null,
      witnessNotes: null,
    });
  });

  it('stores No without name fields', () => {
    expect(resolveMedicationWitnessColumns(true, { witnessPresent: false })).toEqual({
      witnessPresent: false,
      witnessName: null,
      witnessRelationCode: null,
      witnessRelationDetail: null,
      witnessNotes: null,
    });
  });

  it('requires name, relation, and relative detail when Yes', () => {
    expect(() =>
      resolveMedicationWitnessColumns(true, { witnessPresent: true }),
    ).toThrow(/witnessName/);
    expect(() =>
      resolveMedicationWitnessColumns(true, {
        witnessPresent: true,
        witnessName: 'Aisha Khan',
      }),
    ).toThrow(/witnessRelationCode/);
    expect(() =>
      resolveMedicationWitnessColumns(true, {
        witnessPresent: true,
        witnessName: 'Aisha Khan',
        witnessRelationCode: 'RELATIVE',
      }),
    ).toThrow(/witnessRelationDetail/);
  });

  it('echoes saved Yes and No; null when never asked', () => {
    expect(buildMedicationWitnessEcho({ witnessPresent: null })).toBeNull();
    expect(
      buildMedicationWitnessEcho({
        witnessPresent: true,
        witnessName: 'Aisha Khan',
        witnessRelationCode: 'RELATIVE',
        witnessRelationDetail: 'Daughter',
        witnessNotes: 'Present in room',
      }),
    ).toEqual({
      present: true,
      name: 'Aisha Khan',
      relationCode: 'RELATIVE',
      relationLabel: 'Relative',
      relationDetail: 'Daughter',
      notes: 'Present in room',
    });
    expect(medicationWitnessTimelineDetail({ present: false, name: null, relationCode: null, relationLabel: null, relationDetail: null, notes: null })).toBe(
      'No witness',
    );
    expect(
      medicationWitnessTimelineDetail({
        present: true,
        name: 'Aisha Khan',
        relationCode: 'RELATIVE',
        relationLabel: 'Relative',
        relationDetail: 'Daughter',
        notes: null,
      }),
    ).toBe('Witness: Aisha Khan (Relative — Daughter)');
  });
});
