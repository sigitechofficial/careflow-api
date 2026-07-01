type VisitPlanSlotRef = {
  slotCode: string;
  medicationRoundCode: string | null;
} | null;

export function resolveVisitMedicationRoundCode(slot: VisitPlanSlotRef): string | null {
  if (!slot) return null;
  const code = (slot.medicationRoundCode ?? slot.slotCode)?.trim();
  return code ? code.toUpperCase() : null;
}

export function employeeDisplayName(
  personalDetail: { firstName: string | null; lastName: string | null } | null | undefined,
): string {
  const name = [personalDetail?.firstName, personalDetail?.lastName].filter(Boolean).join(' ').trim();
  return name || 'Carer';
}
