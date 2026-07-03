import type { MedicationAdministrationStatus, MedicationRecordStatus } from '@prisma/client';

const STATUS_LABELS: Partial<Record<MedicationAdministrationStatus, string>> = {
  GIVEN: 'Given',
  NOT_GIVEN: 'Not given',
  REFUSED: 'Refused',
  MISSED: 'Missed',
  HELD: 'Held',
  PENDING: 'Pending',
  CANCELLED: 'Cancelled',
};

export function portalMedicationStatusLabel(
  status: MedicationAdministrationStatus,
  statusCode?: string | null,
): string {
  const code = statusCode?.trim();
  if (code && code !== 'Pending') return code;
  return STATUS_LABELS[status] ?? status;
}

export function portalMedicationRecordStatusLabel(status: MedicationRecordStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'PAUSED':
      return 'Paused';
    case 'ENDED':
      return 'Ended';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}

export function portalMedicationCarerName(
  administeredBy: {
    personalDetail: { firstName: string | null; lastName: string | null } | null;
  } | null | undefined,
): string | null {
  if (!administeredBy?.personalDetail) return null;
  const name = [administeredBy.personalDetail.firstName, administeredBy.personalDetail.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || null;
}

export function portalMedicationRoundLabel(
  round: { name: string } | null | undefined,
  schedule: { dueVisitName: string | null; dueTime: string | null } | null | undefined,
): string | null {
  if (round?.name?.trim()) return round.name.trim();
  if (schedule?.dueVisitName?.trim()) return schedule.dueVisitName.trim();
  if (schedule?.dueTime?.trim()) {
    const match = schedule.dueTime.match(/T(\d{2}:\d{2})/);
    return match?.[1] ?? schedule.dueTime;
  }
  return null;
}
