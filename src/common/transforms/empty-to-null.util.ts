/** Normalise optional UUID / string fields from JSON forms ("" → undefined). */
export function emptyToUndefined(value: unknown): unknown {
  if (value === '') return undefined;
  return value;
}

/** Normalise optional UUID fields on PATCH ("" → null for explicit clear). */
export function emptyToNull(value: unknown): unknown {
  if (value === '') return null;
  return value;
}
