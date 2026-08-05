import { parseObservationNumeric, resolveTaskObsLink } from './visit-task-obs-link.util';

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

  it('parses numeric readings from notes-style strings', () => {
    expect(parseObservationNumeric('5')).toBe(5);
    expect(parseObservationNumeric('5 mmol/L')).toBe(5);
    expect(parseObservationNumeric('5.2mmol/L')).toBe(5.2);
    expect(parseObservationNumeric(null)).toBeNull();
  });
});
