import type { CarePlanFieldProvenance, ComposePlanResult } from './compose-context.types';

export function readComposedFromFieldProvenance(
  composedFrom: Record<string, unknown> | null | undefined,
): Record<string, CarePlanFieldProvenance> {
  if (!composedFrom) return {};
  const raw = composedFrom.fieldProvenance;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, CarePlanFieldProvenance>;
}

/** Ensure compose responses always expose provenance (empty until hybrid mappers populate it). */
export function normalizeComposePlanResult(result: ComposePlanResult): ComposePlanResult {
  return {
    ...result,
    provenance: result.provenance ?? {},
  };
}

/** Merge top-level compose provenance into composedFrom.fieldProvenance for draft persistence. */
export function mergeProvenanceIntoComposedFrom(
  composedFrom: Record<string, unknown>,
  provenance: Record<string, CarePlanFieldProvenance>,
): Record<string, unknown> {
  if (!Object.keys(provenance).length) return composedFrom;
  const existing = readComposedFromFieldProvenance(composedFrom);
  return {
    ...composedFrom,
    fieldProvenance: { ...existing, ...provenance },
  };
}

export function isSuggestionGatedComposeMode(
  suggestionMode: ComposePlanResult['suggestionMode'],
): boolean {
  return suggestionMode === 'explicit' || suggestionMode === 'hybrid';
}
