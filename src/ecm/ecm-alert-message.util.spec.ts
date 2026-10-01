import { buildEcmAlertMessage } from './ecm-alert-message.util';

const base = {
  title: 'Late arrival',
  jobName: 'Morning — Harry',
  serviceUserFullName: 'Harry Max',
  carerName: 'Ali Khan',
};

describe('buildEcmAlertMessage', () => {
  it('states carer and minutes late', () => {
    expect(
      buildEcmAlertMessage({ ...base, kind: 'LATE_ARRIVAL', startVarianceMinutes: 25 }),
    ).toBe('Ali Khan arrived 25 min late for Morning — Harry (Harry Max).');
  });

  it('states minutes early from a negative variance', () => {
    expect(
      buildEcmAlertMessage({ ...base, kind: 'EARLY_ARRIVAL', startVarianceMinutes: -10 }),
    ).toBe('Ali Khan arrived 10 min early for Morning — Harry (Harry Max).');
  });

  it('states actual vs planned minutes for a short visit', () => {
    expect(
      buildEcmAlertMessage({
        ...base,
        kind: 'SHORT_VISIT',
        title: 'Short visit',
        actualDurationMinutes: 20,
        plannedDurationMinutes: 45,
      }),
    ).toBe('Ali Khan stayed 20 min of a planned 45 min at Morning — Harry (Harry Max).');
  });

  it('names the carer who left the visit area', () => {
    expect(buildEcmAlertMessage({ ...base, kind: 'LEFT_VISIT_AREA' })).toBe(
      'Ali Khan left the visit area during Morning — Harry (Harry Max). Visit operations are locked until the office allows them to continue.',
    );
  });

  it('writes the outside-area request as a sentence with the carer note', () => {
    expect(
      buildEcmAlertMessage({
        ...base,
        kind: 'OUTSIDE_AREA_CHECK_IN_REQUEST',
        carerNote: 'Gate code changed',
      }),
    ).toBe(
      'Ali Khan is outside the visit area for Morning — Harry (Harry Max) and asked the office to allow Manual check-in. Note: "Gate code changed"',
    );
  });

  it('falls back to "Carer" and no minutes when data is missing', () => {
    expect(
      buildEcmAlertMessage({ ...base, carerName: null, kind: 'LATE_ARRIVAL' }),
    ).toBe('Carer arrived late for Morning — Harry (Harry Max).');
  });

  it('uses the title plus carer for other kinds', () => {
    expect(
      buildEcmAlertMessage({ ...base, kind: 'POTENTIAL_MISSED', title: 'Potential missed visit' }),
    ).toBe('Potential missed visit: Morning — Harry (Harry Max). Carer: Ali Khan.');
  });
});
