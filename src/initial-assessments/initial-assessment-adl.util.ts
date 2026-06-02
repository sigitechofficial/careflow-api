/** ADL worksheet activity ids (paper §7 / enterprise spec §12.2–12.5). Keep in sync with care-admin adl-scoring.ts */

export const ADL_WORKSHEET_ACTIVITY_IDS = [
  'eating_drinking',
  'toileting',
  'walking',
  'dressing_undressing',
  'bathing',
  'grooming',
  'preparing_food',
  'laundry',
  'housework',
  'shopping',
  'room_to_room',
  'turning_in_bed',
  'stairs',
  'lying_to_sitting',
  'chair_transfer',
  'toilet_transfer',
  'bed_transfer',
  'enter_leave_home',
  'public_transport',
  'short_walks',
  'long_walks',
] as const;

function isAdlScoreValid(score: unknown): score is number {
  return typeof score === 'number' && !Number.isNaN(score) && score >= 0 && score <= 4;
}

export function adlWorksheetRowsComplete(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const adl = (metadata as Record<string, unknown>).adl;
  if (!adl || typeof adl !== 'object' || Array.isArray(adl)) return false;
  const rows = (adl as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return false;

  return ADL_WORKSHEET_ACTIVITY_IDS.every((id) => {
    const row = rows.find(
      (r) =>
        r &&
        typeof r === 'object' &&
        !Array.isArray(r) &&
        (r as { id?: string }).id === id,
    ) as { score?: number } | undefined;
    return row != null && isAdlScoreValid(row.score);
  });
}

export function adlTotalFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const adl = (metadata as Record<string, unknown>).adl;
  if (!adl || typeof adl !== 'object' || Array.isArray(adl)) return null;
  const rows = (adl as { rows?: { score?: number }[] }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce((sum, r) => sum + (typeof r.score === 'number' ? r.score : 0), 0);
}

export function adlDependencyBand(total: number): string {
  if (total === 0) return 'Low support';
  if (total <= 15) return 'Low support';
  if (total <= 35) return 'Moderate support';
  if (total <= 55) return 'High support';
  return 'Very high support';
}
