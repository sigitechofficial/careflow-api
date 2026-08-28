import {
  calculateNews2Score,
  extractWellbeingScoresFromPayload,
  formatClinicalObservationValue,
  shouldValidateEmployeeObservationPayload,
} from './observation-clinical.catalog';

describe('observation-clinical.catalog', () => {
  it('extracts wellbeing scores from payload', () => {
    expect(
      extractWellbeingScoresFromPayload({
        wellbeingScores: [
          { dimensionCode: 'mobility', level: 4 },
          { dimensionCode: 'EMOTIONAL', level: 2 },
          { dimensionCode: 'HEALTH', level: 9 },
        ],
      }),
    ).toEqual([
      { dimensionCode: 'MOBILITY', level: 4 },
      { dimensionCode: 'EMOTIONAL', level: 2 },
    ]);
  });

  it('calculates NEWS2 score for a score-0 set', () => {
    expect(
      calculateNews2Score({
        respirationRate: 16,
        oxygenSaturation: 98,
        airOrOxygen: 'AIR',
        systolic: 120,
        diastolic: 80,
        pulse: 70,
        consciousness: 'A',
        temperature: 36.8,
      }),
    ).toBe(0);
  });

  it('formats clinical history labels', () => {
    expect(formatClinicalObservationValue('NEWS2', {}, 7)).toBe('Score 7');
    expect(
      formatClinicalObservationValue('INFECTION', { infectionType: 'UTI' }),
    ).toBe('UTI');
    expect(
      formatClinicalObservationValue('URINALYSIS', { observationOfUrine: 'CLOUDY' }),
    ).toBe('Cloudy');
    expect(
      formatClinicalObservationValue('ABC_PATTERNS', {
        antecedent: 'Noise',
        behaviour: 'Shouting',
        consequences: 'Calmed',
      }),
    ).toBe('A: Noise · B: Shouting · C: Calmed');
  });

  it('marks aligned and clinical types for employee payload validation', () => {
    expect(shouldValidateEmployeeObservationPayload('NEWS2')).toBe(true);
    expect(shouldValidateEmployeeObservationPayload('CONTINENCE')).toBe(true);
    expect(shouldValidateEmployeeObservationPayload('BLOOD_PRESSURE')).toBe(false);
  });
});
