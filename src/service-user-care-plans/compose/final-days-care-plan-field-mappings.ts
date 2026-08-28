import type {
  CarePlanComposeContext,
  CarePlanSuggestionSourceQuestion,
} from './compose-context.types';
import { findIaAnswer, resolveIaDisplayValue } from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

export {
  FINAL_DAYS_AUTO_PREFILL_KEYS,
  FINAL_DAYS_FIELD_REGISTRY,
  FINAL_DAYS_MANUAL_KEYS,
  FINAL_DAYS_SUGGESTION_KEYS,
  finalDaysFieldRegistryEntry,
  finalDaysTierManifestFromRegistry,
  assertFinalDaysRegistryMatchesTemplate,
} from './final-days-care-plan-field-registry';
export type {
  FinalDaysFieldBusinessKey,
  FinalDaysFieldMappingMode,
  FinalDaysFieldRegistryEntry,
  FinalDaysFieldSourceKind,
  FinalDaysFieldSourceRef,
} from './final-days-care-plan-field-registry';

export type FinalDaysSuggestionParts = {
  suggestedValue: string;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type FinalDaysSuggestionMapping = {
  businessKey: string;
  resolve: (ctx: CarePlanComposeContext) => FinalDaysSuggestionParts | null;
};

/**
 * IA queries, verbatim from the seeded catalogue. §5.3 / §1.7 / §1.2 hold multiple
 * questions per spec ref, so they are narrowed on question text; §13.6 is narrowed to the
 * location/summary question (the same query Advance uses — the yes/no gate is never used).
 */
export const FINAL_DAYS_IA_QUERIES = {
  painManagementPlan: { fieldKey: 'painManagementPlan' },
  currentPainRelief: { specRef: '5.3', questionTextContains: 'Current pain relief' },
  religiousSpiritualNeeds: { specRef: '1.7', questionTextContains: 'Religious or spiritual needs' },
  religionCultureLanguage: {
    specRef: '1.7',
    questionTextContains: 'Religion, culture, language',
  },
  familyContacts: { specRef: '1.2', questionTextContains: 'family, representative, next of kin' },
  adrtLocationSummary: { specRef: '13.6', questionTextContains: 'location and summary' },
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

/** Synthetic provenance entry for the structured ServiceUserLegalDocument record. */
function sourceFromLegalDocument(sourceValue: string): CarePlanSuggestionSourceQuestion {
  return {
    questionId: 'legal-document:dnacpr',
    sourceSection: 'Legal documents record',
    sourceLabel: 'DNACPR record',
    sourceValue,
  };
}

function partsFromLines(
  lines: string[],
  sources: CarePlanSuggestionSourceQuestion[],
): FinalDaysSuggestionParts | null {
  const text = sanitizeComposeTextOrNull(lines.join('\n'));
  if (!text || sources.length === 0) return null;
  return { suggestedValue: text, displayText: text, sources };
}

/**
 * Builds a suggestion from one or more free-text IA questions: each non-empty answer
 * contributes one line and one source. Returns null when none are answered.
 */
function resolveIaTextSources(
  ctx: CarePlanComposeContext,
  queries: ReadonlyArray<{ fieldKey?: string; specRef?: string; questionTextContains?: string }>,
): FinalDaysSuggestionParts | null {
  if (!ctx.ia) return null;

  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  for (const query of queries) {
    const answer = findIaAnswer(ctx.ia.answers, query);
    const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
    if (answer && text) {
      lines.push(text);
      sources.push(sourceFromIaAnswer(answer, text));
    }
  }

  return partsFromLines(lines, sources);
}

/**
 * ADRT / DNACPR details — combines the structured ServiceUserLegalDocument record (the
 * maintained source of truth for DNACPR status/location/date) with the IA §13.6
 * location/summary narrative. Surfaces only positive DNACPR/ADRT information; returns null
 * when neither source has anything to say.
 */
function resolveAdrtDetails(ctx: CarePlanComposeContext): FinalDaysSuggestionParts | null {
  if (!ctx.ia) return null;

  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  const legal = ctx.legalDocument;
  if (legal?.dnacprInPlace) {
    const legalLines: string[] = ['DNACPR is in place.'];
    const location = legal.dnacprPhysicalLocation?.trim();
    if (location) legalLines.push(`Document location: ${location}`);
    if (legal.dnacprStartDate) legalLines.push(`In place since ${legal.dnacprStartDate.slice(0, 10)}`);
    const legalText = sanitizeComposeTextOrNull(legalLines.join(' '));
    if (legalText) {
      lines.push(legalText);
      sources.push(sourceFromLegalDocument(legalText));
    }
  }

  const iaAnswer = findIaAnswer(ctx.ia.answers, FINAL_DAYS_IA_QUERIES.adrtLocationSummary);
  const iaText = sanitizeComposeTextOrNull(resolveIaDisplayValue(iaAnswer));
  if (iaAnswer && iaText) {
    lines.push(iaText);
    sources.push(sourceFromIaAnswer(iaAnswer, iaText));
  }

  return partsFromLines(lines, sources);
}

/**
 * Suggestion mappings — surfaced as IA suggestion cards for a clinician to accept.
 * Values are never written into the draft by compose. End-of-life data is sensitive:
 * these are suggestions only, never auto-fill.
 */
export const FINAL_DAYS_SUGGESTION_MAPPINGS: FinalDaysSuggestionMapping[] = [
  {
    businessKey: 'final_days_pain_management_plan',
    resolve: (ctx) =>
      resolveIaTextSources(ctx, [
        FINAL_DAYS_IA_QUERIES.painManagementPlan,
        FINAL_DAYS_IA_QUERIES.currentPainRelief,
      ]),
  },
  {
    businessKey: 'final_days_spiritual_cultural_needs',
    resolve: (ctx) =>
      resolveIaTextSources(ctx, [
        FINAL_DAYS_IA_QUERIES.religiousSpiritualNeeds,
        FINAL_DAYS_IA_QUERIES.religionCultureLanguage,
      ]),
  },
  {
    businessKey: 'final_days_family_contact_updates',
    resolve: (ctx) => resolveIaTextSources(ctx, [FINAL_DAYS_IA_QUERIES.familyContacts]),
  },
  {
    businessKey: 'final_days_adrt_details',
    resolve: resolveAdrtDetails,
  },
];
