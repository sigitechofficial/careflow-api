import { VisitPlanSlotCarerRole, VisitPlanSlotExceptionType, VisitPlanSlotKind } from '@prisma/client';
import type { VisitPlanSlotScheduleShape } from './visit-plan-schedule-match.util';
import { visitPlanSlotMatchesDay } from './visit-plan-schedule-match.util';

export type VisitPlanSlotLifecycleShape = {
  slotKind: VisitPlanSlotKind;
  slotEffectiveFrom: Date | null;
  slotEffectiveTo: Date | null;
  oneOffDate: Date | null;
  isEnabled: boolean;
};

export type VisitPlanSlotExceptionShape = {
  exceptionDate: Date;
  exceptionType: VisitPlanSlotExceptionType;
};

export type VisitPlanSlotCarerAssignmentShape = {
  dayOfWeek: number | null;
  employeeId: string;
  role: VisitPlanSlotCarerRole;
  durationMinutes: number | null;
  plannedStartTime: string | null;
  plannedEndTime: string | null;
  sortOrder: number;
};

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isSameUtcDate(a: Date, b: Date): boolean {
  return utcDateOnly(a).getTime() === utcDateOnly(b).getTime();
}

function isWithinInclusive(day: Date, from: Date | null, to: Date | null): boolean {
  const d = utcDateOnly(day).getTime();
  if (from && d < utcDateOnly(from).getTime()) return false;
  if (to && d > utcDateOnly(to).getTime()) return false;
  return true;
}

export function hasSkipException(exceptions: VisitPlanSlotExceptionShape[], day: Date): boolean {
  return exceptions.some(
    (ex) => ex.exceptionType === VisitPlanSlotExceptionType.SKIP && isSameUtcDate(ex.exceptionDate, day),
  );
}

export function findExtraException(
  exceptions: VisitPlanSlotExceptionShape[],
  day: Date,
): VisitPlanSlotExceptionShape | null {
  return (
    exceptions.find(
      (ex) => ex.exceptionType === VisitPlanSlotExceptionType.EXTRA && isSameUtcDate(ex.exceptionDate, day),
    ) ?? null
  );
}

/** Whether slot should generate / show an occurrence on calendar day. */
export function visitPlanSlotOccurrenceOnDay(params: {
  slot: VisitPlanSlotScheduleShape & VisitPlanSlotLifecycleShape;
  day: Date;
  planAnchor: Date;
  planEffectiveTo: Date | null;
  exceptions: VisitPlanSlotExceptionShape[];
}): boolean {
  const { slot, day, planAnchor, planEffectiveTo, exceptions } = params;

  if (!slot.isEnabled) return false;
  if (!isWithinInclusive(day, slot.slotEffectiveFrom, slot.slotEffectiveTo)) return false;
  if (planEffectiveTo && utcDateOnly(day).getTime() > utcDateOnly(planEffectiveTo).getTime()) return false;
  if (hasSkipException(exceptions, day)) return false;

  if (findExtraException(exceptions, day)) return true;

  if (slot.slotKind === VisitPlanSlotKind.ONE_OFF) {
    return slot.oneOffDate != null && isSameUtcDate(slot.oneOffDate, day);
  }

  return visitPlanSlotMatchesDay(slot, day, planAnchor);
}

/** Resolve carers for a specific day — day-specific assignments override global (dayOfWeek null). */
export function resolveCarerAssignmentsForDay(
  assignments: VisitPlanSlotCarerAssignmentShape[],
  dayOfWeek: number,
  requiredCarers: number,
  legacyEmployeeIds: string[],
): VisitPlanSlotCarerAssignmentShape[] {
  const daySpecific = assignments
    .filter((a) => a.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.role.localeCompare(b.role));
  if (daySpecific.length > 0) return daySpecific.slice(0, requiredCarers);

  const global = assignments
    .filter((a) => a.dayOfWeek == null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.role.localeCompare(b.role));
  if (global.length > 0) return global.slice(0, requiredCarers);

  return legacyEmployeeIds.slice(0, requiredCarers).map((employeeId, index) => ({
    dayOfWeek: null,
    employeeId,
    role: index === 0 ? VisitPlanSlotCarerRole.LEAD : VisitPlanSlotCarerRole.SECONDARY,
    durationMinutes: null,
    plannedStartTime: null,
    plannedEndTime: null,
    sortOrder: index,
  }));
}

export function maxAllowedBackfillDays(
  slotAllowBackfill: number,
  requestBackfillDays: number,
  globalMax = 14,
): number {
  const cap = Math.min(globalMax, Math.max(0, requestBackfillDays));
  if (slotAllowBackfill <= 0) return 0;
  return Math.min(cap, slotAllowBackfill);
}

export function computeGenerationStart(
  fromDate: Date,
  backfillDays: number,
  slotEffectiveFrom: Date | null,
): Date {
  const from = utcDateOnly(fromDate);
  if (backfillDays <= 0) return from;
  let start = new Date(from.getTime() - backfillDays * 86400000);
  if (slotEffectiveFrom) {
    const slotFrom = utcDateOnly(slotEffectiveFrom);
    if (start.getTime() < slotFrom.getTime()) start = slotFrom;
  }
  return start;
}
