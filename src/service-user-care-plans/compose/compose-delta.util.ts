import type { CarePlanComposeDelta } from './compose-context.types';

function norm(value: string | boolean | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value).trim();
}

export function computeComposeDeltas(
  composed: Record<string, string | boolean>,
  published: Record<string, string | boolean> | null | undefined,
  fieldLabels: Record<string, string>,
): CarePlanComposeDelta[] {
  if (!published || Object.keys(published).length === 0) return [];

  const deltas: CarePlanComposeDelta[] = [];
  const keys = new Set([...Object.keys(composed), ...Object.keys(published)]);

  for (const fieldKey of keys) {
    const composedValue = composed[fieldKey] ?? null;
    const publishedValue = published[fieldKey] ?? null;
    if (norm(composedValue) === norm(publishedValue)) continue;
    if (norm(composedValue) === '' && norm(publishedValue) === '') continue;

    deltas.push({
      fieldKey,
      label: fieldLabels[fieldKey] ?? fieldKey,
      publishedValue,
      composedValue,
    });
  }

  return deltas.sort((a, b) => a.label.localeCompare(b.label));
}
