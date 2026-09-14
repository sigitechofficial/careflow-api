import { ScheduledJobStatus, ScheduledVisitStatus } from '@prisma/client';

const DELIVERY_METADATA_KEYS = [
  'employeeApp',
  'deliveredCarePlanFormIds',
  'deliveredCarePlanDetails',
  'extraCareNotes',
  'overrunReason',
  'timingExceptionReasonCode',
  'timingExceptionNotes',
  'missedReasonCode',
  'missedReasonNotes',
  'missedReasonLabel',
  'careNotDelivered',
  'careNotDeliveredReasonCode',
  'careNotDeliveredReasonLabel',
  'careNotDeliveredNotes',
  'taskResets',
  'taskResetReason',
  'taskResetById',
] as const;

const CLOSED_JOB_STATUSES = new Set<string>([
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.DRAFT,
]);

const STARTED_JOB_STATUSES = new Set<string>([
  ScheduledJobStatus.IN_PROGRESS,
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.PARTIALLY_COMPLETED,
  ScheduledJobStatus.MISSED,
]);

const STARTED_VISIT_STATUSES = new Set<string>([
  ScheduledVisitStatus.STARTED,
  ScheduledVisitStatus.COMPLETED,
  ScheduledVisitStatus.PARTIALLY_COMPLETED,
  ScheduledVisitStatus.MISSED,
]);

export function hasIsoTimestamp(value: string | Date | null | undefined): boolean {
  if (value == null) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return value.trim().length > 0;
}

export function applyVisitDeliveryResetMetadata(
  metadata: Record<string, unknown>,
  input: { resetAt: string; reason: string; resetById: string },
): Record<string, unknown> {
  const next = { ...metadata };
  for (const key of DELIVERY_METADATA_KEYS) {
    delete next[key];
  }
  next.employeeApp = {};
  next.deliveryResetAt = input.resetAt;
  next.deliveryResetReason = input.reason;
  next.deliveryResetById = input.resetById;
  return next;
}

export function jobHasDeliveryToReset(input: {
  status: string;
  actualStartDateTime?: string | Date | null;
  actualEndDateTime?: string | Date | null;
  allocations?: Array<{ actualStartDateTime?: string | Date | null }>;
  visits?: Array<{
    status?: string | null;
    actualStartDateTime?: string | Date | null;
    actualEndDateTime?: string | Date | null;
  }>;
  checkIn?: unknown;
}): boolean {
  if (CLOSED_JOB_STATUSES.has(input.status)) return false;
  if (STARTED_JOB_STATUSES.has(input.status)) return true;
  if (hasIsoTimestamp(input.actualStartDateTime) || hasIsoTimestamp(input.actualEndDateTime)) {
    return true;
  }
  if (input.checkIn) return true;
  if (input.allocations?.some((row) => hasIsoTimestamp(row.actualStartDateTime))) return true;
  return Boolean(
    input.visits?.some(
      (visit) =>
        STARTED_VISIT_STATUSES.has(String(visit.status ?? '')) ||
        hasIsoTimestamp(visit.actualStartDateTime) ||
        hasIsoTimestamp(visit.actualEndDateTime),
    ),
  );
}
