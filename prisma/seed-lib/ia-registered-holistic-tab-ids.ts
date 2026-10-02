/**
 * Registered holistic tab IDs — seed-safe (no Nest / src/ imports).
 *
 * Lives under prisma/ because `prisma db seed` runs as raw TS on the VPS from an artifact
 * that ships `prisma/` + `dist/` but NOT `src/`. App code re-exports these from
 * `src/dev-tools/dto/generate-ia-section.dto.ts`.
 *
 * Navigation order is independent (set in the admin); IDs stay frozen.
 * 21 = Infection, 22 = Fire Safety, 19 = PEEP, 20 = Bed Rails, 23 = Consent, 24 = Safeguarding & Emergency.
 * 18 (Photography Consent) is retired from the admin nav (folded into 23) but kept so old data/calls resolve.
 */
export const IA_REGISTERED_HOLISTIC_TAB_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
] as const;

export type IaRegisteredHolisticTabId = (typeof IA_REGISTERED_HOLISTIC_TAB_IDS)[number];

/** Number of registered holistic tabs (not a 1..N ID range). */
export const IA_HOLISTIC_TAB_COUNT = IA_REGISTERED_HOLISTIC_TAB_IDS.length;

export const IA_MAX_HOLISTIC_TAB_ID = Math.max(...IA_REGISTERED_HOLISTIC_TAB_IDS);

export function isRegisteredHolisticTabId(tabId: number): tabId is IaRegisteredHolisticTabId {
  return (IA_REGISTERED_HOLISTIC_TAB_IDS as readonly number[]).includes(tabId);
}
