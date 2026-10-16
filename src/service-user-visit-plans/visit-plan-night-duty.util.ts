import { VisitPlanNightDuty, VisitPlanSlotKind } from '@prisma/client';

export const VISIT_PLAN_NIGHT_DUTIES = [
  VisitPlanNightDuty.NONE,
  VisitPlanNightDuty.SLEEPING_NIGHT,
  VisitPlanNightDuty.WAKING_NIGHT,
] as const;

export function slotTimesCrossMidnight(start: string | null | undefined, end: string | null | undefined): boolean {
  const startHm = start?.trim() ?? '';
  const endHm = end?.trim() ?? '';
  if (!startHm || !endHm) return false;
  return endHm <= startHm;
}

/** Code of the Night time slot (Settings → time slots). */
export const NIGHT_TIME_SLOT_CODE = 'NIGHT';

/** True for the Night time slot, including its extra rows (`NIGHT__2`, `NIGHT__X`). */
export function isNightTimeSlotCode(code: string | null | undefined): boolean {
  return (code ?? '').trim().toUpperCase().replace(/__.*$/, '') === NIGHT_TIME_SLOT_CODE;
}

/** Waking / sleeping night applies to visits in the Night time slot or that run past midnight. */
export function slotAllowsNightDuty(slot: {
  slotKind?: string | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  slotCode?: string | null;
  medicationRoundCode?: string | null;
}): boolean {
  if (slot.slotKind === VisitPlanSlotKind.OVERNIGHT) return true;
  if (isNightTimeSlotCode(slot.medicationRoundCode ?? slot.slotCode)) return true;
  return slotTimesCrossMidnight(slot.plannedStartTime, slot.plannedEndTime);
}

export function resolveVisitPlanNightDuty(slot: {
  slotKind?: string | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  slotCode?: string | null;
  medicationRoundCode?: string | null;
  nightDuty?: string | null;
}): VisitPlanNightDuty {
  if (!slotAllowsNightDuty(slot)) return VisitPlanNightDuty.NONE;
  if (slot.nightDuty === VisitPlanNightDuty.SLEEPING_NIGHT) return VisitPlanNightDuty.SLEEPING_NIGHT;
  if (slot.nightDuty === VisitPlanNightDuty.WAKING_NIGHT) return VisitPlanNightDuty.WAKING_NIGHT;
  return VisitPlanNightDuty.NONE;
}

export function visitPlanGeneratedJobMetadata(params: {
  visitPlanId: string;
  visitPlanSlotId: string;
  date: string;
  isOvernight: boolean;
  nightDuty: VisitPlanNightDuty;
}): Record<string, unknown> {
  return {
    visitPlanId: params.visitPlanId,
    visitPlanSlotId: params.visitPlanSlotId,
    date: params.date,
    isOvernight: params.isOvernight,
    nightDuty: params.nightDuty,
  };
}

/** Trust stored slot / job values — employee app does not re-validate slot kind. */
export function resolveStoredNightDuty(input: {
  slotNightDuty?: string | null;
  jobMetadata?: unknown;
}): VisitPlanNightDuty {
  const slot = input.slotNightDuty?.trim();
  if (slot === VisitPlanNightDuty.SLEEPING_NIGHT) return VisitPlanNightDuty.SLEEPING_NIGHT;
  if (slot === VisitPlanNightDuty.WAKING_NIGHT) return VisitPlanNightDuty.WAKING_NIGHT;
  const meta =
    input.jobMetadata && typeof input.jobMetadata === 'object' && !Array.isArray(input.jobMetadata)
      ? (input.jobMetadata as Record<string, unknown>)
      : {};
  const fromMeta = typeof meta.nightDuty === 'string' ? meta.nightDuty.trim() : '';
  if (fromMeta === VisitPlanNightDuty.SLEEPING_NIGHT) return VisitPlanNightDuty.SLEEPING_NIGHT;
  if (fromMeta === VisitPlanNightDuty.WAKING_NIGHT) return VisitPlanNightDuty.WAKING_NIGHT;
  return VisitPlanNightDuty.NONE;
}

export function nightDutyAppLabel(duty: VisitPlanNightDuty): string | null {
  if (duty === VisitPlanNightDuty.SLEEPING_NIGHT) return 'Sleeping night';
  if (duty === VisitPlanNightDuty.WAKING_NIGHT) return 'Waking night';
  return null;
}

export function nightDutyHomeTag(duty: VisitPlanNightDuty): {
  id: 'sleeping_night' | 'waking_night';
  label: string;
  tone: 'primary';
} | null {
  const label = nightDutyAppLabel(duty);
  if (!label) return null;
  return {
    id: duty === VisitPlanNightDuty.SLEEPING_NIGHT ? 'sleeping_night' : 'waking_night',
    label,
    tone: 'primary',
  };
}

export function jobMetadataIsOvernight(jobMetadata: unknown): boolean {
  if (!jobMetadata || typeof jobMetadata !== 'object' || Array.isArray(jobMetadata)) {
    return false;
  }
  return (jobMetadata as Record<string, unknown>).isOvernight === true;
}
