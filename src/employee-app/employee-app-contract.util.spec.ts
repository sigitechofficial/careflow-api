import { parseMedicationAdministrationKey } from './employee-app-contract.util';

describe('parseMedicationAdministrationKey', () => {
  it('keeps HH:mm after the medication uuid', () => {
    expect(parseMedicationAdministrationKey('2e27b0af-169d-43dc-aea5-489ac5aab0eb:08:00')).toEqual({
      medId: '2e27b0af-169d-43dc-aea5-489ac5aab0eb',
      doseKey: '08:00',
    });
  });

  it('supports a bare medication id', () => {
    expect(parseMedicationAdministrationKey('med-1')).toEqual({
      medId: 'med-1',
      doseKey: null,
    });
  });
});
