import type { VisitPlanSlot, VisitPlanSlotCarerAssignment } from '@prisma/client';
import { slotLabel } from './visit-plan-slot-defaults';

export type VisitPlanSlotReadinessInput = Pick<
  VisitPlanSlot,
  | 'slotCode'
  | 'medicationRoundCode'
  | 'isEnabled'
  | 'plannedStartTime'
  | 'plannedEndTime'
  | 'daysOfWeek'
  | 'scheduleFrequency'
  | 'requiredCarers'
  | 'assignedEmployeeIds'
> & {
  carerAssignments?: Pick<VisitPlanSlotCarerAssignment, 'employeeId'>[];
};

export function resolveAssignedEmployeeIds(
  assignedEmployeeIds?: string[] | null,
  carerAssignments?: Pick<VisitPlanSlotCarerAssignment, 'employeeId'>[] | null,
): string[] {
  const fromAssignments = [
    ...new Set(
      (carerAssignments ?? [])
        .map((row) => row.employeeId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (fromAssignments.length) return fromAssignments;
  return (assignedEmployeeIds ?? []).filter((id) => id.trim());
}

export function slotAssignedEmployeeIds(slot: VisitPlanSlotReadinessInput): string[] {
  return resolveAssignedEmployeeIds(slot.assignedEmployeeIds, slot.carerAssignments);
}

export function assessVisitPlanSlotReadiness(
  slot: VisitPlanSlotReadinessInput,
  roundNameByCode?: Map<string, string>,
  options?: { requireCarers?: boolean },
): string[] {
  const requireCarers = options?.requireCarers !== false;
  if (!slot.isEnabled) return [];

  const label = slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode);
  const issues: string[] = [];

  if (!slot.plannedStartTime?.trim() || !slot.plannedEndTime?.trim()) {
    issues.push(`${label}: set start and end times`);
  }

  if (slot.scheduleFrequency === 'DAILY' && (!slot.daysOfWeek || slot.daysOfWeek.length === 0)) {
    issues.push(`${label}: choose visit days`);
  }

  if (requireCarers) {
    const required = Math.max(1, slot.requiredCarers ?? 1);
    const assigned = slotAssignedEmployeeIds(slot);
    if (assigned.length < required) {
      issues.push(
        `${label}: ${assigned.length} of ${required} carer${required === 1 ? '' : 's'} assigned`,
      );
    }
  }

  return issues;
}

export function assessVisitPlanReadiness(
  slots: VisitPlanSlotReadinessInput[],
  roundNameByCode?: Map<string, string>,
  options?: { requireCarers?: boolean },
): { ready: boolean; issues: string[]; enabledSlotCount: number } {
  const enabled = slots.filter((slot) => slot.isEnabled);
  if (!enabled.length) {
    return { ready: false, issues: ['No enabled visit slots'], enabledSlotCount: 0 };
  }

  const issues = enabled.flatMap((slot) =>
    assessVisitPlanSlotReadiness(slot, roundNameByCode, options),
  );
  return {
    ready: issues.length === 0,
    issues,
    enabledSlotCount: enabled.length,
  };
}
