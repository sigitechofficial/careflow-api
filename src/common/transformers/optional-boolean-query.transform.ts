import { Transform } from 'class-transformer';

/** Parses query/body booleans, including the string `"false"` (which `Boolean("false")` would treat as true). */
export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return parseOptionalBoolean(value[value.length - 1]);
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return undefined;
}

/**
 * Query-string boolean that survives ValidationPipe `enableImplicitConversion`.
 * Implicit `Boolean("false")` is true, so this reads the raw param from the source object.
 */
export function TransformOptionalBooleanQuery() {
  return Transform(({ obj, key, value }: { obj?: Record<string, unknown>; key: string; value: unknown }) => {
    const raw = obj != null && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : value;
    return parseOptionalBoolean(raw);
  });
}
