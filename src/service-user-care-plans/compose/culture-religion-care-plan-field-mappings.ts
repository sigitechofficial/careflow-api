import type {
  CarePlanComposeContext,
  CarePlanSuggestionSourceQuestion,
} from './compose-context.types';
import {
  findIaAnswer,
  resolveIaDisplayValue,
  resolveIaRawValue,
} from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

export {
  CRS_AUTO_PREFILL_KEYS,
  CRS_FIELD_REGISTRY,
  CRS_MANUAL_KEYS,
  CRS_SUGGESTION_KEYS,
  crsFieldRegistryEntry,
  crsTierManifestFromRegistry,
  assertCrsRegistryMatchesTemplate,
} from './culture-religion-care-plan-field-registry';
export type {
  CrsFieldBusinessKey,
  CrsFieldMappingMode,
  CrsFieldRegistryEntry,
  CrsFieldSourceKind,
  CrsFieldSourceRef,
} from './culture-religion-care-plan-field-registry';

export type CrsSuggestionParts = {
  suggestedValue: string;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type CrsSuggestionMapping = {
  businessKey: string;
  resolve: (ctx: CarePlanComposeContext) => CrsSuggestionParts | null;
};

/**
 * IA §1.1 / §1.3b / §1.6 / §1.7 culture, religion and equality queries, taken verbatim
 * from the seeded catalogue. §1.1 and §1.3b carry a fieldKey; the §1.6 / §1.7 questions
 * carry only a specRef, so several share a spec ref and must be narrowed on question text.
 */
export const CRS_IA_QUERIES = {
  religiousSpiritualPreferences: { fieldKey: 'religiousSpiritualPreferences' },
  prayerWorship: { specRef: '1.7', questionTextContains: 'Prayer routine or worship' },
  religiousSpiritualNeeds: { specRef: '1.7', questionTextContains: 'Religious or spiritual needs' },
  culturalBackground: { fieldKey: 'culturalBackground' },
  equalityRiskOrNeed: { specRef: '1.7', questionTextContains: 'equality related risk or need' },
  dietaryRequirements: { specRef: '1.7', questionTextContains: 'dietary requirements' },
  genderPreference: { specRef: '1.6', questionTextContains: 'gender preference' },
} as const;

/** IA §1.6 staff-gender-preference SELECT codes → clinician-facing label. */
const STAFF_GENDER_PREFERENCE_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  no_preference: 'No preference',
  case_by_case: 'Case by case',
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
): CrsSuggestionParts | null {
  const text = sanitizeComposeTextOrNull(lines.join('\n'));
  if (!text || sources.length === 0) return null;
  return { suggestedValue: text, displayText: text, sources };
}

/**
 * Builds a suggestion from one or more free-text IA questions: each non-empty answer
 * contributes one line and one source. Returns null when none are answered.
 */
function resolveTextSources(
  ctx: CarePlanComposeContext,
  queries: ReadonlyArray<{ fieldKey?: string; specRef?: string; questionTextContains?: string }>,
): CrsSuggestionParts | null {
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

/** Staff gender preference: SELECT value mapped to its label. */
function resolveGenderPreference(ctx: CarePlanComposeContext): CrsSuggestionParts | null {
  if (!ctx.ia) return null;

  const answer = findIaAnswer(ctx.ia.answers, CRS_IA_QUERIES.genderPreference);
  // The current preference (DOM Care) wins over the assessment answer it started from.
  const current = ctx.profile?.staffGenderPreference?.toLowerCase().trim();
  const currentLabel = current ? STAFF_GENDER_PREFERENCE_LABELS[current] : null;
  if (currentLabel) {
    return {
      suggestedValue: currentLabel,
      displayText: currentLabel,
      sources: [
        {
          questionId: answer?.questionId ?? 'dom-care-gender-preference',
          questionFieldKey: answer?.fieldKey,
          specRef: answer?.specRef,
          sourceSection: 'DOM Care',
          sourceLabel: 'Gender preference of staff (current)',
          sourceValue: currentLabel,
        },
      ],
    };
  }
  if (!answer) return null;

  const raw = resolveIaRawValue(answer)?.toLowerCase().trim();
  const mapped = raw ? STAFF_GENDER_PREFERENCE_LABELS[raw] : null;
  const value = sanitizeComposeTextOrNull(mapped ?? resolveIaDisplayValue(answer));
  if (!value) return null;

  return {
    suggestedValue: value,
    displayText: value,
    sources: [sourceFromIaAnswer(answer, value)],
  };
}

/**
 * Suggestion mappings — surfaced as IA suggestion cards for a staff member to accept.
 * Values are never written into the draft by compose. Religion and belief are
 * special-category data: these are suggestions only, never auto-fill.
 */
export const CRS_SUGGESTION_MAPPINGS: CrsSuggestionMapping[] = [
  {
    businessKey: 'crs_faith_belief_system',
    resolve: (ctx) =>
      resolveTextSources(ctx, [
        CRS_IA_QUERIES.religiousSpiritualPreferences,
        CRS_IA_QUERIES.religiousSpiritualNeeds,
      ]),
  },
  {
    businessKey: 'crs_cultural_practices',
    resolve: (ctx) =>
      resolveTextSources(ctx, [
        CRS_IA_QUERIES.culturalBackground,
        CRS_IA_QUERIES.equalityRiskOrNeed,
      ]),
  },
  {
    businessKey: 'crs_religious_observances',
    resolve: (ctx) =>
      resolveTextSources(ctx, [
        CRS_IA_QUERIES.prayerWorship,
        CRS_IA_QUERIES.religiousSpiritualNeeds,
      ]),
  },
  {
    businessKey: 'crs_dietary_requirements',
    resolve: (ctx) => resolveTextSources(ctx, [CRS_IA_QUERIES.dietaryRequirements]),
  },
  {
    businessKey: 'crs_gender_preference',
    resolve: resolveGenderPreference,
  },
];
