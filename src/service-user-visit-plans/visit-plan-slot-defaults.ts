import { DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS } from '../../prisma/seed-data/medication-administration-rounds.defaults';
import {
  DEFAULT_SLOT_LINK_FIELDS,
  DEFAULT_SLOT_SCHEDULING_OPTIONS,
  mergeSlotSchedulingOptions,
} from './visit-plan-slot-options.defaults';

export type MedicationRoundCatalogRow = {
  code: string;
  name: string;
  time: string;
  windowStart: string | null;
  windowEnd: string | null;
  sortOrder: number;
};

export const LEGACY_VISIT_SLOT_TO_ROUND: Record<string, string> = {
  LUNCH: 'MIDDAY',
  TEA: 'AFTERNOON',
};

export function normalizeVisitPlanSlotCode(code: string): string {
  const upper = code.trim().toUpperCase();
  return LEGACY_VISIT_SLOT_TO_ROUND[upper] ?? upper;
}

function hm(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m?.[1] || !m[2]) return fallback;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function slotLabel(code: string, roundNameByCode?: Map<string, string>): string {
  const normalized = normalizeVisitPlanSlotCode(code);
  return roundNameByCode?.get(normalized) ?? roundNameByCode?.get(code) ?? code;
}

export function defaultVisitPlanSlotsFromRounds(
  rounds: MedicationRoundCatalogRow[] = DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS,
): Array<{
  slotCode: string;
  daysOfWeek: number[];
  plannedStartTime: string;
  plannedEndTime: string;
  requiredCarers: number;
  isEnabled: boolean;
  medicationRoundCode: string | null;
  notes: string;
  sortOrder: number;
} & typeof DEFAULT_SLOT_SCHEDULING_OPTIONS &
  typeof DEFAULT_SLOT_LINK_FIELDS> {
  const sorted = [...rounds].sort(
    (a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.name.localeCompare(b.name),
  );

  return sorted.map((round, index) => ({
    slotCode: round.code,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
    plannedStartTime: hm(round.windowStart, round.time),
    plannedEndTime: hm(round.windowEnd, round.time),
    requiredCarers: 1,
    isEnabled: false,
    medicationRoundCode: round.code,
    notes: '',
    sortOrder: round.sortOrder ?? index,
    ...DEFAULT_SLOT_LINK_FIELDS,
    ...mergeSlotSchedulingOptions(null),
  }));
}

export function defaultVisitPlanSlots() {
  return defaultVisitPlanSlotsFromRounds();
}

export const ALL_WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
