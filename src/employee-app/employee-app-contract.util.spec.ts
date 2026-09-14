import { MedicationAdministrationStatus } from '@prisma/client';
import {
  mapMarOutcomeCode,
  parseMedicationAdministrationKey,
  assertMarCarerAdministrationFields,
  marCarerNotesRequired,
} from './employee-app-contract.util';

describe('mapMarOutcomeCode', () => {
  it('maps given-family codes including partially given', () => {
    expect(mapMarOutcomeCode('G')).toEqual({
      status: MedicationAdministrationStatus.GIVEN,
      statusCode: 'G',
    });
    expect(mapMarOutcomeCode('PG')).toEqual({
      status: MedicationAdministrationStatus.GIVEN,
      statusCode: 'PG',
    });
  });

  it('maps refused', () => {
    expect(mapMarOutcomeCode('R').status).toBe(MedicationAdministrationStatus.REFUSED);
  });
});

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

describe('assertMarCarerAdministrationFields', () => {
  it('requires support, reason, and notes for PG', () => {
    expect(() =>
      assertMarCarerAdministrationFields({
        outcomeCode: 'PG',
        reasonCode: 'Client spat out / did not swallow',
        notes: 'Half left',
      }),
    ).toThrow();
    expect(() =>
      assertMarCarerAdministrationFields({
        outcomeCode: 'PG',
        supportLevel: 'Assisted',
        notes: 'Half left',
      }),
    ).toThrow();
    expect(() =>
      assertMarCarerAdministrationFields({
        outcomeCode: 'PG',
        supportLevel: 'Assisted',
        reasonCode: 'Client spat out / did not swallow',
      }),
    ).toThrow();
    expect(() =>
      assertMarCarerAdministrationFields({
        outcomeCode: 'PG',
        supportLevel: 'Assisted',
        reasonCode: 'Client spat out / did not swallow',
        notes: 'Half left',
      }),
    ).not.toThrow();
  });

  it('keeps Given notes optional', () => {
    expect(() =>
      assertMarCarerAdministrationFields({
        outcomeCode: 'G',
        supportLevel: 'Assisted',
      }),
    ).not.toThrow();
  });

  it('requires notes for Other, not for a declined catalog reason', () => {
    expect(marCarerNotesRequired({ outcomeCode: 'R', reasonCode: 'Other' })).toBe(true);
    expect(
      marCarerNotesRequired({
        outcomeCode: 'R',
        reasonCode: 'Client declined medication',
        catalogReasonRequiresNotes: false,
      }),
    ).toBe(false);
    expect(
      marCarerNotesRequired({
        outcomeCode: 'R',
        reasonCode: 'Client declined medication',
        catalogReasonRequiresNotes: true,
      }),
    ).toBe(true);
  });
});
