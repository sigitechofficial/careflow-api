import { MedicationAdministrationStatus } from '@prisma/client';
import { statusCodeToAdministrationStatus } from '../medication-charts/medication-chart-display.util';
import { DEFAULT_MEDICATION_STATUS_CODES } from './medication-status-codes.defaults';

describe('DEFAULT_MEDICATION_STATUS_CODES', () => {
  it('seeds all 15 spec status codes with required display fields', () => {
    expect(DEFAULT_MEDICATION_STATUS_CODES).toHaveLength(15);

    const codes = DEFAULT_MEDICATION_STATUS_CODES.map((row) => row.code);
    expect(codes).toEqual([
      'G',
      'R',
      'N',
      'U',
      'H',
      'A',
      'C',
      'F',
      'I',
      'S',
      'T',
      'O',
      'P',
      'PCI',
      'Pending',
    ]);

    for (const row of DEFAULT_MEDICATION_STATUS_CODES) {
      expect(row.label.trim().length).toBeGreaterThan(0);
      expect(row.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(row.textColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(row.sortOrder).toBeGreaterThan(0);
      expect(row.administrationStatus).toBe(statusCodeToAdministrationStatus(row.code));
    }
  });

  it('uses spec-critical colors for Given and Refused', () => {
    const given = DEFAULT_MEDICATION_STATUS_CODES.find((row) => row.code === 'G');
    const refused = DEFAULT_MEDICATION_STATUS_CODES.find((row) => row.code === 'R');
    const pci = DEFAULT_MEDICATION_STATUS_CODES.find((row) => row.code === 'PCI');

    expect(given?.color).toBe('#2E7D32');
    expect(refused?.color).toBe('#E53935');
    expect(pci?.color).toBe('#B71C1C');
  });
});
