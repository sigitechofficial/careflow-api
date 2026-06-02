import { MedicationRecordStatus, MedicationStatusEndReason, Prisma } from '@prisma/client';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditEventType } from '@prisma/client';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type MedicationAutoEndedRow = {
  id: string;
  medicationName: string;
  endDate: Date | null;
  previousStatus: MedicationRecordStatus;
};

/** Apply ENDED + END_DATE for active rows whose prescription end date is before today (UTC). */
export async function syncMedicationsPastEndDate(
  prisma: Prisma.TransactionClient | { serviceUserMedication: Prisma.ServiceUserMedicationDelegate },
  serviceUserId: string,
): Promise<MedicationAutoEndedRow[]> {
  const today = startOfUtcDay(new Date());
  const expired = await prisma.serviceUserMedication.findMany({
    where: {
      serviceUserId,
      deletedAt: null,
      status: { in: [MedicationRecordStatus.ACTIVE, MedicationRecordStatus.PAUSED] },
      endDate: { lt: today },
    },
    select: { id: true, endDate: true, medicationName: true, status: true },
  });
  if (!expired.length) return [];

  const now = new Date();
  await Promise.all(
    expired.map(med =>
      prisma.serviceUserMedication.update({
        where: { id: med.id },
        data: {
          status: MedicationRecordStatus.ENDED,
          statusEndReason: MedicationStatusEndReason.END_DATE,
          statusEndedAt: med.endDate ?? now,
          statusEndedById: null,
        },
      }),
    ),
  );

  return expired.map(med => ({
    id: med.id,
    medicationName: med.medicationName,
    endDate: med.endDate,
    previousStatus: med.status,
  }));
}

export async function auditAutoEndedMedications(
  audit: AuditLogsService,
  serviceUserId: string,
  rows: MedicationAutoEndedRow[],
  meta?: RequestAuditMeta,
): Promise<void> {
  for (const row of rows) {
    await audit.logAudit({
      userId: null,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_STATUS_CHANGED,
      eventType: AuditEventType.SYSTEM,
      recordType: 'ServiceUserMedication',
      recordId: row.id,
      description: `Ended automatically — prescription end date passed (${row.medicationName})`,
      oldValues: { status: row.previousStatus },
      newValues: {
        status: MedicationRecordStatus.ENDED,
        statusEndReason: MedicationStatusEndReason.END_DATE,
        statusEndedAt: row.endDate,
      },
      metadata: { serviceUserId, autoEndDate: true, medicationName: row.medicationName },
      ...meta,
    });
  }
}

export function clearStatusEndTracking(): Prisma.ServiceUserMedicationUncheckedUpdateInput {
  return {
    statusEndReason: null,
    statusEndedAt: null,
    statusEndedById: null,
  };
}

export function manualStatusEndPatch(
  userId: string,
  at: Date = new Date(),
): Prisma.ServiceUserMedicationUncheckedUpdateInput {
  return {
    statusEndReason: MedicationStatusEndReason.MANUAL,
    statusEndedAt: at,
    statusEndedById: userId,
  };
}
