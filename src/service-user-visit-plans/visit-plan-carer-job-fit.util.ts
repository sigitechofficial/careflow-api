import {
  employmentToCycleConfig,
  resolvePatternForDateTime,
  type WorkingPatternCycleConfig,
  type WorkingPatternRow,
} from '../employee-working-patterns/working-pattern-cycle.util';
import { hmFromJobDate } from '../employee-working-patterns/working-pattern-time.util';
import {
  DAY_LABEL,
  evaluateCarerAvailability,
  evaluateVisitPlanPatternDay,
  type CarerPatternRow,
} from './visit-plan-carer-suggest.util';

export type CarerPatternConflict = {
  employeeId: string;
  employeeName: string;
  slotCode: string;
  slotLabel: string;
  unavailableDayLabels: string[];
  timeOutsidePattern: boolean;
  timeMismatchMessages: string[];
  summary: string;
};

export type SlotCarerPatternInput = {
  slotCode: string;
  slotLabel: string;
  daysOfWeek: number[];
  plannedStartTime: string;
  plannedEndTime: string;
  isEnabled: boolean;
  assignedEmployeeIds: string[];
  carerAssignments?: Array<{
    employeeId: string;
    dayOfWeek?: number | null;
    plannedStartTime?: string | null;
    plannedEndTime?: string | null;
  }>;
};

export type EmployeePatternContext = {
  employeeId: string;
  employeeName: string;
  patterns: CarerPatternRow[];
  cycleConfig: WorkingPatternCycleConfig;
};

type DayEval = 'ok' | 'unavailable' | 'partial' | 'time_fail';

function evaluatePatternDay(
  pattern: CarerPatternRow | undefined,
  plannedStartTime: string,
  plannedEndTime: string,
): DayEval {
  return evaluateVisitPlanPatternDay(pattern, plannedStartTime, plannedEndTime);
}

function toWorkingPatternRows(patterns: CarerPatternRow[]): WorkingPatternRow[] {
  return patterns.map((p) => ({
    weekInCycle: p.weekInCycle ?? 1,
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    isAvailable: p.isAvailable,
    notes: p.notes,
  }));
}

/** Whether a carer can take this concrete visit instance (day + wall-clock times). */
export function isEmployeeAvailableForVisit(
  patterns: CarerPatternRow[],
  cycleConfig: WorkingPatternCycleConfig,
  visitStart: Date,
  visitEnd: Date,
): boolean {
  const rows = toWorkingPatternRows(patterns);
  const resolved = resolvePatternForDateTime(rows, cycleConfig, visitStart);
  const pattern: CarerPatternRow | undefined = resolved
    ? {
        weekInCycle: resolved.weekInCycle,
        dayOfWeek: resolved.dayOfWeek,
        startTime: resolved.startTime,
        endTime: resolved.endTime,
        isAvailable: resolved.isAvailable,
        notes: resolved.notes,
      }
    : undefined;

  const startHm = hmFromJobDate(visitStart);
  const endHm = hmFromJobDate(visitEnd);
  const evalResult = evaluatePatternDay(pattern, startHm, endHm);
  return evalResult === 'ok' || evalResult === 'partial';
}

function assignmentRowsForSlot(slot: SlotCarerPatternInput): Array<{
  employeeId: string;
  days: number[];
  plannedStartTime: string;
  plannedEndTime: string;
}> {
  const slotDays = [...new Set(slot.daysOfWeek)].sort((a, b) => a - b);
  if (!slot.isEnabled || !slotDays.length) return [];

  const rows: Array<{
    employeeId: string;
    days: number[];
    plannedStartTime: string;
    plannedEndTime: string;
  }> = [];

  if (slot.carerAssignments?.length) {
    for (const assignment of slot.carerAssignments) {
      const employeeId = assignment.employeeId?.trim();
      if (!employeeId) continue;
      const days =
        assignment.dayOfWeek == null
          ? slotDays
          : slotDays.includes(assignment.dayOfWeek)
            ? [assignment.dayOfWeek]
            : [];
      if (!days.length) continue;
      rows.push({
        employeeId,
        days,
        plannedStartTime: assignment.plannedStartTime?.trim() || slot.plannedStartTime,
        plannedEndTime: assignment.plannedEndTime?.trim() || slot.plannedEndTime,
      });
    }
    return rows;
  }

  for (const employeeId of slot.assignedEmployeeIds) {
    const id = employeeId?.trim();
    if (!id) continue;
    rows.push({
      employeeId: id,
      days: slotDays,
      plannedStartTime: slot.plannedStartTime,
      plannedEndTime: slot.plannedEndTime,
    });
  }
  return rows;
}

