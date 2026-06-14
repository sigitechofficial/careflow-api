import { MedicationKind, MedicationRecordStatus } from '@prisma/client';
import type { EmarComposeSummary } from './compose-context.types';

type MedRow = {
  medicationName: string;
  medicationKind: MedicationKind;
  status: MedicationRecordStatus;
  dose: string | null;
  strength: string | null;
};

export function buildEmarComposeSummary(meds: MedRow[]): EmarComposeSummary {
  const active = meds.filter((m) => m.status === MedicationRecordStatus.ACTIVE);
  const scheduled = active.filter((m) => m.medicationKind !== MedicationKind.PRN);
  const prn = active.filter((m) => m.medicationKind === MedicationKind.PRN);

  const doseLabel = (m: MedRow) => m.dose?.trim() || m.strength?.trim() || null;

  const medListText =
    scheduled.length === 0
      ? ''
      : scheduled
          .map((m) => {
            const dose = doseLabel(m);
            return dose ? `${m.medicationName} (${dose})` : m.medicationName;
          })
          .join('\n');

  const prnText =
    prn.length === 0
      ? ''
      : prn
          .map((m) => {
            const dose = doseLabel(m);
            return dose ? `${m.medicationName} (${dose})` : m.medicationName;
          })
          .join('\n');

  return {
    activeCount: active.length,
    scheduledCount: scheduled.length,
    prnCount: prn.length,
    medListText,
    prnText,
  };
}
