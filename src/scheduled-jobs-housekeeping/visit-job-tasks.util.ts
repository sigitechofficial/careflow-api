import type { Prisma } from '@prisma/client';
import { timelineVisitSelect } from '../scheduling/schedule-timeline.mapper';

export type JobVisitPlanSlotRow = {
  slotCode: string;
  medicationRoundCode: string | null;
};

export function resolveJobMedicationRoundCode(
  visits: Array<{
    visitPlanSlot: JobVisitPlanSlotRow | null;
  }>,
): string | null {
  const slot = visits[0]?.visitPlanSlot;
  if (!slot) return null;
  const code = (slot.medicationRoundCode ?? slot.slotCode)?.trim();
  return code ? code.toUpperCase() : null;
}

export const visitJobTaskSlotSelect = {
  slotCode: true,
  medicationRoundCode: true,
} satisfies Prisma.VisitPlanSlotSelect;

export const visitJobTaskVisitSelect = {
  ...timelineVisitSelect,
  visitPlanSlot: { select: visitJobTaskSlotSelect },
} satisfies Prisma.ScheduledVisitSelect;
