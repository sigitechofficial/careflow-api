import { BadRequestException } from '@nestjs/common';
import { MedicationAdministrationStatus, MedicationKind } from '@prisma/client';

export type AdministrationInput = {
  status: MedicationAdministrationStatus;
  statusCode?: string | null;
  actualDateTime?: string | Date | null;
  notGivenReasonId?: string | null;
  reason?: string | null;
  isPrn?: boolean;
  prnReason?: string | null;
  prnOutcome?: string | null;
  notes?: string | null;
};

const NEEDS_ACTUAL_TIME: MedicationAdministrationStatus[] = [
  MedicationAdministrationStatus.GIVEN,
  MedicationAdministrationStatus.NOT_GIVEN,
  MedicationAdministrationStatus.REFUSED,
  MedicationAdministrationStatus.HELD,
];

const NEEDS_REASON: MedicationAdministrationStatus[] = [
  MedicationAdministrationStatus.NOT_GIVEN,
  MedicationAdministrationStatus.REFUSED,
  MedicationAdministrationStatus.MISSED,
];

export function validateMedicationAdministrationPayload(
  dto: AdministrationInput,
  medicationKind?: MedicationKind,
): void {
  if (NEEDS_ACTUAL_TIME.includes(dto.status) && !dto.actualDateTime) {
    throw new BadRequestException('actualDateTime is required for this administration status');
  }
  if (NEEDS_REASON.includes(dto.status)) {
    const hasReason = Boolean(dto.notGivenReasonId) || Boolean(dto.reason?.trim());
    if (!hasReason) {
      throw new BadRequestException('notGivenReasonId or reason is required for this status');
    }
  }
  const prnLike = dto.isPrn || medicationKind === MedicationKind.PRN;
  if (prnLike) {
    const hasPrnNotes = Boolean(dto.prnReason?.trim()) || Boolean(dto.notes?.trim());
    if (!hasPrnNotes) {
      throw new BadRequestException('PRN administrations require prnReason or notes');
    }
  }

  const code = dto.statusCode?.trim().toUpperCase();
  if (code === 'PG') {
    const hasReason = Boolean(dto.notGivenReasonId) || Boolean(dto.reason?.trim());
    if (!hasReason) {
      throw new BadRequestException('reason is required for Partially given');
    }
    if (!dto.notes?.trim()) {
      throw new BadRequestException('notes are required for Partially given');
    }
  }
}
