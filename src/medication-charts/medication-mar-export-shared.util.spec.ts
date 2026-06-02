import {
  buildPackExportCompartments,
  formatMedicationDetailText,
  medicationDetailFields,
} from './medication-mar-export-shared.util';
import type { MarExportMedicationRow } from './medication-mar-export-shared.util';

const sampleRow: MarExportMedicationRow = {
  medicationId: '1',
  medicationName: 'Paracetamol',
  packName: 'Pack A',
  dose: '1 tablet',
  strength: '500mg',
  routeName: 'Oral',
  type: 'Tablet',
  frequency: 'Five times daily',
  scheduleType: 'daily',
  timeSlot: 'Morning',
  dueTime: '08:00',
  days: [],
};

describe('buildPackExportCompartments', () => {
  it('groups pack rows with null dueTime by timeSlot round name', () => {
    const rows: MarExportMedicationRow[] = [
      {
        ...sampleRow,
        dueTime: null,
        timeSlot: 'Morning',
      },
    ];
    const compartments = buildPackExportCompartments(rows);
    expect(compartments).toHaveLength(1);
    expect(compartments[0]?.dueTime).toBe('08:00');
    expect(compartments[0]?.roundName).toBe('Morning');
    expect(compartments[0]?.label).toContain('Morning Compartment');
  });

  it('does not label null dueTime as unknown Compartment', () => {
    const rows: MarExportMedicationRow[] = [
      {
        ...sampleRow,
        dueTime: null,
        timeSlot: 'Administration',
      },
    ];
    const compartments = buildPackExportCompartments(rows);
    expect(compartments[0]?.label).not.toContain('unknown');
    expect(compartments[0]?.roundName).toBe('Unscheduled');
  });
});

describe('medicationDetailFields', () => {
  it('returns labelled lines including schedule', () => {
    const fields = medicationDetailFields(sampleRow);
    expect(fields.map(f => f.label)).toEqual([
      'Medication',
      'Strength',
      'Dose',
      'Route',
      'Type',
      'Frequency',
      'Pack',
      'Schedule',
    ]);
    expect(formatMedicationDetailText(sampleRow)).toContain('Medication: Paracetamol');
    expect(formatMedicationDetailText(sampleRow)).toContain('Dose: 1 tablet');
    expect(formatMedicationDetailText(sampleRow)).toContain('Schedule: Daily');
  });
});
