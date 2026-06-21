import { DayOfWeek } from '@prisma/client';
import type { WorkingPatternCycleConfig } from '../employee-working-patterns/working-pattern-cycle.util';
import { timeWindowsOverlap } from '../employee-working-patterns/working-pattern-time.util';

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

export { timeWindowsOverlap } from '../employee-working-patterns/working-pattern-time.util';

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

type DayEval = 'ok' | 'unavailable' | 'partial' | 'time_fail';

function evaluatePatternDay(
  pattern: CarerPatternRow | undefined,
  plannedStartTime: string,
  plannedEndTime: string,
): DayEval {
  if (!pattern || !pattern.isAvailable) return 'unavailable';
  if (pattern.notes === 'partial') return 'partial';
  if (!timeWindowsOverlap(plannedStartTime, plannedEndTime, pattern.startTime, pattern.endTime)) {
    return 'time_fail';
  }
  return 'ok';
}

function weekLabel(evalResult: DayEval): string {
  if (evalResult === 'ok') return 'ok';
  if (evalResult === 'partial') return 'partial';
  return 'off';
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
  timeWindowOk: boolean;
  summary: string;
} {
  const cycleWeeks = Math.max(1, cycleConfig?.workingPatternCycleWeeks ?? 1);
  const availableDays: number[] = [];
  const unavailableDays: number[] = [];
  let timeWindowOk = true;
  const fortnightNotes: string[] = [];

  for (const jsDow of slotDaysOfWeek) {
    const prismaDow = JS_DOW_TO_PRISMA[jsDow];
    const dayLabel = DAY_LABEL[jsDow];

    if (cycleWeeks <= 1) {
      const pattern =
        patterns.find((p) => (p.weekInCycle ?? 1) === 1 && p.dayOfWeek === prismaDow) ??
        patterns.find((p) => p.dayOfWeek === prismaDow);
      const evalResult = evaluatePatternDay(pattern, plannedStartTime, plannedEndTime);
      if (evalResult === 'ok' || evalResult === 'partial') {
        availableDays.push(jsDow);
      } else {
        unavailableDays.push(jsDow);
        if (evalResult === 'time_fail') timeWindowOk = false;
      }
      continue;
    }

    const w1 = patterns.find((p) => p.weekInCycle === 1 && p.dayOfWeek === prismaDow);
    const w2 = patterns.find((p) => p.weekInCycle === 2 && p.dayOfWeek === prismaDow);
    const w1Eval = evaluatePatternDay(w1, plannedStartTime, plannedEndTime);
    const w2Eval = evaluatePatternDay(w2, plannedStartTime, plannedEndTime);

    const w1Ok = w1Eval === 'ok' || w1Eval === 'partial';
    const w2Ok = w2Eval === 'ok' || w2Eval === 'partial';

    if (w1Ok && w2Ok) {
      availableDays.push(jsDow);
    } else {
      unavailableDays.push(jsDow);
      if (w1Eval === 'time_fail' || w2Eval === 'time_fail') timeWindowOk = false;
      if (w1Eval !== w2Eval) {
        fortnightNotes.push(`${dayLabel}: W1 ${weekLabel(w1Eval)}, W2 ${weekLabel(w2Eval)}`);
      }
    }
  }

  const parts: string[] = [];
  if (availableDays.length) {
    parts.push(`Available ${availableDays.map((d) => DAY_LABEL[d]).join(', ')}`);
  }
  if (unavailableDays.length) {
    parts.push(`Unavailable ${unavailableDays.map((d) => DAY_LABEL[d]).join(', ')}`);
  }
  if (fortnightNotes.length) {
    parts.push(fortnightNotes.join('; '));
  }
  if (!timeWindowOk) {
    parts.push('Visit time outside working hours on some days');
  }
  if (!slotDaysOfWeek.length) {
    parts.push('No weekdays selected on visit');
  }

  return {
    availableDays,
    unavailableDays,
    timeWindowOk,
    summary: parts.join(' · ') || 'No pattern data',
  };
}

export function combineUtcDateAndHm(dateIso: string, hm: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  const t = /^(\d{2}):(\d{2})$/.exec(hm.trim());
  if (!m || !t) return new Date(Number.NaN);
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), 0, 0),
  );
}

export function visitPlanSuggestJobWindow(
  scheduledDate: string,
  plannedStartTime: string,
  plannedEndTime: string,
): { jobStart: Date; jobEnd: Date } | null {
  const jobStart = combineUtcDateAndHm(scheduledDate, plannedStartTime);
  let jobEnd = combineUtcDateAndHm(scheduledDate, plannedEndTime);
  if (Number.isNaN(jobStart.getTime()) || Number.isNaN(jobEnd.getTime())) return null;
  if (jobEnd.getTime() <= jobStart.getTime()) {
    jobEnd = new Date(jobEnd.getTime() + 86_400_000);
  }
  return { jobStart, jobEnd };
}

export function carerFitScore(input: {
  isBlocked: boolean;
  hasRotaConflict?: boolean;
  unavailableDays: number[];
  slotDaysCount: number;
  missingSkills: string[];
  requiredSkillCount: number;
  complianceIssues: number;
  isPreferred: boolean;
}): 'good' | 'partial' | 'poor' {
  if (input.isBlocked || input.hasRotaConflict) return 'poor';
  if (input.slotDaysCount > 0 && input.unavailableDays.length >= input.slotDaysCount) return 'poor';
  if (input.missingSkills.length > 0 && input.requiredSkillCount > 0) {
    if (input.missingSkills.length >= input.requiredSkillCount) return 'poor';
    return 'partial';
  }
  if (input.unavailableDays.length > 0 || input.complianceIssues > 0) return 'partial';
  if (input.isPreferred) return 'good';
  if (input.slotDaysCount > 0 && input.unavailableDays.length === 0) return 'good';
  return 'partial';
}

export { PRISMA_DOW_TO_JS, JS_DOW_TO_PRISMA, DAY_LABEL };
