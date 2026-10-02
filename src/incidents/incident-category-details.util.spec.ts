import { normaliseIncidentCategoryDetails as norm } from './incident-category-details.util';

const STAFF = '1043a8d7-7b7f-40b0-98e9-29bb2fc51caf';

describe('normaliseIncidentCategoryDetails', () => {
  it('returns nothing for categories without extra questions', () => {
    expect(norm('ACCIDENT', 'FALL', { anything: 1 }, { strict: true })).toEqual(
      { details: null, errors: [] },
    );
  });

  it('requires medication answers on the office path but not the app path', () => {
    expect(
      norm('MEDICATION', 'MISSED_DOSE', {}, { strict: true }).errors,
    ).toEqual([
      'Medication name is required',
      'MAR entry affected is required',
    ]);
    expect(norm('MEDICATION', 'MISSED_DOSE', {}, { strict: false })).toEqual({
      details: null,
      errors: [],
    });
  });

  it('keeps valid medication fields, trims text and drops unknown keys', () => {
    const r = norm(
      'MEDICATION',
      'WRONG_DOSE',
      {
        medicationName: ' Paracetamol ',
        scheduledTime: '08:00',
        marEntryAffected: true,
        extra: 'x',
      },
      { strict: true },
    );
    expect(r).toEqual({
      details: {
        medicationName: 'Paracetamol',
        scheduledTime: '08:00',
        marEntryAffected: true,
      },
      errors: [],
    });
    expect(
      norm(
        'MEDICATION',
        null,
        { medicationName: 'X', marEntryAffected: true, scheduledTime: '25:00' },
        { strict: true },
      ).errors,
    ).toEqual(['Scheduled time is not valid']);
  });

  it('validates the alleged person for safeguarding', () => {
    expect(
      norm(
        'SAFEGUARDING',
        'NEGLECT',
        { allegedPerson: { kind: 'STAFF' } },
        { strict: true },
      ).errors,
    ).toEqual(['Select the alleged staff member']);
    expect(
      norm(
        'SAFEGUARDING',
        'NEGLECT',
        { allegedPerson: { kind: 'STAFF', employeeId: STAFF } },
        { strict: true },
      ),
    ).toEqual({
      details: { allegedPerson: { kind: 'STAFF', employeeId: STAFF } },
      errors: [],
    });
    expect(
      norm(
        'SAFEGUARDING',
        'SELF_NEGLECT',
        { allegedPerson: { kind: 'NOT_APPLICABLE' } },
        { strict: true },
      ).errors,
    ).toEqual([]);
    expect(
      norm(
        'SAFEGUARDING',
        null,
        { allegedPerson: { kind: 'OTHER_PERSON' } },
        { strict: true },
      ).errors,
    ).toEqual(['Alleged person name is required']);
  });

  it('requires a pressure ulcer grade only for the pressure ulcer subtype', () => {
    expect(
      norm(
        'SKIN_WOUND',
        'PRESSURE_ULCER',
        { woundStatus: 'NEW' },
        { strict: true },
      ).errors,
    ).toEqual(['Pressure ulcer grade is required']);
    expect(
      norm('SKIN_WOUND', 'SKIN_TEAR', { woundStatus: 'NEW' }, { strict: true })
        .errors,
    ).toEqual([]);
    expect(
      norm(
        'SKIN_WOUND',
        'PRESSURE_ULCER',
        { woundStatus: 'NEW', pressureUlcerGrade: 'SDTI' },
        { strict: true },
      ).details,
    ).toEqual({
      woundStatus: 'NEW',
      pressureUlcerGrade: 'SDTI',
    });
    expect(
      norm(
        'SKIN_WOUND',
        'PRESSURE_ULCER',
        { woundStatus: 'WORSE', pressureUlcerGrade: 'CATEGORY_9' },
        { strict: true },
      ).errors,
    ).toEqual([
      'New / existing / deteriorated is not a valid option',
      'Pressure ulcer grade is not a valid option',
    ]);
  });

  it('rejects future infection dates and checks data breach numbers', () => {
    expect(
      norm(
        'INFECTION',
        'OUTBREAK',
        {
          symptoms: 'vomiting',
          symptomsStartedOn: '2030-01-01',
          infectionControlAction: 'PPE',
        },
        { strict: true, today: '2026-10-02' },
      ).errors,
    ).toEqual(['Symptoms started on cannot be in the future']);
    expect(
      norm(
        'DATA_BREACH',
        null,
        {
          informationType: 'Care notes',
          peopleAffected: 2.5,
          recoveredOrSecured: false,
        },
        { strict: true },
      ).errors,
    ).toEqual(['Number of people affected must be a whole number']);
    expect(
      norm(
        'DATA_BREACH',
        null,
        {
          informationType: 'Care notes',
          peopleAffected: 0,
          recoveredOrSecured: false,
        },
        { strict: true },
      ).details,
    ).toEqual({
      informationType: 'Care notes',
      peopleAffected: 0,
      recoveredOrSecured: false,
    });
  });

  it('rejects a non-object payload', () => {
    expect(
      norm('DEATH', 'EXPECTED_DEATH', 'x', { strict: true }).errors,
    ).toEqual(['categoryDetails must be an object']);
  });
});
