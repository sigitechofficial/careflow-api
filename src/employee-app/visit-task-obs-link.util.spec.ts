import {
  parseObservationNumeric,
  resolveTaskObsLink,
} from './visit-task-obs-link.util';

describe('visit-task-obs-link', () => {
  it('links Blood glucose reading to blood_glucose / BLOOD_SUGAR', () => {
    expect(
      resolveTaskObsLink({
        name: 'Blood glucose reading',
        flagsJson: { feedsObservation: ['diabetes'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'blood_glucose',
      observationTypeCode: 'BLOOD_SUGAR',
    });
  });

  it('links Check pressure areas to skin_body_map / INFECTION (not blood pressure)', () => {
    expect(resolveTaskObsLink({ name: 'Check pressure areas' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'skin_body_map',
      observationTypeCode: 'INFECTION',
    });
  });

  it('still links Blood pressure to bp / BLOOD_PRESSURE', () => {
    expect(resolveTaskObsLink({ name: 'Blood pressure' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'bp',
      observationTypeCode: 'BLOOD_PRESSURE',
    });
  });

  it('links Pain scale to pain_score / PAIN via name and feedsObservation', () => {
    expect(resolveTaskObsLink({ name: 'Pain scale' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'pain_score',
      observationTypeCode: 'PAIN',
    });
    expect(
      resolveTaskObsLink({
        name: 'Structured pain (e.g. Abbey)',
        flagsJson: { feedsObservation: ['pain'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'pain_score',
      observationTypeCode: 'PAIN',
    });
  });

  it('links Encourage fluids to fluid_intake / FLUID_MONITOR', () => {
    expect(resolveTaskObsLink({ name: 'Encourage fluids' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'fluid_intake',
      observationTypeCode: 'FLUID_MONITOR',
    });
  });

  it('parses numeric readings from notes-style strings', () => {
    expect(parseObservationNumeric('5')).toBe(5);
    expect(parseObservationNumeric('5 mmol/L')).toBe(5);
    expect(parseObservationNumeric('5.2mmol/L')).toBe(5.2);
    expect(parseObservationNumeric(null)).toBeNull();
  });
});
