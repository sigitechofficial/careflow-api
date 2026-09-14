import { BadRequestException } from '@nestjs/common';
import { MedicationAdministrationStatus, MedicationKind } from '@prisma/client';
import { validateMedicationAdministrationPayload } from './medication-administration.validation';

describe('validateMedicationAdministrationPayload', () => {
  it('requires actualDateTime for GIVEN', () => {
    expect(() =>
      validateMedicationAdministrationPayload(
        { status: MedicationAdministrationStatus.GIVEN, actualDateTime: undefined },
        MedicationKind.REGULAR,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateMedicationAdministrationPayload(
        { status: MedicationAdministrationStatus.GIVEN, actualDateTime: '2026-05-01T10:00:00.000Z' },
        MedicationKind.REGULAR,
      ),
    ).not.toThrow();
  });

  it('requires reason for MISSED', () => {
    expect(() =>
      validateMedicationAdministrationPayload(
        {
          status: MedicationAdministrationStatus.MISSED,
          actualDateTime: '2026-05-01T10:00:00.000Z',
        },
        MedicationKind.REGULAR,
      ),
    ).toThrow(BadRequestException);
  });

  it('requires prnReason or notes for PRN medication', () => {
    expect(() =>
      validateMedicationAdministrationPayload(
        {
          status: MedicationAdministrationStatus.GIVEN,
          actualDateTime: '2026-05-01T10:00:00.000Z',
        },
        MedicationKind.PRN,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateMedicationAdministrationPayload(
        {
          status: MedicationAdministrationStatus.GIVEN,
          actualDateTime: '2026-05-01T10:00:00.000Z',
          notes: 'Given after meal',
        },
        MedicationKind.PRN,
      ),
    ).not.toThrow();
  });

  it('requires reason and notes for Partially given', () => {
    expect(() =>
      validateMedicationAdministrationPayload(
        {
          status: MedicationAdministrationStatus.GIVEN,
          statusCode: 'PG',
          actualDateTime: '2026-05-01T10:00:00.000Z',
          reason: 'Client spat out / did not swallow',
        },
        MedicationKind.REGULAR,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateMedicationAdministrationPayload(
        {
          status: MedicationAdministrationStatus.GIVEN,
          statusCode: 'PG',
          actualDateTime: '2026-05-01T10:00:00.000Z',
          reason: 'Client spat out / did not swallow',
          notes: 'Half the tablet left',
        },
        MedicationKind.REGULAR,
      ),
    ).not.toThrow();
  });
});
