import { DayOfWeek } from '@prisma/client';

export type CarerSkillRow = {
  skillTypeId: string | null;
  skillName: string | null;
  expiryDate: Date | null;
};

export type CarerPatternRow = {
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

export function parseHm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function timeWindowsOverlap(
  visitStart: string,
  visitEnd: string,
  patternStart: string | null,
  patternEnd: string | null,
): boolean {
  if (!patternStart || !patternEnd) return true;
  const vs = parseHm(visitStart);
  let ve = parseHm(visitEnd);
  let ps = parseHm(patternStart);
  let pe = parseHm(patternEnd);
  if (ve <= vs) ve += 24 * 60;
  if (pe <= ps) pe += 24 * 60;
  return vs < pe && ve > ps;
}

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

export function evaluateCarerAvailability(
  patterns: CarerPatternRow[],
  slotDaysOfWeek: number[],
  plannedStartTime: string,
  plannedEndTime: string,
): {
  availableDays: number[];
  unavailableDays: number[];
  timeWindowOk: boolean;
  summary: string;
} {
  const availableDays: number[] = [];
  const unavailableDays: number[] = [];
  let timeWindowOk = true;

  for (const jsDow of slotDaysOfWeek) {
    const prismaDow = JS_DOW_TO_PRISMA[jsDow];
    const pattern = patterns.find((p) => p.dayOfWeek === prismaDow);
    if (!pattern || !pattern.isAvailable) {
      unavailableDays.push(jsDow);
      continue;
    }
    if (pattern.notes === 'partial') {
      availableDays.push(jsDow);
      continue;
    }
    if (!timeWindowsOverlap(plannedStartTime, plannedEndTime, pattern.startTime, pattern.endTime)) {
      unavailableDays.push(jsDow);
      timeWindowOk = false;
      continue;
    }
    availableDays.push(jsDow);
  }

  const parts: string[] = [];
  if (availableDays.length) {
    parts.push(`Available ${availableDays.map((d) => DAY_LABEL[d]).join(', ')}`);
  }
  if (unavailableDays.length) {
    parts.push(`Unavailable ${unavailableDays.map((d) => DAY_LABEL[d]).join(', ')}`);
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

export function carerFitScore(input: {
  isBlocked: boolean;
  unavailableDays: number[];
  slotDaysCount: number;
  missingSkills: string[];
  requiredSkillCount: number;
  complianceIssues: number;
  isPreferred: boolean;
}): 'good' | 'partial' | 'poor' {
  if (input.isBlocked) return 'poor';
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
