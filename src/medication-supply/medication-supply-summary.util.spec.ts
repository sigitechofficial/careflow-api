import { dedupeMedicationsByName } from './medication-supply-summary.util';

describe('dedupeMedicationsByName', () => {
  it('keeps one row per medication name preferring MAR events then deliveries', () => {
    const meds = dedupeMedicationsByName([
      {
        id: 'old-with-events',
        medicationName: 'Atorvastatin — 2× daily (demo)',
        createdAt: new Date('2026-05-01'),
        supplyDeliveries: [],
        _count: { events: 14, supplyDeliveries: 0 },
      },
      {
        id: 'new-with-delivery',
        medicationName: 'Atorvastatin — 2× daily (demo)',
        createdAt: new Date('2026-05-02'),
        supplyDeliveries: [{ id: 'd1' }],
        _count: { events: 0, supplyDeliveries: 1 },
      },
      {
        id: 'para',
        medicationName: 'Paracetamol — 5× daily (demo)',
        createdAt: new Date('2026-05-01'),
        supplyDeliveries: [{ id: 'd2' }],
      },
    ]);

    expect(meds.map(m => m.id)).toEqual(['old-with-events', 'para']);
  });
});
