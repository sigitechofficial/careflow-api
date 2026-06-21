import { Transform } from 'class-transformer';

/** Parses repeated or comma-separated string query params into a deduped array. */
export function TransformStringArrayQuery() {
  return Transform(({ value }: { value: unknown }) => {
    if (value == null || value === '') return undefined;
    const parts = Array.isArray(value)
      ? value.flatMap((entry) => String(entry).split(','))
      : String(value).split(',');
    const items = [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
    return items.length ? items : undefined;
  });
}
