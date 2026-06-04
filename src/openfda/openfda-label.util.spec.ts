import {
  buildOpenFdaDrugLabelSearchQuery,
  dedupeOpenFdaHits,
  escapeOpenFdaSearchTerm,
  mapOpenFdaLabelResult,
} from './openfda-label.util';

describe('openfda-label.util', () => {
  it('escapes lucene special characters', () => {
    expect(escapeOpenFdaSearchTerm('foo+bar')).toBe('foo\\+bar');
  });

  it('builds brand/generic/substance search with OR', () => {
    expect(buildOpenFdaDrugLabelSearchQuery('aspirin')).toBe(
      'openfda.brand_name:aspirin* OR openfda.generic_name:aspirin* OR openfda.substance_name:aspirin*',
    );
  });

  it('maps label rows with route and dose hints', () => {
    const hit = mapOpenFdaLabelResult(
      {
        id: 'abc',
        openfda: {
          brand_name: ['Low Dose Aspirin'],
          generic_name: ['ASPIRIN'],
          route: ['ORAL'],
        },
        purpose: ['Pain reliever'],
        active_ingredient: ['Active ingredient (in each tablet) Aspirin 81 mg (NSAID)'],
      },
      0,
    );
    expect(hit?.displayName).toBe('Low Dose Aspirin');
    expect(hit?.routes).toEqual(['ORAL']);
    expect(hit?.doseHint).toBe('81 mg');
    expect(hit?.dosageFormHint).toBe('TABLET');
    expect(hit?.purpose).toBe('Pain reliever');
  });

  it('dedupes by display name', () => {
    const a = mapOpenFdaLabelResult(
      { id: '1', openfda: { brand_name: ['Aspirin'], generic_name: ['ASPIRIN'] } },
      0,
    )!;
    const b = mapOpenFdaLabelResult(
      { id: '2', openfda: { brand_name: ['Aspirin'], generic_name: ['ASPIRIN'] } },
      1,
    )!;
    expect(dedupeOpenFdaHits([a, b])).toHaveLength(1);
  });
});
