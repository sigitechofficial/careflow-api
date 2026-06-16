type AcceptedCarePlanRef = {
  formId: string;
  formName: string;
  carePlanArea: string;
};

type SlotRef = {
  slotCode: string;
  medicationRoundCode?: string | null;
  isEnabled?: boolean;
};

function defaultSlotsForCarePlan(carePlan: AcceptedCarePlanRef): string[] {
  const area = carePlan.carePlanArea.trim();
  const name = carePlan.formName.trim().toLowerCase();

  if (area === 'Medication' || name.includes('medication') || name.includes('emar')) {
    return ['MORNING', 'MIDDAY', 'AFTERNOON', 'EVENING', 'NIGHT'];
  }
  if (area === 'Nutrition' || name.includes('eating') || name.includes('drinking')) {
    return ['MIDDAY', 'AFTERNOON'];
  }
  if (area === 'Continence' || name.includes('continence')) {
    return ['MORNING', 'EVENING', 'NIGHT'];
  }
  if (area === 'Mobility' || area === 'Falls' || name.includes('mobility') || name.includes('falls')) {
    return ['MORNING', 'EVENING'];
  }
  if (area === 'Skin Integrity' || name.includes('skin')) {
    return ['MORNING', 'EVENING'];
  }
  if (area === 'Mental Health' || name.includes('psycholog') || name.includes('mental')) {
    return ['MORNING', 'AFTERNOON', 'EVENING'];
  }
  if (area === 'Communication' || name.includes('communication')) {
    return ['MORNING', 'MIDDAY', 'AFTERNOON', 'EVENING'];
  }
  if (name.includes('night') || name.includes('sleep')) {
    return ['NIGHT', 'EVENING'];
  }
  return ['MORNING', 'EVENING'];
}

export function suggestedCarePlanFormIdsForSlot(
  slot: SlotRef,
  acceptedCarePlans: AcceptedCarePlanRef[],
): string[] {
  return acceptedCarePlans
    .filter((carePlan) => {
      if (slot.medicationRoundCode) {
        const med =
          carePlan.carePlanArea === 'Medication' ||
          carePlan.formName.toLowerCase().includes('medication');
        if (med) return true;
      }
      return defaultSlotsForCarePlan(carePlan).includes(slot.slotCode);
    })
    .map((cp) => cp.formId);
}

export function applySuggestedCarePlanLinksToSlots<
  T extends SlotRef & { linkedCarePlanFormIds?: string[] },
>(slots: T[], acceptedCarePlans: AcceptedCarePlanRef[]): T[] {
  if (!acceptedCarePlans.length) return slots;
  return slots.map((slot) => {
    if ((slot.linkedCarePlanFormIds ?? []).length > 0) return slot;
    const suggested = suggestedCarePlanFormIdsForSlot(slot, acceptedCarePlans);
    return suggested.length > 0 ? { ...slot, linkedCarePlanFormIds: suggested } : slot;
  });
}
