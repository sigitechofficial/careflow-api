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
      witnessEmployeeId: null,
      witnessAbsentReasonCode: null,
    });
  });

  it('stores No without name fields', () => {
    expect(resolveMedicationWitnessColumns(true, { witnessPresent: false })).toEqual({
      witnessPresent: false,
      witnessName: null,
      witnessRelationCode: null,
      witnessRelationDetail: null,
      witnessNotes: null,
      witnessEmployeeId: null,
      witnessAbsentReasonCode: null,
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
      employeeId: null,
      absentReasonCode: null,
      absentReasonLabel: null,
    });
    const none = {
      present: false,
      name: null,
      relationCode: null,
      relationLabel: null,
      relationDetail: null,
      notes: null,
      employeeId: null,
      absentReasonCode: null,
      absentReasonLabel: null,
    };
    expect(medicationWitnessTimelineDetail(none)).toBe('No witness');
    expect(
      medicationWitnessTimelineDetail({
        ...none,
        absentReasonCode: 'SINGLE_CARER_VISIT',
        absentReasonLabel: 'Single-carer visit',
      }),
    ).toBe('No witness — Single-carer visit');
    expect(
      medicationWitnessTimelineDetail({
        ...none,
        present: true,
        name: 'Aisha Khan',
        relationCode: 'RELATIVE',
        relationLabel: 'Relative',
        relationDetail: 'Daughter',
      }),
    ).toBe('Witness: Aisha Khan (Relative — Daughter)');
  });

  describe('carer-app rules for a given controlled drug', () => {
    const coCarers = [{ employeeId: 'emp-2', name: 'Liam Walsh' }];
    const given = { given: true, coCarers };

    it('requires an answer and a reason when no witness is present', () => {
      expect(() => resolveMedicationWitnessColumns(true, {}, given)).toThrow(/witnessPresent/);
      expect(() =>
        resolveMedicationWitnessColumns(true, { witnessPresent: false }, given),
      ).toThrow(/witnessAbsentReasonCode/);
      expect(() =>
        resolveMedicationWitnessColumns(
          true,
          { witnessPresent: false, witnessAbsentReasonCode: 'OTHER' },
          given,
        ),
      ).toThrow(/witnessNotes/);
    });

    it('stores the reason for no witness', () => {
      expect(
        resolveMedicationWitnessColumns(
          true,
          { witnessPresent: false, witnessAbsentReasonCode: 'single_carer_visit' },
          given,
        ),
      ).toMatchObject({
        witnessPresent: false,
        witnessAbsentReasonCode: 'SINGLE_CARER_VISIT',
        witnessName: null,
        witnessEmployeeId: null,
      });
      expect(
        resolveMedicationWitnessColumns(
          true,
          { witnessPresent: false, witnessAbsentReasonCode: 'OTHER', witnessNotes: ' Family out ' },
          given,
        ),
      ).toMatchObject({ witnessAbsentReasonCode: 'OTHER', witnessNotes: 'Family out' });
    });

    it('takes a co-carer witness from the carers on the visit, not a typed name', () => {
      expect(
        resolveMedicationWitnessColumns(
          true,
          {
            witnessPresent: true,
            witnessRelationCode: 'CO_CARER',
            witnessEmployeeId: 'emp-2',
            witnessName: 'Made Up Name',
          },
          given,
        ),
      ).toMatchObject({
        witnessPresent: true,
        witnessName: 'Liam Walsh',
        witnessEmployeeId: 'emp-2',
        witnessRelationCode: 'CO_CARER',
      });
    });

    it('rejects a co-carer who is not on the visit', () => {
      const typedOnly = {
        witnessPresent: true,
        witnessRelationCode: 'CO_CARER',
        witnessName: 'Made Up Name',
      };
      expect(() => resolveMedicationWitnessColumns(true, typedOnly, given)).toThrow(
        /carers on this visit/,
      );
      expect(() =>
        resolveMedicationWitnessColumns(true, typedOnly, { given: true, coCarers: [] }),
      ).toThrow(/No other carer is on this visit/);
    });

    it('still takes a typed name for a relative or other person', () => {
      expect(
        resolveMedicationWitnessColumns(
          true,
          {
            witnessPresent: true,
            witnessName: 'Aisha Khan',
            witnessRelationCode: 'RELATIVE',
            witnessRelationDetail: 'Daughter',
          },
          given,
        ),
      ).toMatchObject({ witnessName: 'Aisha Khan', witnessEmployeeId: null });
    });

    it('does not ask for a witness when the dose was not given', () => {
      expect(
        resolveMedicationWitnessColumns(true, {}, { given: false, coCarers }),
      ).toMatchObject({ witnessPresent: null, witnessAbsentReasonCode: null });
    });
  });
});
