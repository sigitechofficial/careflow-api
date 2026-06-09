import type { Prisma } from '@prisma/client';
import { DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS } from '../../prisma/seed-data/medication-administration-rounds.defaults';
import {
  defaultSlotTimes,
  medRoundCodeToSlot,
  VISIT_PLAN_SLOT_ORDER,
} from './visit-plan-slot-defaults';

type VisitSlotRow = { selected?: boolean; from?: string; to?: string; roundName?: string };

function hm(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m?.[1] || !m[2]) return fallback;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export type VisitPlanSlotSeed = {
  slotCode: (typeof VISIT_PLAN_SLOT_ORDER)[number];
  daysOfWeek: number[];
  plannedStartTime: string;
  plannedEndTime: string;
  requiredCarers: number;
  isEnabled: boolean;
  medicationRoundCode: string | null;
  sortOrder: number;
};

export function buildSlotsFromPreferredVisitTimes(
  selectedOptions: Prisma.JsonValue | null | undefined,
  numberOfCarers: number,
): VisitPlanSlotSeed[] {
  const enabled = new Map<string, { from: string; to: string; roundCode: string }>();

  if (selectedOptions && typeof selectedOptions === 'object' && !Array.isArray(selectedOptions)) {
    for (const round of DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS) {
      const entry = (selectedOptions as Record<string, VisitSlotRow>)[round.code];
      if (!entry?.selected) continue;
      const slot = medRoundCodeToSlot(round.code);
      if (!slot) continue;
      enabled.set(slot, {
        from: hm(entry.from, round.windowStart),
        to: hm(entry.to, round.windowEnd),
        roundCode: round.code,
      });
    }
  } else if (Array.isArray(selectedOptions)) {
    for (const raw of selectedOptions) {
      const code = String(raw).toUpperCase();
      const round = DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS.find((r) => r.code === code);
      const slot = medRoundCodeToSlot(code);
      if (!round || !slot) continue;
      enabled.set(slot, {
        from: hm(round.windowStart, round.windowStart),
        to: hm(round.windowEnd, round.windowEnd),
        roundCode: round.code,
      });
    }
  }

  return VISIT_PLAN_SLOT_ORDER.map((slotCode) => {
    const defaults = defaultSlotTimes(slotCode);
    const pick = enabled.get(slotCode);
    return {
      slotCode,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
      plannedStartTime: pick?.from ?? defaults.start,
      plannedEndTime: pick?.to ?? defaults.end,
      requiredCarers: numberOfCarers,
      isEnabled: Boolean(pick),
      medicationRoundCode: pick?.roundCode ?? null,
      sortOrder: defaults.sortOrder,
    };
  });
}
