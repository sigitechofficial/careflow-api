import type {
  CarePlanComposeContext,
  CarePlanSuggestionSourceQuestion,
} from './compose-context.types';
import {
  findIaAnswer,
  resolveIaDisplayValue,
  resolveIaNumberValue,
} from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

export {
  PAIN_AUTO_PREFILL_KEYS,
  PAIN_FIELD_REGISTRY,
  PAIN_MANUAL_KEYS,
  PAIN_SUGGESTION_KEYS,
  painFieldRegistryEntry,
  painTierManifestFromRegistry,
  assertPainRegistryMatchesTemplate,
} from './pain-management-care-plan-field-registry';
export type {
  PainFieldBusinessKey,
  PainFieldMappingMode,
  PainFieldRegistryEntry,
  PainFieldSourceKind,
  PainFieldSourceRef,
} from './pain-management-care-plan-field-registry';

export type PainSuggestionParts = {
  suggestedValue: string;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type PainSuggestionMapping = {
  businessKey: string;
  resolve: (ctx: CarePlanComposeContext) => PainSuggestionParts | null;
};

/**
 * IA §5.3 pain queries, verbatim from the seeded catalogue. The §5.3 questions carry no
 * fieldKey, so each is narrowed on question text (all distinct within §5.3).
 */
export const PAIN_IA_QUERIES = {
  painScore: { specRef: '5.3', questionTextContains: 'Pain score' },
  painLocation: { specRef: '5.3', questionTextContains: 'Pain location' },
  painTrigger: { specRef: '5.3', questionTextContains: 'Pain trigger' },
  currentPainRelief: { specRef: '5.3', questionTextContains: 'Current pain relief' },
} as const;

function sourceFromIaAnswer(
  answer: SubmissionAnswerForRules,
  sourceValue: string,
): CarePlanSuggestionSourceQuestion {
  return {
    questionId: answer.questionId,
    questionFieldKey: answer.fieldKey,
    specRef: answer.specRef,
    sourceSection: `§${answer.sectionNumber} ${answer.sectionTitle}`,
    sourceLabel: answer.questionText,
    sourceValue,
  };
}

/** Single free-text §5.3 source. */
function resolveIaText(
  ctx: CarePlanComposeContext,
  query: { specRef?: string; questionTextContains?: string },
): PainSuggestionParts | null {
  if (!ctx.ia) return null;
  const answer = findIaAnswer(ctx.ia.answers, query);
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
  if (!answer || !text) return null;
  return { suggestedValue: text, displayText: text, sources: [sourceFromIaAnswer(answer, text)] };
}

/**
 * Usual pain score — IA §5.3 "Pain score (0-10)" (NUMBER). A score of 0 is a valid value,
 * so the guard is on null, not falsiness.
 */
function resolvePainScore(ctx: CarePlanComposeContext): PainSuggestionParts | null {
  if (!ctx.ia) return null;
  const answer = findIaAnswer(ctx.ia.answers, PAIN_IA_QUERIES.painScore);
  if (!answer) return null;
  const score = resolveIaNumberValue(answer);
  if (score === null) return null;
  const value = String(score);
  return { suggestedValue: value, displayText: value, sources: [sourceFromIaAnswer(answer, value)] };
}

/**
 * Suggestion mappings — surfaced as IA suggestion cards for a clinician to accept.
 * Values are never written into the draft by compose.
 */
export const PAIN_SUGGESTION_MAPPINGS: PainSuggestionMapping[] = [
  {
    businessKey: 'pain_management_usual_pain_score',
    resolve: resolvePainScore,
  },
  {
    businessKey: 'pain_management_site_and_character',
    resolve: (ctx) => resolveIaText(ctx, PAIN_IA_QUERIES.painLocation),
  },
  {
    businessKey: 'pain_management_worsens_relieves',
    resolve: (ctx) => resolveIaText(ctx, PAIN_IA_QUERIES.painTrigger),
  },
  {
    businessKey: 'pain_management_regular_analgesia',
    resolve: (ctx) => resolveIaText(ctx, PAIN_IA_QUERIES.currentPainRelief),
  },
];
