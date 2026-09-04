import { DayOfWeek } from '@prisma/client';
import type { WorkingPatternCycleConfig } from '../employee-working-patterns/working-pattern-cycle.util';
import {
  timeWindowsOverlap,
  visitTimeFitsWithinPattern,
  visitPatternTimeMismatch,
  formatVisitPatternTimeMismatchMessage,
} from '../employee-working-patterns/working-pattern-time.util';

export type CarerSkillRow = {
  skillTypeId: string | null;
  skillName: string | null;
  expiryDate: Date | null;
};

export type CarerPatternRow = {
  weekInCycle?: number;
  dayOfWeek: DayOfWeek;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
  notes: string | null;
};

const JS_DOW_TO_PRISMA: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY,
  1: DayOfWeek.MONDAY,
  2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY,
  5: DayOfWeek.FRIDAY,
  6: DayOfWeek.SATURDAY,
};

const PRISMA_DOW_TO_JS: Record<DayOfWeek, number> = {
  [DayOfWeek.SUNDAY]: 0,
  [DayOfWeek.MONDAY]: 1,
  [DayOfWeek.TUESDAY]: 2,
  [DayOfWeek.WEDNESDAY]: 3,
  [DayOfWeek.THURSDAY]: 4,
  [DayOfWeek.FRIDAY]: 5,
  [DayOfWeek.SATURDAY]: 6,
};

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Care plan area / form name keywords → skill type name keywords (case-insensitive). */
const CARE_PLAN_SKILL_KEYWORDS: Record<string, string[]> = {
  Medication: ['medication', 'drug', 'mar'],
  Mobility: ['manual handling', 'moving', 'mobility'],
  Falls: ['falls', 'manual handling', 'moving'],
  'Skin Integrity': ['tissue viability', 'skin', 'pressure'],
  Continence: ['continence'],
  Nutrition: ['nutrition', 'dysphagia', 'eating'],
  'Mental Health': ['dementia', 'mental health', 'behaviour'],
  Psychological: ['dementia', 'mental health', 'behaviour'],
  Communication: ['communication'],
  'Physical Health': ['clinical', 'health'],
};

export { timeWindowsOverlap, visitTimeFitsWithinPattern } from '../employee-working-patterns/working-pattern-time.util';

export function requiredSkillKeywords(
  carePlanAreas: string[],
  carePlanFormNames: string[],
): string[] {
  const keywords = new Set<string>();
  for (const area of carePlanAreas) {
    for (const kw of CARE_PLAN_SKILL_KEYWORDS[area] ?? []) keywords.add(kw);
    keywords.add(area.toLowerCase());
  }
  for (const name of carePlanFormNames) {
    const lower = name.toLowerCase();
    for (const [area, kws] of Object.entries(CARE_PLAN_SKILL_KEYWORDS)) {
      if (lower.includes(area.toLowerCase()) || kws.some((k) => lower.includes(k))) {
        kws.forEach((k) => keywords.add(k));
      }
    }
    if (lower.includes('medication')) keywords.add('medication');
    if (lower.includes('falls')) keywords.add('falls');
    if (lower.includes('dementia')) keywords.add('dementia');
  }
  if (slotMedicationRound(carePlanAreas, carePlanFormNames)) {
    keywords.add('medication');
  }
  return [...keywords];
}

function slotMedicationRound(areas: string[], names: string[]): boolean {
  return (
    areas.includes('Medication') ||
    names.some((n) => n.toLowerCase().includes('medication'))
  );
}

export function matchEmployeeSkills(
  skills: CarerSkillRow[],
  requiredKeywords: string[],
  now = new Date(),
): { matched: string[]; missing: string[] } {
  if (!requiredKeywords.length) return { matched: [], missing: [] };

  const activeSkills = skills.filter(
    (s) => s.skillName && (!s.expiryDate || s.expiryDate.getTime() >= now.getTime()),
  );
  const matched: string[] = [];
  const missing: string[] = [];

  for (const kw of requiredKeywords) {
    const hit = activeSkills.some((s) =>
      (s.skillName ?? '').toLowerCase().includes(kw.toLowerCase()),
    );
    if (hit) matched.push(kw);
    else missing.push(kw);
  }

  return { matched, missing };
}

