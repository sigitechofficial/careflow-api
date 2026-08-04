import {
  EMPLOYEE_APP_UNABLE_REASONS,
  buildCatalogSections,
  buildObsBounds,
  buildObsFormForType,
  mobileTypeCode,
  resolveObservationTypeCode,
} from './employee-app-observations.catalog';

describe('employee-app observations catalog', () => {
  it('exposes the shared unable-to-record reasons including other requiring notes', () => {
    expect(EMPLOYEE_APP_UNABLE_REASONS.length).toBeGreaterThanOrEqual(8);
    expect(EMPLOYEE_APP_UNABLE_REASONS.map((r) => r.code)).toEqual(
      expect.arrayContaining([
        'client_declined',
        'equipment_unavailable',
        'unable_to_obtain',
        'client_asleep',
        'client_unavailable',
        'unsafe',
        'not_clinically_required',
        'other',
      ]),
    );
    const other = EMPLOYEE_APP_UNABLE_REASONS.find((r) => r.code === 'other');
    expect(other?.requiresNotes).toBe(true);
    expect(other?.resolvesRequirement).toBe(true);
  });

  it('maps DB codes to stable mobile typeCodes', () => {
    expect(mobileTypeCode('BLOOD_PRESSURE')).toBe('bp');
    expect(mobileTypeCode('BLOOD_SUGAR')).toBe('blood_glucose');
    expect(mobileTypeCode('WELLBEING')).toBe('mood_wellbeing');
  });

  it('resolves mobile aliases back to ObservationType codes for writes', () => {
    expect(resolveObservationTypeCode('blood_glucose')).toBe('BLOOD_SUGAR');
    expect(resolveObservationTypeCode('bp')).toBe('BLOOD_PRESSURE');
    expect(resolveObservationTypeCode('BLOOD_SUGAR')).toBe('BLOOD_SUGAR');
    expect(resolveObservationTypeCode('mood_wellbeing')).toBe('WELLBEING');
  });

  it('builds numeric bounds with normal range label and warning/critical bands', () => {
    const bounds = buildObsBounds({
      unit: 'mmol/L',
      minAccepted: 4,
      maxAccepted: 7,
    });
    expect(bounds.normalRangeLabel).toBe('4–7 mmol/L');
    expect(bounds.warningMin).not.toBeNull();
    expect(bounds.criticalMax).not.toBeNull();
    expect(bounds.criticalMin!).toBeLessThan(bounds.warningMin!);
  });

  it('builds BP form with systolic/diastolic and situation select', () => {
    const bounds = buildObsBounds({
      unit: 'mmHg',
      minAccepted: 90,
      maxAccepted: 140,
      secondary: {
        key: 'diastolic',
        label: 'Diastolic',
        unit: 'mmHg',
        minAccepted: 60,
        maxAccepted: 90,
        warningMin: 55,
        warningMax: 95,
        criticalMin: 50,
        criticalMax: 100,
        normalRangeLabel: '60–90 mmHg',
      },
    });
    const form = buildObsFormForType({
      code: 'BLOOD_PRESSURE',
      name: 'Blood pressure',
      unitLabel: 'mmHg',
      valueKind: 'COMPOSITE',
      bounds,
    });
    expect(form.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['systolic', 'diastolic', 'situation', 'notes']),
    );
    expect(form.showUnableToRecord).toBe(true);
  });

  it('builds catalog sections keyed by mobile typeCode', () => {
    const sections = buildCatalogSections([
      { code: 'BLOOD_PRESSURE', name: 'Blood pressure', unitLabel: 'mmHg' },
      { code: 'WELLBEING', name: 'Wellbeing', unitLabel: null },
      { code: 'FALLS', name: 'Falls', unitLabel: null },
    ]);
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'wellbeing_care', 'clinical_charts']);
    const vitals = sections.find((s) => s.id === 'vitals')!;
    expect(vitals.items[0].typeCode).toBe('bp');
    expect(vitals.items[0].observationTypeCode).toBe('BLOOD_PRESSURE');
  });
});
