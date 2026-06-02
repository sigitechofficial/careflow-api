import { Prisma } from '@prisma/client';
import { DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS } from '../../prisma/seed-data/medication-administration-rounds.defaults';

type VisitSlotRow = { selected?: boolean; from?: string; to?: string; roundName?: string };

const LEGACY_SLOT_TO_ROUND_CODE: Record<string, string> = {
  early_morning: 'MORNING',
  morning: 'MORNING',
  lunch_time: 'MIDDAY',
  afternoon: 'AFTERNOON',
  early_evening: 'EVENING',
  night: 'NIGHT',
};

function hm(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m?.[1] || !m[2]) return undefined;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function normalizeSlotKey(key: string): string {
  const upper = key.toUpperCase();
  if (DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS.some((r) => r.code === upper)) return upper;
  return LEGACY_SLOT_TO_ROUND_CODE[key.toLowerCase()] ?? key;
}

function roundByCode(code: string) {
  return DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS.find((r) => r.code === code);
}

export function isPreferredVisitTimesFieldKey(metadata: Prisma.JsonValue): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const fieldKey = (metadata as { fieldKey?: string }).fieldKey;
  return fieldKey === 'preferredVisitTimes';
}

export function formatPreferredVisitTimesForExport(
  selectedOptions: Prisma.JsonValue,
  _options: Prisma.JsonValue,
): string | null {
  if (!selectedOptions) return null;

  const parts: string[] = [];

  if (Array.isArray(selectedOptions)) {
    for (const value of selectedOptions) {
      const code = normalizeSlotKey(String(value));
      const round = roundByCode(code);
      parts.push(round?.name ?? String(value));
    }
    return parts.length ? parts.join('; ') : null;
  }

  if (typeof selectedOptions === 'object') {
    const ordered = [...DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const round of ordered) {
      const entry = (selectedOptions as Record<string, VisitSlotRow>)[round.code];
      if (!entry?.selected) {
        const legacy = (selectedOptions as Record<string, VisitSlotRow>)[
          Object.entries(LEGACY_SLOT_TO_ROUND_CODE).find(([, c]) => c === round.code)?.[0] ?? ''
        ];
        if (!legacy?.selected) continue;
        const from = legacy.from?.trim() || hm(round.windowStart);
        const to = legacy.to?.trim() || hm(round.windowEnd);
        const name = legacy.roundName?.trim() || round.name;
        if (from && to) parts.push(`${name} (${from}–${to})`);
        else parts.push(name);
        continue;
      }
      const from = entry.from?.trim() || hm(round.windowStart);
      const to = entry.to?.trim() || hm(round.windowEnd);
      const name = entry.roundName?.trim() || round.name;
      if (from && to) parts.push(`${name} (${from}–${to})`);
      else parts.push(name);
    }
    for (const [key, entry] of Object.entries(selectedOptions as Record<string, VisitSlotRow>)) {
      if (key.toUpperCase() === 'FLEXIBLE' && entry?.selected) {
        parts.push(entry.roundName?.trim() || 'Flexible');
      }
    }
    return parts.length ? parts.join('; ') : null;
  }

  if (typeof selectedOptions === 'string' && selectedOptions.trim()) {
    const round = roundByCode(normalizeSlotKey(selectedOptions.trim()));
    return round?.name ?? selectedOptions.trim();
  }

  return null;
}

export function preferredVisitTimesIsAnswered(selectedOptions: Prisma.JsonValue): boolean {
  if (!selectedOptions) return false;
  if (Array.isArray(selectedOptions)) return selectedOptions.length > 0;
  if (typeof selectedOptions === 'string') return selectedOptions.length > 0;
  if (typeof selectedOptions === 'object') {
    return Object.values(selectedOptions as Record<string, VisitSlotRow>).some((row) => row?.selected === true);
  }
  return false;
}
