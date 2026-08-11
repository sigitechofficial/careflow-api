import { normalizeBodyMapPinCoordinates } from './body-map-pin-coordinates.util';

describe('body-map-pin-coordinates.util', () => {
  it('maps face + dual to front figure with half-width scaling path', () => {
    const n = normalizeBodyMapPinCoordinates({
      recordView: 'face',
      canvasView: 'dual',
      x: 78.8,
      y: 6.1,
    });
    expect(n.recordView).toBe('front');
    expect(n.canvasView).toBe('dual');
    expect(n.x).toBe(78.8);
  });

  it('splits full-widget dual coordinates', () => {
    const n = normalizeBodyMapPinCoordinates({
      view: 'dual',
      recordView: 'dual',
      canvasView: 'dual',
      x: 25,
      y: 10,
    });
    expect(n.recordView).toBe('front');
    expect(n.x).toBe(50);
  });
});
