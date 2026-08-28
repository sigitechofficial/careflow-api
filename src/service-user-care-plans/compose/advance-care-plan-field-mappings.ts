import type {
  CarePlanComposeContext,
  CarePlanSuggestionSourceQuestion,
} from './compose-context.types';
import { findIaAnswer, resolveIaDisplayValue } from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

export {
  ACP_AUTO_PREFILL_KEYS,
  ACP_FIELD_REGISTRY,
  ACP_MANUAL_KEYS,
  ACP_SUGGESTION_KEYS,
  acpFieldRegistryEntry,
  acpTierManifestFromRegistry,
  assertAcpRegistryMatchesTemplate,
} from './advance-care-plan-field-registry';
export type {
  AcpFieldBusinessKey,
  AcpFieldMappingMode,
  AcpFieldRegistryEntry,
  AcpFieldSourceKind,
  AcpFieldSourceRef,
} from './advance-care-plan-field-registry';

export type AcpSuggestionParts = {
  suggestedValue: string;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type AcpSuggestionMapping = {
  businessKey: string;
  resolve: (ctx: CarePlanComposeContext) => AcpSuggestionParts | null;
};

/**
 * IA §13.6 holds two questions that share a spec reference and carry no fieldKey:
 *   - "DNACPR or ReSPECT in place?"        (YES_NO)   — deliberately NOT mapped
 *   - "ReSPECT / DNACPR location and summary" (TEXTAREA) — the approved source
 *
 * specRef alone would match both, so the query narrows on question text. This is the
 * same mechanism already used for GP details in `compose-context.loader.ts`.
 */
export const ACP_ADRT_IA_QUERY = {
  specRef: '13.6',
  questionTextContains: 'location and summary',
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
 * Advance decision / DNACPR narrative detail.
 *
 * Returns null when the IA answer is missing or blank — the §13.6 text question is
 * conditional on the yes/no gate above it, so an unanswered assessment must produce
 * no suggestion rather than an empty one.
 */
function resolveAdrtDetails(ctx: CarePlanComposeContext): AcpSuggestionParts | null {
  if (!ctx.ia) return null;

  const answer = findIaAnswer(ctx.ia.answers, ACP_ADRT_IA_QUERY);
  if (!answer) return null;

  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
  if (!text) return null;

  return {
    suggestedValue: text,
    displayText: text,
    sources: [sourceFromIaAnswer(answer, text)],
  };
}

/**
 * Suggestion mappings — surfaced as IA suggestion cards for a clinician to accept.
 * Values are never written into the draft by compose.
 */
export const ACP_SUGGESTION_MAPPINGS: AcpSuggestionMapping[] = [
  {
    businessKey: 'acp_adrt_details',
    resolve: resolveAdrtDetails,
  },
];
