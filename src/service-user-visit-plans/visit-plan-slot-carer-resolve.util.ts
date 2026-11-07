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
  /** Carers required for this row's day(s); null = use the slot default. */
  requiredCarers?: number | null;
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
  /** Allow N days before slotEffectiveFrom (backfill catch-up before call Start Date). */
  extendBeforeEffectiveFromDays?: number;
}): boolean {
  const { slot, day, planEffectiveTo, exceptions } = params;
  const extendDays = Math.max(0, Math.floor(params.extendBeforeEffectiveFromDays ?? 0));

  if (!slot.isEnabled) return false;

  let effectiveFrom = slot.slotEffectiveFrom;
  if (extendDays > 0 && effectiveFrom) {
    effectiveFrom = new Date(utcDateOnly(effectiveFrom).getTime() - extendDays * 86400000);
  }
  if (!isWithinInclusive(day, effectiveFrom, slot.slotEffectiveTo)) return false;
  if (planEffectiveTo && utcDateOnly(day).getTime() > utcDateOnly(planEffectiveTo).getTime()) return false;
  if (hasSkipException(exceptions, day)) return false;

  if (findExtraException(exceptions, day)) return true;

  if (slot.slotKind === VisitPlanSlotKind.ONE_OFF) {
    return slot.oneOffDate != null && isSameUtcDate(slot.oneOffDate, day);
  }

  return visitPlanSlotMatchesDay(slot, day, params.planAnchor);
}

/** Resolve carers for a specific day — day-specific assignments override global (dayOfWeek null). */
export function resolveCarerAssignmentsForDay(
  assignments: VisitPlanSlotCarerAssignmentShape[],
  dayOfWeek: number,
  requiredCarers: number,
  legacyEmployeeIds: string[],
): VisitPlanSlotCarerAssignmentShape[] {
  const withEmployeeId = (rows: VisitPlanSlotCarerAssignmentShape[]) =>
    rows.filter((a) => a.employeeId?.trim());

  const daySpecific = withEmployeeId(assignments)
    .filter((a) => a.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.role.localeCompare(b.role));
  if (daySpecific.length > 0) return daySpecific.slice(0, requiredCarers);

  const global = withEmployeeId(assignments)
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

/**
 * Derive how many carers a specific day requires from the row assignments.
 * Mirrors the day-specific-vs-global selection used by resolveCarerAssignmentsForDay:
 * takes the largest per-row requiredCarers among the applicable rows, falling back to
 * the slot default when no row sets an explicit count.
 */
export function resolveRequiredCarersForDay(
  assignments: VisitPlanSlotCarerAssignmentShape[],
  dayOfWeek: number,
  slotDefault: number,
): number {
  const withEmployeeId = assignments.filter((a) => a.employeeId?.trim());
  const daySpecific = withEmployeeId.filter((a) => a.dayOfWeek === dayOfWeek);
  const group =
    daySpecific.length > 0
      ? daySpecific
      : withEmployeeId.filter((a) => a.dayOfWeek == null);
  const explicit = group
    .map((a) => a.requiredCarers)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const base = explicit.length ? Math.max(...explicit) : slotDefault;
  return Math.max(1, base);
}

/** Hard ceiling for any backfill request; the organisation limit (Settings → Dom Care) is at most this. */
export const BACKFILL_DAYS_CEILING = 31;

/** Organisation backfill limit as stored (0 = backfill off), kept within 0..BACKFILL_DAYS_CEILING. */
export function clampOrgMaxBackfillDays(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 14;
  return Math.min(BACKFILL_DAYS_CEILING, Math.max(0, Math.floor(value)));
}

/**
 * Days back one slot may be backfilled: the request, capped by the organisation limit and, when
 * the slot sets its own Max backfill days (> 0), by that too. A slot left at 0 uses the
 * organisation limit.
 */
export function maxAllowedBackfillDays(
  slotAllowBackfill: number,
  requestBackfillDays: number,
  orgMaxBackfillDays: number,
): number {
  const cap = Math.min(clampOrgMaxBackfillDays(orgMaxBackfillDays), Math.max(0, requestBackfillDays));
  if (cap <= 0) return 0;
  const slotCap = Math.max(0, Math.floor(Number(slotAllowBackfill) || 0));
  return slotCap > 0 ? Math.min(cap, slotCap) : cap;
}

export function computeGenerationStart(
  fromDate: Date,
  backfillDays: number,
  slotEffectiveFrom: Date | null,
  options?: { clampToSlotEffectiveFrom?: boolean },
): Date {
  const from = utcDateOnly(fromDate);
  if (backfillDays <= 0) return from;
  let start = new Date(from.getTime() - backfillDays * 86400000);
  const clamp = options?.clampToSlotEffectiveFrom !== false;
  if (clamp && slotEffectiveFrom) {
    const slotFrom = utcDateOnly(slotEffectiveFrom);
    if (start.getTime() < slotFrom.getTime()) start = slotFrom;
  }
  return start;
}
