import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
  ComposeEvidenceItem,
  ComposeFieldResult,
  ComposeGap,
  ComposePlanResult,
} from './compose-context.types';
import { normalizeFieldLabel } from './compose-routes.util';

export type LabelFieldMapping = {
  fieldLabel: string;
  required?: boolean;
  resolve: (ctx: CarePlanComposeContext) => ComposeFieldResult | null;
};

function fieldByLabel(fields: CarePlanFormFieldRef[], label: string): CarePlanFormFieldRef | undefined {
  const needle = normalizeFieldLabel(label);
  return fields.find((f) => normalizeFieldLabel(f.label) === needle);
}

function mergeEvidence(existing: ComposeEvidenceItem[], item: ComposeEvidenceItem): ComposeEvidenceItem[] {
  if (existing.some((e) => e.id === item.id)) return existing;
  return [...existing, item];
}

export function composeLabelMappedForm(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  mappings: LabelFieldMapping[],
  options: {
    serviceUserId: string;
    initialEvidence?: ComposeEvidenceItem[];
    extraGaps?: ComposeGap[];
    composedFrom?: Record<string, unknown>;
    gapSeverity?: (mapping: LabelFieldMapping, field: CarePlanFormFieldRef) => ComposeGap['severity'];
    fixesForField?: (label: string, serviceUserId: string) => ComposeGap['fixes'];
  },
): ComposePlanResult {
  const values: Record<string, string | boolean> = {};
  const fieldSources: Record<string, ComposeFieldResult['source']> = {};
  const gaps: ComposeGap[] = [];
  let evidence = options.initialEvidence ?? [];

  for (const mapping of mappings) {
    const field = fieldByLabel(fields, mapping.fieldLabel);
    if (!field) continue;

    const resolved = mapping.resolve(ctx);
    if (resolved?.value != null && resolved.value !== '') {
      values[field.key] = resolved.value;
      fieldSources[field.key] = resolved.source;
    } else if (mapping.required ?? field.required) {
      gaps.push({
        fieldKey: field.key,
        label: field.label,
        severity: options.gapSeverity?.(mapping, field) ?? 'warning',
        fixes: options.fixesForField?.(mapping.fieldLabel, options.serviceUserId) ?? [],
      });
    }
  }

  return {
    values,
    fieldSources,
    gaps: [...gaps, ...(options.extraGaps ?? [])],
    evidence,
    composedFrom: options.composedFrom ?? { composedAt: new Date().toISOString() },
  };
}

export { mergeEvidence, fieldByLabel };
