import type {
  CarePlanComposeContext,
  CarePlanSuggestionSourceQuestion,
} from './compose-context.types';
import {
  findIaAnswer,
  resolveIaBooleanYes,
  resolveIaRawValue,
} from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

export {
  COG_AUTO_PREFILL_KEYS,
  COG_FIELD_REGISTRY,
  COG_MANUAL_KEYS,
  COG_SUGGESTION_KEYS,
  cogFieldRegistryEntry,
  cogTierManifestFromRegistry,
  assertCogRegistryMatchesTemplate,
} from './cognition-behaviour-care-plan-field-registry';
export type {
  CogFieldBusinessKey,
  CogFieldMappingMode,
  CogFieldRegistryEntry,
  CogFieldSourceKind,
  CogFieldSourceRef,
} from './cognition-behaviour-care-plan-field-registry';

export type CogSuggestionParts = {
  suggestedValue: string;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type CogSuggestionMapping = {
  businessKey: string;
  resolve: (ctx: CarePlanComposeContext) => CogSuggestionParts | null;
};

/**
 * IA cognition/behaviour queries, taken verbatim from the seeded catalogue (§10.6 / 10.6a).
 * These are the only IA questions the audit approved as genuinely equivalent.
 */
export const COG_IA_QUERIES = {
  cognitiveImpairment: { fieldKey: 'cognitiveImpairment' },
  diagnosedDementia: { specRef: '10.6a', questionTextContains: 'Diagnosed dementia' },
  learningDisability: { specRef: '10.6a', questionTextContains: 'Learning disability' },
  brainInjury: { specRef: '10.6a', questionTextContains: 'brain injury' },
  challengingBehaviour: {
    specRef: '10.6a',
    questionTextContains: 'Challenging behaviour or agitation with change',
  },
} as const;

/** Cognitive impairment SELECT codes → clinician-facing label. "none" is intentionally omitted. */
const COGNITIVE_IMPAIRMENT_LABELS: Record<string, string> = {
  mild: 'Mild cognitive impairment',
  moderate: 'Moderate cognitive impairment',
  severe: 'Severe cognitive impairment',
};

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

function partsFromLines(
  lines: string[],
  sources: CarePlanSuggestionSourceQuestion[],
): CogSuggestionParts | null {
  const text = sanitizeComposeTextOrNull(lines.join('\n'));
  if (!text || sources.length === 0) return null;
  return { suggestedValue: text, displayText: text, sources };
}

/**
 * Diagnosis / cognitive concern.
 *
 * Assembles the positive cognitive findings the IA genuinely records: the graded
 * impairment level (mild/moderate/severe — "none" is skipped) and any of diagnosed
 * dementia, learning disability, or brain injury. Returns null when the assessment
 * records no positive finding, so an unremarkable assessment produces no suggestion.
 */
function resolveDiagnosisOrConcern(ctx: CarePlanComposeContext): CogSuggestionParts | null {
  if (!ctx.ia) return null;

  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  const impairmentAnswer = findIaAnswer(ctx.ia.answers, COG_IA_QUERIES.cognitiveImpairment);
  const impairmentRaw = resolveIaRawValue(impairmentAnswer)?.toLowerCase().trim();
  if (impairmentAnswer && impairmentRaw && COGNITIVE_IMPAIRMENT_LABELS[impairmentRaw]) {
    const label = COGNITIVE_IMPAIRMENT_LABELS[impairmentRaw];
    lines.push(`Cognitive impairment: ${label}`);
    sources.push(sourceFromIaAnswer(impairmentAnswer, label));
  }

  const positiveFlags: Array<{ query: { specRef: string; questionTextContains: string }; line: string }> = [
    { query: COG_IA_QUERIES.diagnosedDementia, line: 'Diagnosed dementia' },
    { query: COG_IA_QUERIES.learningDisability, line: 'Learning disability' },
    { query: COG_IA_QUERIES.brainInjury, line: 'History of brain injury' },
  ];

  for (const { query, line } of positiveFlags) {
    const answer = findIaAnswer(ctx.ia.answers, query);
    if (answer && resolveIaBooleanYes(answer)) {
      lines.push(line);
      sources.push(sourceFromIaAnswer(answer, 'Yes'));
    }
  }

  return partsFromLines(lines, sources);
}

/**
 * Known triggers.
 *
 * The IA records "change" as a behavioural trigger via two §10.6a yes/no questions.
 * Only surfaced when answered Yes; both No / unanswered produces no suggestion.
 */
function resolveKnownTriggers(ctx: CarePlanComposeContext): CogSuggestionParts | null {
  if (!ctx.ia) return null;

  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  const flags: Array<{ query: { specRef: string; questionTextContains: string }; line: string }> = [
    {
      query: COG_IA_QUERIES.challengingBehaviour,
      line: 'Challenging behaviour or agitation with change',
    },
  ];

  for (const { query, line } of flags) {
    const answer = findIaAnswer(ctx.ia.answers, query);
    if (answer && resolveIaBooleanYes(answer)) {
      lines.push(line);
      sources.push(sourceFromIaAnswer(answer, 'Yes'));
    }
  }

  return partsFromLines(lines, sources);
}

/**
 * Suggestion mappings — surfaced as IA suggestion cards for a clinician to accept.
 * Values are never written into the draft by compose.
 */
export const COG_SUGGESTION_MAPPINGS: CogSuggestionMapping[] = [
  {
    businessKey: 'cog_diagnosis_or_concern',
    resolve: resolveDiagnosisOrConcern,
  },
  {
    businessKey: 'cog_known_triggers',
    resolve: resolveKnownTriggers,
  },
];
