import type {
  CarePlanComposeContext,
  CarePlanSuggestionSourceQuestion,
} from './compose-context.types';
import { findIaAnswer, resolveIaDisplayValue } from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

export {
  PSYCH_AUTO_PREFILL_KEYS,
  PSYCH_FIELD_REGISTRY,
  PSYCH_MANUAL_KEYS,
  PSYCH_SUGGESTION_KEYS,
  psychFieldRegistryEntry,
  psychTierManifestFromRegistry,
  assertPsychRegistryMatchesTemplate,
} from './psychological-care-plan-field-registry';
export type {
  PsychFieldBusinessKey,
  PsychFieldMappingMode,
  PsychFieldRegistryEntry,
  PsychFieldSourceKind,
  PsychFieldSourceRef,
} from './psychological-care-plan-field-registry';

export type PsychSuggestionParts = {
  suggestedValue: string;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type PsychSuggestionMapping = {
  businessKey: string;
  resolve: (ctx: CarePlanComposeContext) => PsychSuggestionParts | null;
};

/** IA §10.1 mental-health-professional query, verbatim from the seeded catalogue. */
export const PSYCH_IA_QUERIES = {
  cpnNameAndContact: { specRef: '10.1', questionTextContains: 'CPN name and contact' },
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

/**
 * Involvement of CMHT or counsellor — IA §10.1 "CPN name and contact" records the community
 * mental-health professional involved. Returns null when no name/contact is recorded, so a
 * blank/absent answer produces no suggestion.
 */
function resolveCmhtCounsellor(ctx: CarePlanComposeContext): PsychSuggestionParts | null {
  if (!ctx.ia) return null;
  const answer = findIaAnswer(ctx.ia.answers, PSYCH_IA_QUERIES.cpnNameAndContact);
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
  if (!answer || !text) return null;
  return { suggestedValue: text, displayText: text, sources: [sourceFromIaAnswer(answer, text)] };
}

/**
 * Suggestion mappings — surfaced as IA suggestion cards for a clinician to accept.
 * Values are never written into the draft by compose.
 */
export const PSYCH_SUGGESTION_MAPPINGS: PsychSuggestionMapping[] = [
  {
    businessKey: 'psychological_cmht_counsellor',
    resolve: resolveCmhtCounsellor,
  },
];
