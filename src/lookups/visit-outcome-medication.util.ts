import {
  MedicationStatusCodeFieldRequirement,
  VisitOutcomeArea,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

const SKIP_MEDICATION_OUTCOME_CODES = new Set(['PENDING']);

export function isRecordableMedicationStatusCode(code: string): boolean {
  return !SKIP_MEDICATION_OUTCOME_CODES.has(code.trim().toUpperCase());
}

export function medicationAllowsReasons(
  reasonRequirement: MedicationStatusCodeFieldRequirement | string,
): boolean {
  return reasonRequirement !== MedicationStatusCodeFieldRequirement.NOT_REQUIRED;
}

export async function syncMedicationVisitOutcomesFromStatusCodes(
  prisma: PrismaService,
): Promise<void> {
  const statusCodes = await prisma.medicationStatusCode.findMany({
    where: { deletedAt: null, isActive: true },
    select: {
      code: true,
      label: true,
      reasonRequirement: true,
      sortOrder: true,
    },
  });

  const activeCodes: string[] = [];
  for (const row of statusCodes) {
    if (!isRecordableMedicationStatusCode(row.code)) continue;
    activeCodes.push(row.code);
    const allowsReasons = medicationAllowsReasons(row.reasonRequirement);
    const existing = await prisma.visitOutcomeCatalog.findFirst({
      where: { area: VisitOutcomeArea.MEDICATION, code: row.code },
      select: { id: true },
    });
    if (existing) {
      await prisma.visitOutcomeCatalog.update({
        where: { id: existing.id },
        data: {
          label: row.label,
          allowsReasons,
          sortOrder: row.sortOrder,
          isActive: true,
        },
      });
    } else {
      await prisma.visitOutcomeCatalog.create({
        data: {
          area: VisitOutcomeArea.MEDICATION,
          code: row.code,
          label: row.label,
          allowsReasons,
          sortOrder: row.sortOrder,
          isActive: true,
        },
      });
    }
  }

  if (activeCodes.length === 0) return;
  await prisma.visitOutcomeCatalog.updateMany({
    where: {
      area: VisitOutcomeArea.MEDICATION,
      isActive: true,
      code: { notIn: activeCodes },
    },
    data: { isActive: false },
  });
}

export function mapMedicationOutcomesFromStatusCodes<
  TReason extends { label: string; requiresNotes: boolean; sortOrder: number },
>(params: {
  statusCodes: Array<{
    code: string;
    label: string;
    color: string;
    textColor: string;
    reasonRequirement: MedicationStatusCodeFieldRequirement | string;
    sortOrder: number;
  }>;
  reasonsByCode: Map<string, TReason[]>;
}) {
  return params.statusCodes
    .filter((row) => isRecordableMedicationStatusCode(row.code))
    .map((row) => {
      const reasons = params.reasonsByCode.get(row.code.toUpperCase()) ?? [];
      return {
        code: row.code,
        label: row.label,
        color: row.color,
        textColor: row.textColor,
        reasonRequirement: row.reasonRequirement,
        allowsReasons: medicationAllowsReasons(row.reasonRequirement),
        sortOrder: row.sortOrder,
        reasons: reasons.map((reason) => ({
          label: reason.label,
          requiresNotes: reason.requiresNotes,
          enabled: true,
          sortOrder: reason.sortOrder,
        })),
      };
    });
}
