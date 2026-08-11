/**
 * Shared pin coordinate rules — keep in sync with care-admin body-map-marker-position.util.ts
 */
export function normalizeBodyMapPinCoordinates(input: {
  recordView?: string | null;
  canvasView?: string | null;
  view?: string | null;
  x: number;
  y: number;
}): { recordView: string; canvasView: string; x: number; y: number } {
  const viewHint = (input.view ?? '').trim().toLowerCase();
  let canvasView = (input.canvasView ?? viewHint ?? 'dual').trim().toLowerCase();
  let recordView = (input.recordView ?? '').trim().toLowerCase();
  let x = input.x;
  const y = input.y;

  if (!recordView) {
    if (viewHint === 'front' || viewHint === 'back') recordView = viewHint;
    else if (viewHint === 'dual' || viewHint === '') recordView = x <= 50 ? 'front' : 'back';
    else recordView = viewHint;
  }

  if (canvasView === 'dual') {
    if (recordView === 'face' || recordView === 'head' || recordView === 'forehead') {
      recordView = 'front';
    } else if (recordView === 'head_back' || recordView === 'occiput') {
      recordView = 'back';
    }
  }

  if (canvasView === 'dual' && recordView === 'dual') {
    if (x <= 50) {
      recordView = 'front';
      x = Math.round((x / 50) * 1000) / 10;
    } else {
      recordView = 'back';
      x = Math.round(((x - 50) / 50) * 1000) / 10;
    }
  }

  if ((recordView === 'front' || recordView === 'back') && canvasView !== 'dual') {
    canvasView = 'dual';
  }

  return { recordView, canvasView, x, y };
}
