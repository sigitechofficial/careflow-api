import { formatVisitObservationValue } from './visit-observations-catalog.service';

describe('formatVisitObservationValue', () => {
  it('labels SpO2 oxygen delivery (Mask) separately from the reading', () => {
    expect(
      formatVisitObservationValue({
        numericValue: null,
        unit: null,
        payload: { reading: '78', context: 'Mask' },
        observationType: { code: 'OXYGEN_SATURATION' },
      }),
    ).toBe('78% · Taken while: Face mask (extra oxygen)');
  });

  it('labels SpO2 taken on room air', () => {
    expect(
      formatVisitObservationValue({
        numericValue: null,
        unit: null,
        payload: { reading: '96', context: 'On air' },
        observationType: { code: 'OXYGEN_SATURATION' },
      }),
    ).toBe('96% · Taken while: Room air (no extra oxygen)');
  });

  it('labels glucose timing like the carer app', () => {
    expect(
      formatVisitObservationValue({
        numericValue: null,
        unit: null,
        payload: { reading: '7.2', timing: 'Before food' },
        observationType: { code: 'BLOOD_SUGAR' },
      }),
    ).toBe('7.2 mmol/L · Timing: Before food');
  });
});
