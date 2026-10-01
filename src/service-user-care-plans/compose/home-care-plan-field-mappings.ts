import type {
  CarePlanComposeContext,
  CarePlanComposeIaSnapshot,
  CarePlanSuggestionSourceQuestion,
} from './compose-context.types';
import {
  findIaAnswer,
  resolveIaBooleanValue,
  resolveIaDateIso,
  resolveIaDisplayValue,
} from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import {
  HCP_CONTINENCE_OPTION_CATHETER_CARE,
  HCP_CONTINENCE_OPTION_PAD_CHANGING,
  HCP_DIETARY_OPTION_PUREED_FOOD,
  HCP_DIETARY_OPTION_THICKENED_FLUIDS,
  HCP_MEAL_OPTION_NUTRITIONAL_SUPPLEMENTS,
  HCP_MOBILITY_AIDS_OPTION_HOISTING,
  HCP_MOBILITY_AIDS_OPTION_TRANSFER,
} from '../../../prisma/seeds/home-care-plan.seed-data';

export {
  HCP_AUTO_PREFILL_KEYS,
  HCP_FIELD_REGISTRY,
  HCP_MANUAL_KEYS,
  HCP_SECURE_IA_FIELD_KEYS,
  HCP_SUGGESTION_KEYS,
  assertHcpRegistryMatchesTemplate,
  hcpFieldRegistryEntry,
  hcpTierManifestFromRegistry,
} from './home-care-plan-field-registry';
export type {
  HcpFieldBusinessKey,
  HcpFieldMappingMode,
  HcpFieldRegistryEntry,
  HcpFieldSourceKind,
  HcpFieldSourceRef,
} from './home-care-plan-field-registry';

