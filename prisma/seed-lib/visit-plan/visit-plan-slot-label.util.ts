/** Deploy-safe copy for persona schedule seeding (no imports from src/). */

const LEGACY_VISIT_SLOT_TO_ROUND: Record<string, string> = {
  LUNCH: 'MIDDAY',
  TEA: 'AFTERNOON',
};

export function slotLabel(code: string, roundNameByCode?: Map<string, string>): string {
  const upper = code.trim().toUpperCase();
  const normalized = LEGACY_VISIT_SLOT_TO_ROUND[upper] ?? upper;
  return roundNameByCode?.get(normalized) ?? roundNameByCode?.get(code) ?? code;
}
