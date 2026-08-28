import type {
  CarePlanComposeContext,
  CarePlanFieldProvenance,
  CarePlanFieldSuggestion,
  CarePlanFormFieldRef,
  CarePlanSuggestionSourceQuestion,
  ComposeEvidenceItem,
  ComposeFieldResult,
  ComposePlanResult,
} from './compose-context.types';
import { mergeProvenanceIntoComposedFrom } from './compose-provenance.util';
import {
  HCP_AUTO_PREFILL_MAPPINGS,
  HCP_SUGGESTION_MAPPINGS,
  hcpTierManifestFromRegistry,
  type HcpSuggestionParts,
} from './home-care-plan-field-mappings';
import { iaRoute, normalizeFieldLabel } from './compose-routes.util';
import { sanitizeHomeSupportPlanComposeOutput } from './compose-html-sanitize.util';

export const HOME_CARE_PLAN_FORM_NAME = 'Home Care Plan';

function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function fieldByBusinessKey(
  fields: CarePlanFormFieldRef[],
  businessKey: string,
): CarePlanFormFieldRef | undefined {
  return fields.find((field) => field.fieldKey === businessKey);
}

function suggestionId(
  targetLabel: string,
  submissionId: string,
  suggestedValue: string | boolean | null,
  questionIds: string[],
): string {
  return `hcp:${fnv1a(
    `${normalizeFieldLabel(targetLabel)}|${submissionId}|${String(suggestedValue)}|${questionIds.join(',')}`,
  )}`;
}

function flattenSource(sources: CarePlanSuggestionSourceQuestion[]) {
  const first = sources[0];
  if (!first) return {};
  return {
    questionId: first.questionId,
    questionFieldKey: first.questionFieldKey,
    specRef: first.specRef,
    sourceSection: first.sourceSection,
    sourceLabel: first.sourceLabel,
    sourceValue: first.sourceValue,
  };
}

function buildSuggestion(params: {
  field: CarePlanFormFieldRef;
  ia: NonNullable<CarePlanComposeContext['ia']>;
  parts: HcpSuggestionParts;
}): CarePlanFieldSuggestion {
  const { field, ia, parts } = params;
  const { suggestedValue, displayText, sources } = parts;
  return {
    id: suggestionId(
      field.label,
      ia.submissionId,
      suggestedValue,
      sources.map((source) => source.questionId),
    ),
    kind: 'value',
    targetFieldKey: field.key,
    targetLabel: field.label,
    targetFieldType: field.fieldType,
    suggestedValue,
    displayText,
    sourceType: 'INITIAL_ASSESSMENT',
    submissionId: ia.submissionId,
    sourceDate: ia.submittedAt,
    sourceQuestions: sources,
    transform: 'narrative',
    ...flattenSource(sources),
  };
}

function buildAutoPrefillProvenance(params: {
  ia: NonNullable<CarePlanComposeContext['ia']>;
  value: string | boolean;
  sources: CarePlanSuggestionSourceQuestion[];
  composedAt: string;
}): CarePlanFieldProvenance {
  const { ia, value, sources, composedAt } = params;
  return {
    sourceType: 'INITIAL_ASSESSMENT',
    submissionId: ia.submissionId,
    questionId: sources[0]?.questionId,
    sourceQuestions: sources,
    acceptedAt: composedAt,
    acceptedById: null,
    originalValue: value,
    sourceDate: ia.submittedAt,
    userEdited: false,
    autoPrefilled: true,
  };
}

function baseEvidence(ctx: CarePlanComposeContext, serviceUserId: string): ComposeEvidenceItem[] {
  return ctx.ia
    ? [
        {
          id: 'ia-submission',
          source: 'ia',
          label: 'Initial Assessment',
          value: ctx.ia.submittedAt
            ? `Submitted ${ctx.ia.submittedAt.slice(0, 10)}`
            : 'Submitted assessment on file',
          route: iaRoute(serviceUserId),
        },
      ]
    : [];
}

/**
 * Home Care Plan compose — hybrid, mirroring the Home Support Plan contract.
 *
 * Administrative fields auto-prefill; every clinical mapping is emitted as a suggestion
 * so a clinician confirms it before it enters the record. Fields marked MANUAL in the
 * registry are never touched here.
 */
export function composeHomeCarePlanHybrid(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  const composedAt = new Date().toISOString();
  const values: Record<string, string | boolean> = {};
  const fieldSources: Record<string, ComposeFieldResult['source']> = {};
  const provenance: Record<string, CarePlanFieldProvenance> = {};
  const suggestions: CarePlanFieldSuggestion[] = [];

  if (ctx.ia) {
    for (const mapping of HCP_AUTO_PREFILL_MAPPINGS) {
      const field = fieldByBusinessKey(fields, mapping.businessKey);
      if (!field) continue;

      const resolved = mapping.resolve(ctx);
      if (!resolved) continue;

      values[field.key] = resolved.value;
      fieldSources[field.key] = 'ia';
      provenance[field.key] = buildAutoPrefillProvenance({
        ia: ctx.ia,
        value: resolved.value,
        sources: resolved.sources,
        composedAt,
      });
    }

    for (const mapping of HCP_SUGGESTION_MAPPINGS) {
      const field = fieldByBusinessKey(fields, mapping.businessKey);
      if (!field) continue;

      const parts = mapping.resolve(ctx);
      if (!parts) continue;

      suggestions.push(buildSuggestion({ field, ia: ctx.ia, parts }));
    }
  }

  const composedFrom = mergeProvenanceIntoComposedFrom(
    {
      formName: HOME_CARE_PLAN_FORM_NAME,
      mapping: 'home-care-plan-hybrid',
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      iaStatus: ctx.ia?.status ?? null,
      composedAt,
      tierManifest: hcpTierManifestFromRegistry(),
    },
    provenance,
  );

  return sanitizeHomeSupportPlanComposeOutput({
    values,
    fieldSources,
    provenance,
    gaps: [],
    evidence: baseEvidence(ctx, serviceUserId),
    suggestionMode: 'hybrid',
    suggestions,
    previousAssessments: [],
    iaStatus: ctx.ia?.status ?? null,
    composedFrom,
  });
}
