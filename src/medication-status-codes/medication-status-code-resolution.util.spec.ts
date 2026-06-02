import { MedicationAdministrationStatus } from '@prisma/client';
import { statusCodeToAdministrationStatus } from '../medication-charts/medication-chart-display.util';
import {
  resolveAdministrationFromEnumOnly,
  resolveAdministrationFromStatusCode,
} from './medication-status-code-resolution.util';

describe('resolveAdministrationFromStatusCode', () => {
  it('uses configured administrationStatus from the status code row', () => {
    expect(
      resolveAdministrationFromStatusCode('F', {
        id: 'id-1',
        code: 'F',
        administrationStatus: MedicationAdministrationStatus.GIVEN,
      }),
    ).toEqual({
      status: MedicationAdministrationStatus.GIVEN,
      statusCode: 'F',
      statusCodeId: 'id-1',
    });
  });

  it('falls back to legacy mapping when row is missing', () => {
    expect(resolveAdministrationFromStatusCode('PCI', null)).toEqual({
      status: MedicationAdministrationStatus.NOT_GIVEN,
      statusCode: 'PCI',
      statusCodeId: null,
    });
  });
});

describe('resolveAdministrationFromEnumOnly', () => {
  it('returns enum and derived display code without FK', () => {
    expect(
      resolveAdministrationFromEnumOnly(MedicationAdministrationStatus.REFUSED, 'R'),
    ).toEqual({
      status: MedicationAdministrationStatus.REFUSED,
      statusCode: 'R',
      statusCodeId: null,
    });
  });
});

describe('statusCodeToAdministrationStatus with row', () => {
  it('prefers row.administrationStatus over legacy switch', () => {
    expect(
      statusCodeToAdministrationStatus('N', {
        administrationStatus: MedicationAdministrationStatus.NOT_GIVEN,
      }),
    ).toBe(MedicationAdministrationStatus.NOT_GIVEN);
  });
});
