/** Normalize chart records for mobile canvas — admin + carer app share the same pin shape. */

import { normalizeBodyMapPinCoordinates } from './body-map-pin-coordinates.util';
import { assignObservationPinDisplayNumbers } from '../../body-map/body-map-canvas-display-numbers.util';

export type BodyMapMobileMarker = {
  recordView: string;
  canvasView: string;
  x: number;
  y: number;
  bodyPart: string;
  side: string | null;
  regionId: string | null;
  summaryLabel: string | null;
  source: 'admin' | 'employee_app' | 'unknown';
  /** Same numbered circle as admin canvas (1…n across active client chart). */
  canvasDisplayNumber: number | null;
};

type MarkerLike = {
  bodyView: string;
  side: string | null;
  bodyPart: string;
  specificLocation: string | null;
  xCoordinate: number;
  yCoordinate: number;
};

type RecordLike = {
  id: string;
  markers: MarkerLike[];
  observationDetails: unknown;
  scheduledJobId?: string | null;
  firstNoticedAt?: string | null;
  createdAt?: string;
  canvasDisplayNumber?: number | null;
};

function readObs(observationDetails: unknown): Record<string, unknown> | null {
  if (!observationDetails || typeof observationDetails !== 'object' || Array.isArray(observationDetails)) {
    return null;
  }
  return observationDetails as Record<string, unknown>;
}

export function apiBodyViewToRecordView(bodyView: string): string {
  switch (bodyView) {
    case 'BACK':
      return 'back';
    case 'FACE':
      return 'face';
    case 'LEFT':
      return 'arm_l';
    case 'RIGHT':
      return 'arm_r';
    case 'HAND':
      return 'hand_l';
    case 'FOOT':
      return 'foot_l';
    default:
      return 'front';
  }
}

function apiSideToMobile(side: string | null | undefined): string | null {
  if (side === 'LEFT') return 'Left';
  if (side === 'RIGHT') return 'Right';
  if (side === 'CENTRE') return 'Centre';
  return null;
}

function resolveSource(obs: Record<string, unknown> | null): BodyMapMobileMarker['source'] {
  const channel = obs?.channel;
  if (channel === 'employee_app') return 'employee_app';
  if (channel === 'admin') return 'admin';
  return 'unknown';
}

/** Derive mobile canvas placement from a chart record (admin or carer). */
export function bodyMapRecordToMobileMarker(record: RecordLike): BodyMapMobileMarker | null {
  const marker = record.markers[0];
  if (!marker) return null;

  const obs = readObs(record.observationDetails);
  const rawRecordView =
    (typeof obs?.recordView === 'string' && obs.recordView.trim()) ||
    apiBodyViewToRecordView(marker.bodyView);
  const rawCanvasView =
    (typeof obs?.canvasView === 'string' && obs.canvasView.trim()) ||
    (rawRecordView === 'front' || rawRecordView === 'back' ? 'dual' : rawRecordView);
  const normalized = normalizeBodyMapPinCoordinates({
    recordView: rawRecordView,
    canvasView: rawCanvasView,
    x: marker.xCoordinate,
    y: marker.yCoordinate,
  });

  return {
    recordView: normalized.recordView,
    canvasView: normalized.canvasView,
    x: normalized.x,
    y: normalized.y,
    bodyPart: marker.bodyPart,
    side: apiSideToMobile(marker.side),
    regionId: typeof obs?.regionId === 'string' && obs.regionId.trim() ? obs.regionId.trim() : null,
    summaryLabel: marker.specificLocation?.trim() || null,
    source: resolveSource(obs),
    canvasDisplayNumber: record.canvasDisplayNumber ?? null,
  };
}

export function enrichBodyMapRecordForMobile<T extends RecordLike>(record: T) {
  return {
    ...record,
    mobileMarker: bodyMapRecordToMobileMarker(record),
  };
}

export type BodyMapObservationPinForMobile = {
  observationId: string;
  observationTitle: string;
  recordedAt?: string;
  view: string;
  x: number;
  y: number;
  part: string;
  canvasView?: string;
  recordView?: string;
  displayNumber: number;
};

export function flattenObservationBodyMapPins(
  rows: Array<{
    id: string;
    title: string;
    recordedAt?: string;
    bodyMapPins?: Array<{
      view: string;
      x: number;
      y: number;
      part: string;
      canvasView?: string;
      recordView?: string;
    }> | null;
  }>,
  chartMaxNumber = 0,
): BodyMapObservationPinForMobile[] {
  const flat: Array<Omit<BodyMapObservationPinForMobile, 'displayNumber'>> = [];
  for (const row of rows) {
    if (!row.bodyMapPins?.length) continue;
    for (const pin of row.bodyMapPins) {
      flat.push({
        observationId: row.id,
        observationTitle: row.title,
        recordedAt: row.recordedAt,
        view: pin.view,
        x: pin.x,
        y: pin.y,
        part: pin.part,
        ...(pin.canvasView ? { canvasView: pin.canvasView } : {}),
        ...(pin.recordView ? { recordView: pin.recordView } : {}),
      });
    }
  }
  return assignObservationPinDisplayNumbers(flat, chartMaxNumber);
}
