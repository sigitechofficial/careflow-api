import type { Prisma } from '@prisma/client';
import { DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS } from '../../prisma/seed-data/medication-administration-rounds.defaults';
import {
  defaultVisitPlanSlotsFromRounds,
  type MedicationRoundCatalogRow,
} from './visit-plan-slot-defaults';

type VisitSlotRow = { selected?: boolean; from?: string; to?: string; roundName?: string };

function hm(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m?.[1] || !m[2]) return fallback;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export type VisitPlanSlotSeed = {
  slotCode: string;
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
  rounds: MedicationRoundCatalogRow[] = DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS,
): VisitPlanSlotSeed[] {
  const catalogue = defaultVisitPlanSlotsFromRounds(rounds);
  const enabled = new Map<string, { from: string; to: string; roundCode: string }>();

  if (selectedOptions && typeof selectedOptions === 'object' && !Array.isArray(selectedOptions)) {
    for (const round of rounds) {
      const entry = (selectedOptions as Record<string, VisitSlotRow>)[round.code];
      if (!entry?.selected) continue;
      enabled.set(round.code, {
        from: hm(entry.from, round.windowStart ?? round.time),
        to: hm(entry.to, round.windowEnd ?? round.time),
        roundCode: round.code,
      });
    }
  } else if (Array.isArray(selectedOptions)) {
    for (const raw of selectedOptions) {
      const code = String(raw).toUpperCase();
      const round = rounds.find((r) => r.code === code);
      if (!round) continue;
      enabled.set(round.code, {
        from: hm(round.windowStart ?? round.time, round.time),
        to: hm(round.windowEnd ?? round.time, round.time),
        roundCode: round.code,
      });
    }
  }

  return catalogue.map((defaults) => {
    const pick = enabled.get(defaults.slotCode);
    return {
      slotCode: defaults.slotCode,
      daysOfWeek: defaults.daysOfWeek,
      plannedStartTime: pick?.from ?? defaults.plannedStartTime,
      plannedEndTime: pick?.to ?? defaults.plannedEndTime,
      requiredCarers: numberOfCarers,
      isEnabled: Boolean(pick),
      medicationRoundCode: pick?.roundCode ?? defaults.medicationRoundCode,
      sortOrder: defaults.sortOrder,
    };
  });
}