export type HcpResolvedAutoPrefill = {
  value: string | boolean;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type HcpSuggestionParts = {
  suggestedValue: string;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type HcpAutoPrefillMapping = {
  businessKey: string;
  resolve: (ctx: CarePlanComposeContext) => HcpResolvedAutoPrefill | null;
};

export type HcpSuggestionMapping = {
  businessKey: string;
  resolve: (ctx: CarePlanComposeContext) => HcpSuggestionParts | null;
};

export function sourceFromIaAnswer(
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

function yesNoLabel(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function resolveTextAutoPrefill(
  ia: CarePlanComposeIaSnapshot,
  fieldKey: string,
): HcpResolvedAutoPrefill | null {
  const answer = findIaAnswer(ia.answers, { fieldKey });
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
  if (!text || !answer) return null;
  return { value: text, sources: [sourceFromIaAnswer(answer, text)] };
}

function resolveDateAutoPrefill(
  ia: CarePlanComposeIaSnapshot,
  fieldKey: string,
): HcpResolvedAutoPrefill | null {
  const answer = findIaAnswer(ia.answers, { fieldKey });
  const iso = resolveIaDateIso(answer);
  if (!iso || !answer) return null;
  const value = iso.slice(0, 10);
  return { value, sources: [sourceFromIaAnswer(answer, value)] };
}

/** Collect "Label: answer" lines for the listed IA field keys, skipping unanswered ones. */
function narrativeLines(
  ia: CarePlanComposeIaSnapshot,
  fieldKeys: string[],
): { lines: string[]; sources: CarePlanSuggestionSourceQuestion[] } {
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  for (const fieldKey of fieldKeys) {
    const answer = findIaAnswer(ia.answers, { fieldKey });
    if (!answer) continue;
    const display = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
    if (!display) continue;
    lines.push(`${answer.questionText}: ${display}`);
    sources.push(sourceFromIaAnswer(answer, display));
  }

  return { lines, sources };
}

function suggestionFromLines(
  lines: string[],
  sources: CarePlanSuggestionSourceQuestion[],
): HcpSuggestionParts | null {
  if (lines.length === 0) return null;
  const narrative = lines.join('\n');
  return { suggestedValue: narrative, displayText: narrative, sources };
}

/**
 * Personal care narrative: IA answers (older IAs still have About Me "Personal hygiene"), the IA
 * bathing / dressing preferences, else the About Me profile's personal hygiene.
 */
function personalCareSuggestion(ctx: CarePlanComposeContext): HcpSuggestionParts | null {
  if (!ctx.ia) return null;
  const { lines, sources } = narrativeLines(ctx.ia, ['personalHygiene', 'personalCareLocations']);
  const bathing = findIaAnswer(ctx.ia.answers, { questionTextContains: 'bathing / shower and dressing preferences' });
  const bathingText = sanitizeComposeTextOrNull(resolveIaDisplayValue(bathing));
  if (bathing && bathingText) {
    lines.push(`${bathing.questionText}: ${bathingText}`);
    sources.push(sourceFromIaAnswer(bathing, bathingText));
  }
  const profileCare = sanitizeComposeTextOrNull(ctx.aboutMe?.personalCare ?? null);
  if (!lines.some((l) => l.startsWith('Personal hygiene:')) && profileCare) {
    lines.push(`Personal hygiene (About Me): ${profileCare}`);
    sources.push({
      questionId: 'about-me:personal-hygiene',
      sourceSection: 'About Me',
      sourceLabel: 'Personal hygiene',
      sourceValue: profileCare,
    });
  }
  return suggestionFromLines(lines, sources);
}

function narrativeSuggestion(
  ctx: CarePlanComposeContext,
  fieldKeys: string[],
): HcpSuggestionParts | null {
  if (!ctx.ia) return null;
  const { lines, sources } = narrativeLines(ctx.ia, fieldKeys);
  return suggestionFromLines(lines, sources);
}

/**
 * Build a MULTI_SELECT suggestion from IA evidence.
 * Only options that appear in `allowedOptions` are emitted, so a suggestion can never
 * propose a value the field does not offer.
 */
function optionSuggestion(
  picked: Array<{ option: string; source: CarePlanSuggestionSourceQuestion }>,
  allowedOptions: readonly string[],
): HcpSuggestionParts | null {
  const seen = new Set<string>();
  const options: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  for (const entry of picked) {
    if (!allowedOptions.includes(entry.option)) continue;
    if (seen.has(entry.option)) continue;
    seen.add(entry.option);
    options.push(entry.option);
    sources.push(entry.source);
  }

  if (options.length === 0) return null;
  const value = options.join(', ');
  return { suggestedValue: value, displayText: value, sources };
}

function selectedOptionText(answer: SubmissionAnswerForRules | undefined): string {
  return (resolveIaDisplayValue(answer) ?? '').toLowerCase();
}

/**
 * The individual option tokens an IA answer holds, lowercased.
 *
 * Matching is exact per token rather than a substring search over the joined display
 * text: substring matching let `unknown` satisfy a "thickened fluids" test and could not
 * see individual selections inside a MULTI_SELECT answer.
 */
function selectedValueTokens(answer: SubmissionAnswerForRules | undefined): string[] {
  if (!answer) return [];
  const raw = answer.selectedOptions;
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return [raw.trim().toLowerCase()];
  }
  return [];
}

function hasToken(answer: SubmissionAnswerForRules | undefined, ...accepted: string[]): boolean {
  const tokens = selectedValueTokens(answer);
  return accepted.some((value) => tokens.includes(value));
}

/**
 * Dietary options Initial Assessment can actually evidence.
 *
 * A strict subset of `HCP_DIETARY_NEEDS_OPTIONS`, built from the same constants so the
 * two can never disagree. "Food allergies" is deliberately absent: the
 * `ServiceUserAllergy` register is authoritative and must never be second-guessed by a
 * composed care plan value. "Liquidised foods" is absent because the IA food-texture
 * question offers no liquidised option (normal / soft / minced / pureed / unknown).
 * Vegetarian, Vegan, Diabetic Diet and Religious dietary restrictions have no IA source.
 */
export const HCP_DIETARY_IA_DERIVABLE_OPTIONS = [
  HCP_DIETARY_OPTION_PUREED_FOOD,
  HCP_DIETARY_OPTION_THICKENED_FLUIDS,
] as const;

/**
 * Continence options Initial Assessment can evidence, from the bladder and bowel
 * option lists ("Wears continence products" → pad changing, "Has a catheter in situ" →
 * catheter care). The remaining Care 2020 tasks have no IA equivalent.
 */
export const HCP_CONTINENCE_IA_DERIVABLE_OPTIONS = [
  HCP_CONTINENCE_OPTION_PAD_CHANGING,
  HCP_CONTINENCE_OPTION_CATHETER_CARE,
] as const;

/** Meal-support options Initial Assessment can evidence. */
export const HCP_MEAL_IA_DERIVABLE_OPTIONS = [
  HCP_MEAL_OPTION_NUTRITIONAL_SUPPLEMENTS,
] as const;

/** Mobility-aid options Initial Assessment can evidence. */
export const HCP_MOBILITY_AIDS_IA_DERIVABLE_OPTIONS = [
  HCP_MOBILITY_AIDS_OPTION_HOISTING,
  HCP_MOBILITY_AIDS_OPTION_TRANSFER,
] as const;

// IA option values these resolvers accept, taken from the live IA catalogue.
const IA_FOOD_TEXTURE_PUREED = 'pureed';
const IA_FLUID_THICKNESS_THICKENED = 'thickened';
const IA_CONTINENCE_PRODUCTS = 'products';
const IA_CONTINENCE_CATHETER = 'catheter';

// ---------------------------------------------------------------------------
// Auto-prefill mappings — administrative values only, mirroring Home Support Plan.
// ---------------------------------------------------------------------------

export const HCP_AUTO_PREFILL_MAPPINGS: HcpAutoPrefillMapping[] = [
  {
    businessKey: 'hcp_plan_start_date',
    resolve: (ctx) => (ctx.ia ? resolveDateAutoPrefill(ctx.ia, 'assessmentDate') : null),
  },
  {
    businessKey: 'hcp_review_frequency',
    resolve: (ctx) => (ctx.ia ? resolveTextAutoPrefill(ctx.ia, 'reviewFrequency') : null),
  },
];

// ---------------------------------------------------------------------------
// Suggestion mappings — surfaced as IA suggestion cards, never written to the draft.
// ---------------------------------------------------------------------------

export const HCP_SUGGESTION_MAPPINGS: HcpSuggestionMapping[] = [
  {
    businessKey: 'hcp_needs_summary',
    resolve: (ctx) => narrativeSuggestion(ctx, ['whatMattersMost', 'supportGoals']),
  },
  {
    businessKey: 'hcp_about_me',
    resolve: (ctx) => narrativeSuggestion(ctx, ['whatMattersMost']),
  },
  {
    businessKey: 'hcp_detailed_goals_outcomes',
    resolve: (ctx) => narrativeSuggestion(ctx, ['supportGoals', 'whatMattersMost']),
  },
  {
    businessKey: 'hcp_personal_care_needs',
    resolve: (ctx) => personalCareSuggestion(ctx),
  },
  {
    businessKey: 'hcp_continence_care_needs',
    resolve: (ctx) =>
      narrativeSuggestion(ctx, ['bladderContinenceOptions', 'bowelContinenceOptions']),
  },
  {
    businessKey: 'hcp_mobility_care_needs',
    resolve: (ctx) =>
      narrativeSuggestion(ctx, [
        'transferSupportRequired',
        'usesHoistOrSling',
      ]),
  },
  {
    businessKey: 'hcp_meal_requirements',
    resolve: (ctx) =>
      narrativeSuggestion(ctx, ['eatingAssistanceLevel', 'appetiteStatus', 'nutritionStatus']),
  },
  {
    businessKey: 'hcp_support_requirements',
    resolve: (ctx) => narrativeSuggestion(ctx, ['supportGoals']),
  },

  // ---- Option-list suggestions: only options IA directly evidences ----
  {
    businessKey: 'hcp_dietary_needs_summary',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const picked: Array<{ option: string; source: CarePlanSuggestionSourceQuestion }> = [];

      // Only "pureed" maps. Soft, minced, normal and unknown carry no dietary requirement
      // this field can express, and IA has no liquidised option at all.
      const texture = findIaAnswer(ctx.ia.answers, { fieldKey: 'foodTexture' });
      if (hasToken(texture, IA_FOOD_TEXTURE_PUREED)) {
        picked.push({
          option: HCP_DIETARY_OPTION_PUREED_FOOD,
          source: sourceFromIaAnswer(texture!, selectedOptionText(texture)),
        });
      }

      // Only an explicit "thickened" counts. "unknown" is an absence of evidence, not
      // evidence of a thickener, and must never be turned into a clinical finding.
      const fluids = findIaAnswer(ctx.ia.answers, { fieldKey: 'fluidThickness' });
      if (hasToken(fluids, IA_FLUID_THICKNESS_THICKENED)) {
        picked.push({
          option: HCP_DIETARY_OPTION_THICKENED_FLUIDS,
          source: sourceFromIaAnswer(fluids!, selectedOptionText(fluids)),
        });
      }

      // Food allergies is never derived — the allergy register is authoritative.
      return optionSuggestion(picked, HCP_DIETARY_IA_DERIVABLE_OPTIONS);
    },
  },
  {
    businessKey: 'hcp_meal_requirements_summary',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const picked: Array<{ option: string; source: CarePlanSuggestionSourceQuestion }> = [];

      const supplements = findIaAnswer(ctx.ia.answers, {
        fieldKey: 'nutritionalSupplementsPrescribed',
      });
      if (supplements && resolveIaBooleanValue(supplements) === true) {
        picked.push({
          option: HCP_MEAL_OPTION_NUTRITIONAL_SUPPLEMENTS,
          source: sourceFromIaAnswer(supplements, yesNoLabel(true)),
        });
      }

      return optionSuggestion(picked, HCP_MEAL_IA_DERIVABLE_OPTIONS);
    },
  },
  {
    businessKey: 'hcp_continence_needs_summary',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const picked: Array<{ option: string; source: CarePlanSuggestionSourceQuestion }> = [];

      // IA records "Wears continence products" (products) and "Has a catheter in situ"
      // (catheter). Neither option list contains the word "pad".
      const bladder = findIaAnswer(ctx.ia.answers, { fieldKey: 'bladderContinenceOptions' });
      if (hasToken(bladder, IA_CONTINENCE_CATHETER)) {
        picked.push({
          option: HCP_CONTINENCE_OPTION_CATHETER_CARE,
          source: sourceFromIaAnswer(bladder!, selectedOptionText(bladder)),
        });
      }
      if (hasToken(bladder, IA_CONTINENCE_PRODUCTS)) {
        picked.push({
          option: HCP_CONTINENCE_OPTION_PAD_CHANGING,
          source: sourceFromIaAnswer(bladder!, selectedOptionText(bladder)),
        });
      }

      const bowel = findIaAnswer(ctx.ia.answers, { fieldKey: 'bowelContinenceOptions' });
      if (hasToken(bowel, IA_CONTINENCE_PRODUCTS)) {
        picked.push({
          option: HCP_CONTINENCE_OPTION_PAD_CHANGING,
          source: sourceFromIaAnswer(bowel!, selectedOptionText(bowel)),
        });
      }

      return optionSuggestion(picked, HCP_CONTINENCE_IA_DERIVABLE_OPTIONS);
    },
  },
  {
    businessKey: 'hcp_mobility_aids_summary',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const picked: Array<{ option: string; source: CarePlanSuggestionSourceQuestion }> = [];

      const hoist = findIaAnswer(ctx.ia.answers, { fieldKey: 'usesHoistOrSling' });
      if (hoist && resolveIaBooleanValue(hoist) === true) {
        picked.push({ option: HCP_MOBILITY_AIDS_OPTION_HOISTING, source: sourceFromIaAnswer(hoist, yesNoLabel(true)) });
      }

      const transfer = findIaAnswer(ctx.ia.answers, { fieldKey: 'transferSupportRequired' });
      if (transfer && resolveIaBooleanValue(transfer) === true) {
        picked.push({ option: HCP_MOBILITY_AIDS_OPTION_TRANSFER, source: sourceFromIaAnswer(transfer, yesNoLabel(true)) });
      }

      return optionSuggestion(picked, HCP_MOBILITY_AIDS_IA_DERIVABLE_OPTIONS);
    },
  },
];
