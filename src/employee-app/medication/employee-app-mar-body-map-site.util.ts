import type { BodyMapSide } from '@prisma/client';
import { bodyMapRecordToMobileMarker } from '../body-map/employee-app-body-map-records.util';

export type MarBodyMapSite = {
  recordId: string;
  bodyPart: string;
  side: string | null;
  applyOn: string;
  subType: string | null;
  x: number | null;
  y: number | null;
  recordView: string | null;
  canvasView: string | null;
};

type SiteRow = {
  serviceUserMedicationId: string;
  bodyMapRecord: {
    id: string;
    subType: string | null;
    observationDetails?: unknown;
    markers: Array<{
      bodyView: string;
      bodyPart: string;
      side: BodyMapSide | null;
      specificLocation: string | null;
      xCoordinate: unknown;
      yCoordinate: unknown;
    }>;
  };
};

function titleCaseSide(side: BodyMapSide | string | null | undefined): string | null {
  if (!side) return null;
  const raw = String(side).trim().toLowerCase();
  if (raw === 'left') return 'Left';
  if (raw === 'right') return 'Right';
  if (raw === 'centre' || raw === 'center') return 'Centre';
  return String(side).trim() || null;
}

export function formatMarApplyOn(input: {
  bodyPart?: string | null;
  side?: BodyMapSide | string | null;
  specificLocation?: string | null;
}): string | null {
  const part = input.bodyPart?.trim() || '';
  const side = titleCaseSide(input.side);
  const note = input.specificLocation?.trim() || '';
  if (side && part) {
    if (part.toLowerCase().includes(side.toLowerCase())) return part;
    return `${side} ${part.charAt(0).toLowerCase()}${part.slice(1)}`;
  }
  if (part) return part;
  if (note) return note;
  return null;
}

export function indexMarBodyMapSites(rows: SiteRow[]): Map<string, MarBodyMapSite> {
  const map = new Map<string, MarBodyMapSite>();
  for (const row of rows) {
    if (map.has(row.serviceUserMedicationId)) continue;
    const marker = row.bodyMapRecord.markers[0];
    const applyOn = formatMarApplyOn({
      bodyPart: marker?.bodyPart,
      side: marker?.side,
      specificLocation: marker?.specificLocation,
    });
    if (!applyOn) continue;
    const pin = bodyMapRecordToMobileMarker({
      id: row.bodyMapRecord.id,
      markers: (row.bodyMapRecord.markers ?? []).map((m) => ({
        bodyView: m.bodyView,
        side: m.side,
        bodyPart: m.bodyPart,
        specificLocation: m.specificLocation,
        xCoordinate: Number(m.xCoordinate),
        yCoordinate: Number(m.yCoordinate),
      })),
      observationDetails: row.bodyMapRecord.observationDetails,
    });
    map.set(row.serviceUserMedicationId, {
      recordId: row.bodyMapRecord.id,
      bodyPart: marker?.bodyPart?.trim() || applyOn,
      side: titleCaseSide(marker?.side),
      applyOn,
      subType: row.bodyMapRecord.subType?.trim() || null,
      x: pin?.x ?? null,
      y: pin?.y ?? null,
      recordView: pin?.recordView ?? null,
      canvasView: pin?.canvasView ?? null,
    });
  }
  return map;
}