export type VisitPlanPatternDayEval = 'ok' | 'unavailable' | 'partial' | 'time_fail';

export function evaluateVisitPlanPatternDay(
  pattern: CarerPatternRow | undefined,
  plannedStartTime: string,
  plannedEndTime: string,
): VisitPlanPatternDayEval {
  if (!pattern || !pattern.isAvailable) return 'unavailable';
  if (pattern.notes === 'partial') return 'partial';
  if (pattern.startTime && pattern.endTime) {
    if (
      !timeWindowsOverlap(
        plannedStartTime,
        plannedEndTime,
        pattern.startTime,
        pattern.endTime,
      )
    ) {
      return 'time_fail';
    }
    if (
      !visitTimeFitsWithinPattern(
        plannedStartTime,
        plannedEndTime,
        pattern.startTime,
        pattern.endTime,
      )
    ) {
      return 'partial';
    }
    return 'ok';
  }
  return 'ok';
}

function weekLabel(evalResult: VisitPlanPatternDayEval): string {
  if (evalResult === 'ok') return 'ok';
  if (evalResult === 'partial') return 'partial';
  return 'off';
}

function appendTimeMismatchMessage(
  messages: string[],
  jsDow: number,
  pattern: CarerPatternRow | undefined,
  plannedStartTime: string,
  plannedEndTime: string,
  weekSuffix = '',
): void {
  if (!pattern?.startTime || !pattern?.endTime) return;
  const mismatch = visitPatternTimeMismatch(
    plannedStartTime,
    plannedEndTime,
    pattern.startTime,
    pattern.endTime,
  );
  if (!mismatch) return;
  messages.push(
    formatVisitPatternTimeMismatchMessage(
      `${DAY_LABEL[jsDow]}${weekSuffix}`,
      mismatch,
      pattern.startTime,
      pattern.endTime,
    ),
  );
}

function recordPartialOverlapTimeNotice(
  jsDow: number,
  pattern: CarerPatternRow | undefined,
  plannedStartTime: string,
  plannedEndTime: string,
  timeMismatchDays: number[],
  timeMismatchMessages: string[],
  weekSuffix = '',
): void {
  if (!pattern?.startTime || !pattern?.endTime) return;
  if (
    visitTimeFitsWithinPattern(
      plannedStartTime,
      plannedEndTime,
      pattern.startTime,
      pattern.endTime,
    )
  ) {
    return;
  }
  if (
    !timeWindowsOverlap(
      plannedStartTime,
      plannedEndTime,
      pattern.startTime,
      pattern.endTime,
    )
  ) {
    return;
  }
  if (!timeMismatchDays.includes(jsDow)) {
    timeMismatchDays.push(jsDow);
  }
  appendTimeMismatchMessage(
    timeMismatchMessages,
    jsDow,
    pattern,
    plannedStartTime,
    plannedEndTime,
    weekSuffix,
  );
}

