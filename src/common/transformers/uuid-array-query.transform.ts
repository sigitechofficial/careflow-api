import { Transform } from 'class-transformer';

/** Parses repeated or comma-separated UUID query params into a deduped array. */
export function TransformUuidArrayQuery() {
  return Transform(({ value }: { value: unknown }) => {
    if (value == null || value === '') return undefined;
    const parts = Array.isArray(value)
      ? value.flatMap((entry) => String(entry).split(','))
      : String(value).split(',');
    const ids = [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
    return ids.length ? ids : undefined;
  });
}
