/** Shared canvas pin numbering — admin BodyMapCanvas + mobile use the same sequence. */

type NumberableRecord = {
  id: string;
  firstNoticedAt: string | null;
  createdAt: string;
  recordType?: string;
  markers: Array<{ status?: string | null }>;
};

export function assignBodyMapCanvasDisplayNumbers<T extends NumberableRecord>(
  records: T[],
  options?: { includeMedication?: boolean },
): Array<T & { canvasDisplayNumber: number | null }> {
  const includeMedication = options?.includeMedication ?? true;
  const visible = records
    .filter((r) => {
      const marker = r.markers[0];
      if (!marker) return false;
      if (!includeMedication && r.recordType === 'MEDICATION') return false;
      const st = marker.status;
      if (st === 'CLOSED' || st === 'RESOLVED') return false;
      return true;
    })
    .sort(
      (a, b) =>
        new Date(a.firstNoticedAt ?? a.createdAt).getTime() -
        new Date(b.firstNoticedAt ?? b.createdAt).getTime(),
    );

  const numberById = new Map(visible.map((r, index) => [r.id, index + 1]));
  return records.map((r) => ({
    ...r,
    canvasDisplayNumber: numberById.get(r.id) ?? null,
  }));
}

export function assignObservationPinDisplayNumbers<
  T extends { observationId?: string; recordedAt?: string },
>(
  pins: T[],
  chartMaxNumber: number,
): Array<T & { displayNumber: number }> {
  const sorted = [...pins].sort((a, b) => {
    const ta = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
    const tb = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
    return ta - tb;
  });
  return sorted.map((pin, index) => ({
    ...pin,
    displayNumber: chartMaxNumber + index + 1,
  }));
}
