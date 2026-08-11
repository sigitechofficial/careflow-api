/** Pin shape stored on observation payload and returned on GET (API-13/14). */
import { normalizeBodyMapPinCoordinates } from './body-map/body-map-pin-coordinates.util';

export type EmployeeAppBodyMapPin = {
  view: string;
  x: number;
  y: number;
  part: string;
  canvasView?: string;
  recordView?: string;
};

function normalizePin(raw: unknown): EmployeeAppBodyMapPin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const view = typeof o.view === 'string' ? o.view.trim() : '';
  const part = typeof o.part === 'string' ? o.part.trim() : '';
  const x = typeof o.x === 'number' ? o.x : Number(o.x);
  const y = typeof o.y === 'number' ? o.y : Number(o.y);
  if (!view || !part || Number.isNaN(x) || Number.isNaN(y)) return null;
  const coords = normalizeBodyMapPinCoordinates({
    recordView: typeof o.recordView === 'string' ? o.recordView : undefined,
    canvasView: typeof o.canvasView === 'string' ? o.canvasView : view,
    view,
    x,
    y,
  });
  const pin: EmployeeAppBodyMapPin = {
    view: coords.canvasView,
    x: coords.x,
    y: coords.y,
    part,
    canvasView: coords.canvasView,
    recordView: coords.recordView,
  };
  return pin;
}

/** Read pins from observation payload (mobile contract: payload.bodyMapPins). */
export function extractBodyMapPinsFromPayload(payload: unknown): EmployeeAppBodyMapPin[] | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const direct = p.bodyMapPins;
  if (Array.isArray(direct)) {
    const pins = direct.map(normalizePin).filter((x): x is EmployeeAppBodyMapPin => x != null);
    return pins.length > 0 ? pins : null;
  }
  const fields = p.fields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const bm = (fields as Record<string, unknown>).body_map;
    if (Array.isArray(bm)) {
      const pins = bm.map(normalizePin).filter((x): x is EmployeeAppBodyMapPin => x != null);
      return pins.length > 0 ? pins : null;
    }
  }
  return null;
}

export function observationPayloadMatchesJob(
  payload: unknown,
  scheduledJobId: string,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return true;
  const jobId = (payload as Record<string, unknown>).scheduledJobId;
  if (jobId == null || jobId === '') return true;
  return String(jobId) === scheduledJobId;
}