export function collectCarerPatternConflicts(
  slots: SlotCarerPatternInput[],
  employees: EmployeePatternContext[],
): CarerPatternConflict[] {
  const employeeById = new Map(employees.map((e) => [e.employeeId, e]));
  const conflicts: CarerPatternConflict[] = [];
  const seen = new Set<string>();

  for (const slot of slots) {
    if (!slot.isEnabled) continue;

    for (const row of assignmentRowsForSlot(slot)) {
      const key = `${slot.slotCode}:${row.employeeId}:${row.days.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const employee = employeeById.get(row.employeeId);
      if (!employee) continue;

      const availability = evaluateCarerAvailability(
        employee.patterns,
        row.days,
        row.plannedStartTime,
        row.plannedEndTime,
        employee.cycleConfig,
      );

      const unavailableOnAssignment = row.days.filter(
        (day) =>
          availability.unavailableDays.includes(day) &&
          !availability.timeMismatchDays.includes(day),
      );
      const hasUnavailableDays = unavailableOnAssignment.length > 0;
      const timeOutside = row.days.some(
        (day) =>
          availability.unavailableDays.includes(day) &&
          availability.timeMismatchDays.includes(day),
      );

      if (!hasUnavailableDays && !timeOutside) continue;

      const unavailableDayLabels = unavailableOnAssignment.map((d) => DAY_LABEL[d]);
      const timeMismatchMessages =
        availability.timeMismatchMessages.length > 0
          ? availability.timeMismatchMessages
          : timeOutside
            ? ['Visit time outside working hours on some days']
            : [];
      const parts: string[] = [];
      if (unavailableDayLabels.length) {
        parts.push(`Not available on ${unavailableDayLabels.join(', ')}`);
      }
      if (timeMismatchMessages.length) {
        parts.push(...timeMismatchMessages);
      }

      conflicts.push({
        employeeId: row.employeeId,
        employeeName: employee.employeeName,
        slotCode: slot.slotCode,
        slotLabel: slot.slotLabel,
        unavailableDayLabels,
        timeOutsidePattern: timeOutside,
        timeMismatchMessages,
        summary: parts.join(' · ') || availability.summary,
      });
    }
  }

  return conflicts;
}

export function employmentToPatternContext(
  employee: {
    id: string;
    createdAt: Date;
    personalDetail?: { firstName?: string | null; lastName?: string | null } | null;
    employment?: {
      workingPatternCycleWeeks?: number | null;
      workingPatternCycleAnchorDate?: Date | null;
      startDate?: Date | null;
    } | null;
    workingPatterns: Array<{
      weekInCycle: number;
      dayOfWeek: import('@prisma/client').DayOfWeek;
      startTime: string | null;
      endTime: string | null;
      isAvailable: boolean;
      notes: string | null;
    }>;
  },
): EmployeePatternContext {
  const name = `${employee.personalDetail?.firstName ?? ''} ${employee.personalDetail?.lastName ?? ''}`.trim();
  return {
    employeeId: employee.id,
    employeeName: name || 'Carer',
    patterns: employee.workingPatterns.map((p) => ({
      weekInCycle: p.weekInCycle,
      dayOfWeek: p.dayOfWeek,
      startTime: p.startTime,
      endTime: p.endTime,
      isAvailable: p.isAvailable,
      notes: p.notes,
    })),
    cycleConfig: employmentToCycleConfig(employee.employment, employee.createdAt),
  };
}
