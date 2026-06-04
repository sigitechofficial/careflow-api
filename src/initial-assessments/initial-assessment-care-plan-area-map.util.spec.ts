import {
  carePlanFormNameForArea,
  resolveCarePlanFormFromCatalogue,
} from './initial-assessment-care-plan-area-map.util';

describe('initial-assessment-care-plan-area-map', () => {
  const catalogue = [
    { id: '1', name: 'Eating and Drinking' },
    { id: '2', name: 'Personal Safety' },
    { id: '3', name: 'Person Centred care plan' },
  ];

  it('maps Nutrition to Eating and Drinking', () => {
    expect(carePlanFormNameForArea('Nutrition')).toBe('Eating and Drinking');
    expect(resolveCarePlanFormFromCatalogue(catalogue, 'Nutrition')?.id).toBe('1');
  });

  it('maps Environment to Personal Safety', () => {
    expect(carePlanFormNameForArea('Environment')).toBe('Personal Safety');
    expect(resolveCarePlanFormFromCatalogue(catalogue, 'Environment')?.id).toBe('2');
  });
});
