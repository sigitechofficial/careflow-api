import type {
  CarePlanComposeContext,
  CarePlanFieldSuggestion,
  CarePlanFormFieldRef,
  CarePlanSuggestionSourceQuestion,
  ComposeEvidenceItem,
  ComposePlanResult,
} from './compose-context.types';
import { mergeProvenanceIntoComposedFrom } from './compose-provenance.util';
import {
  CRS_SUGGESTION_MAPPINGS,
  crsTierManifestFromRegistry,
  type CrsSuggestionParts,
} from './culture-religion-care-plan-field-mappings';
import { iaRoute, normalizeFieldLabel } from './compose-routes.util';
import { sanitizeHomeSupportPlanComposeOutput } from './compose-html-sanitize.util';

export const CULTURE_RELIGION_CARE_PLAN_FORM_NAME = 'Culture/Religion/Spirituality';

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
  return `crs:${fnv1a(
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
  parts: CrsSuggestionParts;
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
 * Culture/Religion/Spirituality compose — suggestions only.
 *
 * The IA audit approved five mappings, all from IA §1.1 / §1.3b / §1.6 / §1.7 (faith,
 * culture, observance, dietary, staff gender preference). Religion and belief are
 * special-category data, so nothing auto-prefills: every suggestion is surfaced for a
 * staff member to review, and the generic Care 2020 needs / goals / support / risk
 * block is deliberately manual with reasons recorded in the registry.
 */
export function composeCultureReligionCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  const composedAt = new Date().toISOString();
  const suggestions: CarePlanFieldSuggestion[] = [];

  if (ctx.ia) {
    for (const mapping of CRS_SUGGESTION_MAPPINGS) {
      const field = fieldByBusinessKey(fields, mapping.businessKey);
      if (!field) continue;

      const parts = mapping.resolve(ctx);
      if (!parts) continue;

      suggestions.push(buildSuggestion({ field, ia: ctx.ia, parts }));
    }
  }

  const composedFrom = mergeProvenanceIntoComposedFrom(
    {
      formName: CULTURE_RELIGION_CARE_PLAN_FORM_NAME,
      mapping: 'culture-religion-care-plan-suggestions',
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      iaStatus: ctx.ia?.status ?? null,
      composedAt,
      tierManifest: crsTierManifestFromRegistry(),
    },
    {},
  );

  return sanitizeHomeSupportPlanComposeOutput({
    // No auto-prefill on this form: compose never writes a value into the draft.
    values: {},
    fieldSources: {},
    provenance: {},
    gaps: [],
    evidence: baseEvidence(ctx, serviceUserId),
    suggestionMode: 'hybrid',
    suggestions,
    previousAssessments: [],
    iaStatus: ctx.ia?.status ?? null,
    composedFrom,
  });
}