export function evaluateCarerAvailability(
  patterns: CarerPatternRow[],
  slotDaysOfWeek: number[],
  plannedStartTime: string,
  plannedEndTime: string,
  cycleConfig?: WorkingPatternCycleConfig,
): {
  availableDays: number[];
  unavailableDays: number[];
  timeMismatchDays: number[];
  timeMismatchMessages: string[];
  timeWindowOk: boolean;
  summary: string;
} {
  const cycleWeeks = Math.max(1, cycleConfig?.workingPatternCycleWeeks ?? 1);
  const availableDays: number[] = [];
  const unavailableDays: number[] = [];
  const patternUnavailableDays: number[] = [];
  const timeMismatchDays: number[] = [];
  const timeMismatchMessages: string[] = [];
  let timeWindowOk = true;
  const fortnightNotes: string[] = [];

  for (const jsDow of slotDaysOfWeek) {
    const prismaDow = JS_DOW_TO_PRISMA[jsDow];
    const dayLabel = DAY_LABEL[jsDow];

    if (cycleWeeks <= 1) {
      const pattern =
        patterns.find((p) => (p.weekInCycle ?? 1) === 1 && p.dayOfWeek === prismaDow) ??
        patterns.find((p) => p.dayOfWeek === prismaDow);
      const evalResult = evaluateVisitPlanPatternDay(pattern, plannedStartTime, plannedEndTime);
      if (evalResult === 'ok' || evalResult === 'partial') {
        availableDays.push(jsDow);
        if (evalResult === 'partial') {
          timeWindowOk = false;
          recordPartialOverlapTimeNotice(
            jsDow,
            pattern,
            plannedStartTime,
            plannedEndTime,
            timeMismatchDays,
            timeMismatchMessages,
          );
        }
      } else if (evalResult === 'time_fail') {
        unavailableDays.push(jsDow);
        timeMismatchDays.push(jsDow);
        timeWindowOk = false;
        appendTimeMismatchMessage(
          timeMismatchMessages,
          jsDow,
          pattern,
          plannedStartTime,
          plannedEndTime,
        );
      } else {
        unavailableDays.push(jsDow);
        patternUnavailableDays.push(jsDow);
      }
      continue;
    }

    const w1 = patterns.find((p) => p.weekInCycle === 1 && p.dayOfWeek === prismaDow);
    const w2 = patterns.find((p) => p.weekInCycle === 2 && p.dayOfWeek === prismaDow);
    const w1Eval = evaluateVisitPlanPatternDay(w1, plannedStartTime, plannedEndTime);
    const w2Eval = evaluateVisitPlanPatternDay(w2, plannedStartTime, plannedEndTime);

    const w1Ok = w1Eval === 'ok' || w1Eval === 'partial';
    const w2Ok = w2Eval === 'ok' || w2Eval === 'partial';

    if (w1Ok && w2Ok) {
      availableDays.push(jsDow);
      if (w1Eval === 'partial') {
        timeWindowOk = false;
        recordPartialOverlapTimeNotice(
          jsDow,
          w1,
          plannedStartTime,
          plannedEndTime,
          timeMismatchDays,
          timeMismatchMessages,
          ' (W1)',
        );
      }
      if (w2Eval === 'partial') {
        timeWindowOk = false;
        recordPartialOverlapTimeNotice(
          jsDow,
          w2,
          plannedStartTime,
          plannedEndTime,
          timeMismatchDays,
          timeMismatchMessages,
          ' (W2)',
        );
      }
    } else {
      unavailableDays.push(jsDow);
      if (w1Eval === 'time_fail' || w2Eval === 'time_fail') {
        timeMismatchDays.push(jsDow);
        timeWindowOk = false;
        if (w1Eval === 'time_fail') {
          appendTimeMismatchMessage(
            timeMismatchMessages,
            jsDow,
            w1,
            plannedStartTime,
            plannedEndTime,
            ' (W1)',
          );
        }
        if (w2Eval === 'time_fail') {
          appendTimeMismatchMessage(
            timeMismatchMessages,
            jsDow,
            w2,
            plannedStartTime,
            plannedEndTime,
            ' (W2)',
          );
        }
      } else {
        patternUnavailableDays.push(jsDow);
      }
      if (w1Eval !== w2Eval) {
        fortnightNotes.push(`${dayLabel}: W1 ${weekLabel(w1Eval)}, W2 ${weekLabel(w2Eval)}`);
      }
    }
  }

  const parts: string[] = [];
  if (availableDays.length) {
    parts.push(`Available ${availableDays.map((d) => DAY_LABEL[d]).join(', ')}`);
  }
  if (patternUnavailableDays.length) {
    parts.push(`Unavailable ${patternUnavailableDays.map((d) => DAY_LABEL[d]).join(', ')}`);
  }
  if (fortnightNotes.length) {
    parts.push(fortnightNotes.join('; '));
  }
  if (timeMismatchMessages.length) {
    parts.push(...timeMismatchMessages);
  }
  if (!slotDaysOfWeek.length) {
    parts.push('No weekdays selected on visit');
  }

  return {
    availableDays,
    unavailableDays,
    timeMismatchDays,
    timeMismatchMessages,
    timeWindowOk,
    summary: parts.join(' · ') || 'No pattern data',
  };
}

import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  combineOperationalDateAndHm,
} from '../common/utils/operational-day.util';

export function combineUtcDateAndHm(
  dateIso: string,
  hm: string,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
  return combineOperationalDateAndHm(dateIso, hm, timeZone);
}

