import { ConflictException, BadRequestException } from '@nestjs/common';
import { MedicationAdministrationStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ScheduledVisitStatus } from '../scheduled-visits/enums/scheduled-visit-status.enum';

export function contractError(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

export function validationError(message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

export function mapVisitOutcomeToStatus(
  visitOutcome: string | undefined,
  status: ScheduledVisitStatus | undefined,
): ScheduledVisitStatus {
  if (visitOutcome) {
    switch (visitOutcome) {
      case 'fully_delivered':
        return ScheduledVisitStatus.COMPLETED;
      case 'partially_met':
        return ScheduledVisitStatus.PARTIALLY_COMPLETED;
      case 'not_met':
        return ScheduledVisitStatus.MISSED;
      default:
        validationError(`Unknown visitOutcome: ${visitOutcome}`);
    }
  }
  return status ?? ScheduledVisitStatus.COMPLETED;
}

export function statusToContractLabel(status: string): string {
  switch (status) {
    case ScheduledVisitStatus.COMPLETED:
      return 'completed';
    case ScheduledVisitStatus.PARTIALLY_COMPLETED:
      return 'partially_completed';
    case ScheduledVisitStatus.MISSED:
      return 'missed';
    case ScheduledVisitStatus.NEEDS_ATTENTION:
      return 'needs_attention';
    default:
      return String(status).toLowerCase();
  }
}

/** UI MAR outcome codes → Prisma status + statusCode. */
export function mapMarOutcomeCode(outcomeCode: string): {
  status: MedicationAdministrationStatus;
  statusCode: string;
} {
  const code = outcomeCode.trim();
  const upper = code.toUpperCase();
  if (upper === 'PENDING' || code === 'Pending') {
    validationError('Pending is not a recordable administration outcome');
  }
  if (['G', 'PG', 'F', 'I', 'S', 'T'].includes(upper)) {
    return { status: MedicationAdministrationStatus.GIVEN, statusCode: upper };
  }
  if (upper === 'R') {
    return { status: MedicationAdministrationStatus.REFUSED, statusCode: upper };
  }
  if (upper === 'C' || upper === 'H') {
    return { status: MedicationAdministrationStatus.CANCELLED, statusCode: upper };
  }
  if (upper === 'PCI') {
    return { status: MedicationAdministrationStatus.HELD, statusCode: upper };
  }
  return { status: MedicationAdministrationStatus.NOT_GIVEN, statusCode: upper || code };
}

export function newAuditRecordId(): string {
  return randomUUID();
}

/** `uuid:08:00` — split only on the first colon so due-time `08:00` stays intact. */
export function parseMedicationAdministrationKey(medicationKey: string): {
  medId: string;
  doseKey: string | null;
} {
  const trimmed = medicationKey.trim();
  const colon = trimmed.indexOf(':');
  if (colon <= 0) return { medId: trimmed, doseKey: null };
  const medId = trimmed.slice(0, colon);
  const doseKey = trimmed.slice(colon + 1).trim() || null;
  return { medId, doseKey };
}

const MAR_SUPPORT_REQUIRED_CODES = new Set(['G', 'PG', 'F', 'I', 'S', 'T']);

export function isMarOtherReason(reason?: string | null): boolean {
  const t = reason?.trim().toLowerCase() ?? '';
  return t === 'other' || t === 'other reason' || t === 'other_reason';
}

export function marCarerSupportRequired(outcomeCode: string): boolean {
  return MAR_SUPPORT_REQUIRED_CODES.has(outcomeCode.trim().toUpperCase());
}

export function marCarerNotesRequired(params: {
  outcomeCode: string;
  reasonCode?: string | null;
  catalogReasonRequiresNotes?: boolean | null;
}): boolean {
  const upper = params.outcomeCode.trim().toUpperCase();
  if (upper === 'PG') return true;
  if (isMarOtherReason(params.reasonCode)) return true;
  return params.catalogReasonRequiresNotes === true;
}

export function assertMarCarerAdministrationFields(params: {
  outcomeCode: string;
  supportLevel?: string | null;
  notes?: string | null;
  reasonCode?: string | null;
  catalogReasonRequiresNotes?: boolean | null;
}): void {
  if (marCarerSupportRequired(params.outcomeCode) && !params.supportLevel?.trim()) {
    validationError('supportLevel is required for this outcome');
  }
  if (params.outcomeCode.trim().toUpperCase() === 'PG' && !params.reasonCode?.trim()) {
    validationError('reason is required for this outcome');
  }
  if (
    marCarerNotesRequired({
      outcomeCode: params.outcomeCode,
      reasonCode: params.reasonCode,
      catalogReasonRequiresNotes: params.catalogReasonRequiresNotes,
    }) &&
    !params.notes?.trim()
  ) {
    validationError('notes are required for this outcome');
  }
}
