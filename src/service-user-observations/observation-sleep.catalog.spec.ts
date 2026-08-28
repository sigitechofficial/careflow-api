import {
  formatSleepObservationValue,
  normalizeSleepReasons,
} from './observation-sleep.catalog';

describe('observation-sleep.catalog', () => {
  it('formats settled sleep without reasons', () => {
    expect(formatSleepObservationValue({ quality: 'SETTLED', reasons: ['PAIN'] })).toBe(
      'Settled',
    );
  });

  it('formats restless sleep with reasons', () => {
    expect(
      formatSleepObservationValue({ quality: 'RESTLESS', reasons: ['PAIN', 'NOISE'] }),
    ).toBe('Restless · Pain, Noise');
  });

  it('accepts legacy reason string', () => {
    expect(normalizeSleepReasons({ reason: 'PAIN,TOILET' })).toEqual(['PAIN', 'TOILET']);
  });
});