export function visitPlanSuggestJobWindow(
  scheduledDate: string,
  plannedStartTime: string,
  plannedEndTime: string,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): { jobStart: Date; jobEnd: Date } | null {
  const jobStart = combineUtcDateAndHm(scheduledDate, plannedStartTime, timeZone);
  let jobEnd = combineUtcDateAndHm(scheduledDate, plannedEndTime, timeZone);
  if (Number.isNaN(jobStart.getTime()) || Number.isNaN(jobEnd.getTime())) return null;
  if (jobEnd.getTime() <= jobStart.getTime()) {
    jobEnd = new Date(jobEnd.getTime() + 86_400_000);
  }
  return { jobStart, jobEnd };
}

/** How far ahead visit-plan carer suggest scans the rota for double bookings. */
export const VISIT_PLAN_ROTA_LOOKAHEAD_WEEKS = 8;

export function visitPlanPatternRotaLookaheadEnd(from: Date): Date {
  const end = new Date(from);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + VISIT_PLAN_ROTA_LOOKAHEAD_WEEKS * 7);
  return end;
}

export function visitTimesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function scheduledJobEndTime(jobStart: Date, jobEnd: Date | null): Date {
  if (jobEnd && jobEnd.getTime() > jobStart.getTime()) return jobEnd;
  return new Date(jobStart.getTime() + 60 * 60 * 1000);
}

/** True when an existing scheduled job overlaps this visit-plan slot on a matching weekday. */
export function scheduledJobOverlapsVisitPlanSlot(input: {
  jobStart: Date;
  jobEnd: Date | null;
  slotDaysOfWeek: Iterable<number>;
  plannedStartTime: string;
  plannedEndTime: string;
  timeZone?: string;
}): boolean {
  const slotDays = new Set(input.slotDaysOfWeek);
  if (!slotDays.size) return false;
  if (!slotDays.has(input.jobStart.getUTCDay())) return false;

  const slotWindow = visitPlanSuggestJobWindow(
    input.jobStart.toISOString().slice(0, 10),
    input.plannedStartTime,
    input.plannedEndTime,
    input.timeZone,
  );
  if (!slotWindow) return false;

  const existingEnd = scheduledJobEndTime(input.jobStart, input.jobEnd);
  return visitTimesOverlap(
    input.jobStart,
    existingEnd,
    slotWindow.jobStart,
    slotWindow.jobEnd,
  );
}

export function carerFitScore(input: {
  isBlocked: boolean;
  hasRotaConflict?: boolean;
  unavailableDays: number[];
  slotDaysCount: number;
  missingSkills: string[];
  requiredSkillCount: number;
  complianceIssues: number;
  complianceBlocksAllocation?: boolean;
  isPreferred: boolean;
  timeOutsidePattern?: boolean;
}): 'good' | 'partial' | 'poor' {
  if (input.isBlocked || input.hasRotaConflict || input.complianceBlocksAllocation) return 'poor';
  if (input.slotDaysCount > 0 && input.unavailableDays.length >= input.slotDaysCount) return 'poor';
  if (input.missingSkills.length > 0 && input.requiredSkillCount > 0) {
    if (input.missingSkills.length >= input.requiredSkillCount) return 'poor';
    return 'partial';
  }
  if (input.unavailableDays.length > 0 || input.complianceIssues > 0 || input.timeOutsidePattern) {
    return 'partial';
  }
  if (input.isPreferred) return 'good';
  if (input.slotDaysCount > 0 && input.unavailableDays.length === 0) return 'good';
  return 'partial';
}

export { PRISMA_DOW_TO_JS, JS_DOW_TO_PRISMA, DAY_LABEL };

export function resolveServiceUserLocationIds(su: {
  locationId: string | null;
  assignments?: Array<{ locationId: string | null }> | null;
}): string[] {
  const ids = new Set<string>();
  if (su.locationId) ids.add(su.locationId);
  for (const row of su.assignments ?? []) {
    if (row.locationId) ids.add(row.locationId);
  }
  return [...ids];
}

export function buildEmployeeEmploymentLocationWhere(
  locationIds: string[],
): { deletedAt: null; OR: Array<Record<string, unknown>> } | null {
  if (!locationIds.length) return null;
  return {
    deletedAt: null,
    OR: [
      { accessAllZones: true },
      { locationId: { in: locationIds } },
      { floorLocations: { some: { locationId: { in: locationIds } } } },
    ],
  };
}
