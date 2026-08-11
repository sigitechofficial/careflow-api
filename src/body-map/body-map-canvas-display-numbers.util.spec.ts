import {
  assignBodyMapCanvasDisplayNumbers,
  assignObservationPinDisplayNumbers,
} from './body-map-canvas-display-numbers.util';

describe('body-map-canvas-display-numbers.util', () => {
  it('numbers active chart records by firstNoticedAt ascending', () => {
    const rows = assignBodyMapCanvasDisplayNumbers([
      {
        id: 'b',
        firstNoticedAt: '2026-08-11T12:00:00.000Z',
        createdAt: '2026-08-11T12:00:00.000Z',
        markers: [{ status: 'ACTIVE' }],
      },
      {
        id: 'a',
        firstNoticedAt: '2026-08-11T10:00:00.000Z',
        createdAt: '2026-08-11T10:00:00.000Z',
        markers: [{ status: 'ACTIVE' }],
      },
    ]);
    expect(rows.find((r) => r.id === 'a')?.canvasDisplayNumber).toBe(1);
    expect(rows.find((r) => r.id === 'b')?.canvasDisplayNumber).toBe(2);
  });

  it('continues observation pin numbers after chart max', () => {
    const obs = assignObservationPinDisplayNumbers(
      [
        { observationId: 'o2', recordedAt: '2026-08-11T12:00:00.000Z' },
        { observationId: 'o1', recordedAt: '2026-08-11T10:00:00.000Z' },
      ],
      3,
    );
    expect(obs.find((p) => p.observationId === 'o1')?.displayNumber).toBe(4);
    expect(obs.find((p) => p.observationId === 'o2')?.displayNumber).toBe(5);
  });
});
