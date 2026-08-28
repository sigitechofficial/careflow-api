import type { CarePlanFieldProvenance, ComposePlanResult } from './compose-context.types';
import {
  isSuggestionGatedComposeMode,
  mergeProvenanceIntoComposedFrom,
  normalizeComposePlanResult,
  readComposedFromFieldProvenance,
} from './compose-provenance.util';

const sampleProvenance: CarePlanFieldProvenance = {
  sourceType: 'INITIAL_ASSESSMENT',
  submissionId: 'ia-1',
  acceptedAt: '2026-08-24T12:00:00.000Z',
  originalValue: 'Yes',
  sourceDate: '2026-08-20T10:00:00.000Z',
  autoPrefilled: true,
};

describe('compose-provenance.util', () => {
  it('normalizeComposePlanResult ensures empty provenance object', () => {
    const base: ComposePlanResult = {
      values: {},
      fieldSources: {},
      gaps: [],
      evidence: [],
      composedFrom: { mapping: 'generic' },
    };
    expect(normalizeComposePlanResult(base).provenance).toEqual({});
  });

  it('mergeProvenanceIntoComposedFrom merges into fieldProvenance', () => {
    const merged = mergeProvenanceIntoComposedFrom(
      { mapping: 'test', fieldProvenance: { 'sec:f1': sampleProvenance } },
      { 'sec:f2': { ...sampleProvenance, originalValue: 'No' } },
    );
    expect(readComposedFromFieldProvenance(merged)).toEqual({
      'sec:f1': sampleProvenance,
      'sec:f2': { ...sampleProvenance, originalValue: 'No' },
    });
  });

  it('isSuggestionGatedComposeMode covers explicit and hybrid only', () => {
    expect(isSuggestionGatedComposeMode(undefined)).toBe(false);
    expect(isSuggestionGatedComposeMode('explicit')).toBe(true);
    expect(isSuggestionGatedComposeMode('hybrid')).toBe(true);
  });
});
