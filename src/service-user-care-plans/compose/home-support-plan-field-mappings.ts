import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type {
  AdlComposeMetadata,
  AdlWorksheetRowMetadata,
} from './compose-adl-metadata.util';
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
import { sanitizeComposeText, sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import type { AboutMeComposeSummary } from './about-me-compose-summary.util';
import type {
  HspAutoPrefillKey,
  HspPilotAutoPrefillKey,
  HspPilotSuggestionKey,
  HspSuggestionKey,
} from './home-support-plan-field-registry';
import { HSP_SUGGESTION_KEYS } from './home-support-plan-field-registry';

export {
  HSP_AUTO_PREFILL_KEYS,
  HSP_FIELD_REGISTRY,
  HSP_MANUAL_KEYS,
  HSP_PILOT_AUTO_PREFILL_KEYS,
  HSP_PILOT_SUGGESTION_KEYS,
  HSP_SECURE_IA_FIELD_KEYS,
  HSP_SUGGESTION_KEYS,
  assertHspRegistryMatchesTemplate,
  hspFieldRegistryEntry,
  hspTierManifestFromRegistry,
} from './home-support-plan-field-registry';
export type {
  HspAutoPrefillKey,
  HspFieldBusinessKey,
  HspFieldMappingMode,
  HspFieldRegistryEntry,
  HspFieldSourceKind,
  HspFieldSourceRef,
  HspSuggestionKey,
  HspPilotAutoPrefillKey,
  HspPilotSuggestionKey,
} from './home-support-plan-field-registry';

export type HspPilotFieldKey = HspPilotAutoPrefillKey | HspPilotSuggestionKey;

export const HSP_ADL_PERSONAL_CARE_ACTIVITY_IDS = [
  'bathing',
  'grooming',
  'dressing_undressing',
  'toileting',
] as const;

export const HSP_ADL_MEAL_PREP_ACTIVITY_ID = 'preparing_food';

export const HSP_ADL_DOMESTIC_ACTIVITY_IDS = ['preparing_food', 'housework', 'laundry'] as const;

export const HSP_ADL_EQUIPMENT_ACTIVITY_IDS = [
  'room_to_room',
  'chair_transfer',
  'toilet_transfer',
  'bed_transfer',
  'enter_leave_home',
  'public_transport',
  'short_walks',
] as const;

export const HSP_ADL_TRANSPORT_ACTIVITY_ID = 'public_transport';

const ADL_SCORE_LABELS = [
  'Independent / no support needed',
  'Occasional assistance',
  'Assistance of one person',
  'Assistance of two people',
  'Does not or cannot perform',
] as const;

export type HspResolvedAutoPrefill = {
  value: string | boolean;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type HspAutoPrefillMapping = {
  businessKey: HspAutoPrefillKey;
  resolve: (ctx: CarePlanComposeContext) => HspResolvedAutoPrefill | null;
};

export type HspSuggestionParts = {
  suggestedValue: string;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

export type HspSuggestionMapping = {
  businessKey: HspSuggestionKey;
  resolve: (ctx: CarePlanComposeContext) => HspSuggestionParts | null;
};

function yesNoLabel(value: boolean): string {
  return value ? 'Yes' : 'No';
}

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

function sourceFromAdlMetadata(
  label: string,
  sourceValue: string,
): CarePlanSuggestionSourceQuestion {
  return {
    questionId: `adl-metadata:${label.replace(/\s+/g, '-').toLowerCase()}`,
    sourceSection: '§12 Mobility, ADL and Practical Support',
    sourceLabel: label,
    sourceValue,
  };
}

function sourceFromAboutMe(label: string, sourceValue: string): CarePlanSuggestionSourceQuestion {
  return {
    questionId: `about-me:${label.replace(/\s+/g, '-').toLowerCase()}`,
    sourceSection: 'About Me §1.3e',
    sourceLabel: label,
    sourceValue,
  };
}

function resolveBooleanAutoPrefill(
  ia: CarePlanComposeIaSnapshot,
  query: Parameters<typeof findIaAnswer>[1],
): HspResolvedAutoPrefill | null {
  const answer = findIaAnswer(ia.answers, query);
  const bool = resolveIaBooleanValue(answer);
  if (bool == null || !answer) return null;
  const display = yesNoLabel(bool);
  return {
    value: bool,
    sources: [sourceFromIaAnswer(answer, display)],
  };
}

function resolveTextAutoPrefill(
  ia: CarePlanComposeIaSnapshot,
  query: Parameters<typeof findIaAnswer>[1],
): HspResolvedAutoPrefill | null {
  const answer = findIaAnswer(ia.answers, query);
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
  if (!text || !answer) return null;
  return {
    value: text,
    sources: [sourceFromIaAnswer(answer, text)],
  };
}

function adlScoreLabel(score: number): string {
  if (score >= 0 && score < ADL_SCORE_LABELS.length) return ADL_SCORE_LABELS[score]!;
  return `Score ${score}`;
}

function formatAdlRowLine(row: AdlWorksheetRowMetadata): string {
  const label = adlScoreLabel(row.score);
  const notes = sanitizeComposeTextOrNull(row.notes);
  return notes ? `${row.activity}: ${label} (${notes})` : `${row.activity}: ${label}`;
}

function findAdlRow(adl: AdlComposeMetadata | null | undefined, activityId: string): AdlWorksheetRowMetadata | undefined {
  return adl?.rows.find((row) => row.id === activityId);
}

function resolveMobilityAidsInUse(ctx: CarePlanComposeContext): HspResolvedAutoPrefill | null {
  if (!ctx.ia) return null;
  const adl = ctx.ia.adlMetadata;
  const parts: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  if (adl?.mobilityAidsRequired != null) {
    const label = yesNoLabel(adl.mobilityAidsRequired);
    parts.push(`Mobility aids required: ${label}`);
    sources.push(sourceFromAdlMetadata('Mobility aids required', label));
  }
  if (adl?.mobilityAidsList?.trim()) {
    const list = sanitizeComposeText(adl.mobilityAidsList);
    if (list) {
      parts.push(`Aids in use: ${list}`);
      sources.push(sourceFromAdlMetadata('Mobility aids list', list));
    }
  }

  if (parts.length === 0) return null;
  return {
    value: parts.join('\n'),
    sources,
  };
}

function resolveGpPharmacyProfessionals(ctx: CarePlanComposeContext): HspResolvedAutoPrefill | null {
  if (!ctx.ia) return null;
  const parts: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  const gpContactAnswer = findIaAnswer(ctx.ia.answers, { fieldKey: 'gpContactDetails' });
  const gpContactText = sanitizeComposeTextOrNull(resolveIaDisplayValue(gpContactAnswer));
  if (gpContactText && gpContactAnswer) {
    parts.push(gpContactText);
    sources.push(sourceFromIaAnswer(gpContactAnswer, gpContactText));
  }

  if (ctx.gpPharmacyLine?.trim()) {
    const gpPharmacyLine = sanitizeComposeText(ctx.gpPharmacyLine);
    if (gpPharmacyLine) {
      parts.push(gpPharmacyLine);
    }
    const pharmacyAnswer = findIaAnswer(ctx.ia.answers, {
      specRef: '13.9',
      questionTextContains: 'pharmacy',
    });
    const pharmacyText = sanitizeComposeTextOrNull(resolveIaDisplayValue(pharmacyAnswer));
    if (pharmacyText && pharmacyAnswer) {
      sources.push(sourceFromIaAnswer(pharmacyAnswer, pharmacyText));
    }
  }

  if (parts.length === 0) return null;
  return {
    value: parts.join('\n'),
    sources,
  };
}

function resolveDateAutoPrefill(
  ia: CarePlanComposeIaSnapshot,
  query: Parameters<typeof findIaAnswer>[1],
): HspResolvedAutoPrefill | null {
  const answer = findIaAnswer(ia.answers, query);
  const iso = resolveIaDateIso(answer);
  if (!iso || !answer) return null;
  const value = iso.slice(0, 10);
  return {
    value,
    sources: [sourceFromIaAnswer(answer, value)],
  };
}

/** Map IA eating assistance codes to Home Support Plan SELECT labels — exact codes only. */
export function mapEatingAssistanceLevelToHsp(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'independent') return 'Independent';
  if (v === 'prompting') return 'Prompting';
  if (v === 'supervision') return 'Supervision';
  if (v === 'full_support' || v === 'full assistance') return 'Full assistance';
  return null;
}

function resolveEatingDrinkingAssistanceLevel(ctx: CarePlanComposeContext): HspResolvedAutoPrefill | null {
  if (!ctx.ia) return null;
  const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'eatingAssistanceLevel' });
  const mapped = mapEatingAssistanceLevelToHsp(resolveIaDisplayValue(answer));
  if (!mapped || !answer) return null;
  return {
    value: mapped,
    sources: [sourceFromIaAnswer(answer, mapped)],
  };
}

function resolvePlanStartDate(ctx: CarePlanComposeContext): HspResolvedAutoPrefill | null {
  if (!ctx.ia) return null;
  return resolveDateAutoPrefill(ctx.ia, { fieldKey: 'assessmentDate' });
}

function resolveHomeAccessInstructions(ctx: CarePlanComposeContext): HspResolvedAutoPrefill | null {
  if (!ctx.ia) return null;
  return (
    resolveTextAutoPrefill(ctx.ia, { fieldKey: 'accessInstructions' }) ??
    resolveTextAutoPrefill(ctx.ia, { fieldKey: 'homeAccessInstructions' })
  );
}

function resolveShoppingErrands(ctx: CarePlanComposeContext): HspResolvedAutoPrefill | null {
  // Older IAs asked "Shopping arrangements" in About Me; now it comes from the About Me profile.
  const fromIa = ctx.ia ? resolveTextAutoPrefill(ctx.ia, { fieldKey: 'shoppingArrangements' }) : null;
  if (fromIa) return fromIa;
  const text = sanitizeComposeTextOrNull(ctx.aboutMe?.shopping ?? null);
  return text ? { value: text, sources: [sourceFromAboutMe('Shopping arrangements', text)] } : null;
}

function resolveInformalCarerContact(ctx: CarePlanComposeContext): HspResolvedAutoPrefill | null {
  if (!ctx.ia) return null;
  const parts: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  const nameAnswer = findIaAnswer(ctx.ia.answers, { fieldKey: 'informalCarerName' });
  const nameText = sanitizeComposeTextOrNull(resolveIaDisplayValue(nameAnswer));
  if (nameText && nameAnswer) {
    parts.push(`Name: ${nameText}`);
    sources.push(sourceFromIaAnswer(nameAnswer, nameText));
  }

  const contactAnswer = findIaAnswer(ctx.ia.answers, { fieldKey: 'informalCarerContact' });
  const contactText = sanitizeComposeTextOrNull(resolveIaDisplayValue(contactAnswer));
  if (contactText && contactAnswer) {
    parts.push(contactText);
    sources.push(sourceFromIaAnswer(contactAnswer, contactText));
  }

  if (parts.length === 0) return null;
  return {
    value: parts.join('\n'),
    sources,
  };
}

function resolveKeySafeInUse(ctx: CarePlanComposeContext): HspResolvedAutoPrefill | null {
  if (!ctx.ia) return null;
  const answer =
    findIaAnswer(ctx.ia.answers, { fieldKey: 'keySafePresent' }) ??
    findIaAnswer(ctx.ia.answers, { fieldKey: 'keySafePresentHolistic' });
  const bool = resolveIaBooleanValue(answer);
  if (bool == null || !answer) return null;
  const display = yesNoLabel(bool);
  return {
    value: bool,
    sources: [sourceFromIaAnswer(answer, display)],
  };
}

function buildSuggestionParts(
  lines: string[],
  sources: CarePlanSuggestionSourceQuestion[],
): HspSuggestionParts | null {
  if (lines.length === 0) return null;
  const narrative = lines.join('\n');
  return {
    suggestedValue: narrative,
    displayText: narrative,
    sources,
  };
}

function appendAboutMePart(
  ctx: CarePlanComposeContext,
  key: keyof AboutMeComposeSummary,
  label: string,
  lines: string[],
  sources: CarePlanSuggestionSourceQuestion[],
): void {
  const raw = ctx.aboutMe?.[key];
  if (typeof raw !== 'string' || !raw.trim()) return;
  const text = sanitizeComposeText(raw);
  if (!text) return;
  lines.push(`${label}: ${text}`);
  sources.push(sourceFromAboutMe(label, text));
}

function appendIaFieldLine(
  ia: CarePlanComposeIaSnapshot,
  query: Parameters<typeof findIaAnswer>[1],
  lines: string[],
  sources: CarePlanSuggestionSourceQuestion[],
  options?: { prefix?: string; includeQuestionText?: boolean },
): void {
  const answer = findIaAnswer(ia.answers, query);
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
  if (!text || !answer) return;
  const line =
    options?.includeQuestionText === true
      ? `${answer.questionText}: ${text}`
      : options?.prefix
        ? `${options.prefix}: ${text}`
        : text;
  lines.push(line);
  sources.push(sourceFromIaAnswer(answer, text));
}

function maxAdlScore(
  adl: AdlComposeMetadata | null | undefined,
  activityIds: readonly string[],
): number | null {
  let max: number | null = null;
  for (const activityId of activityIds) {
    const row = findAdlRow(adl, activityId);
    if (!row) continue;
    if (max == null || row.score > max) max = row.score;
  }
  return max;
}

function mapPersonalCareAssistanceLevel(score: number): string {
  if (score <= 0) return 'Independent';
  if (score === 1) return 'Supervision';
  if (score === 2) return 'Partial assistance';
  return 'Full assistance';
}

function mapDomesticAssistanceLevel(score: number): string {
  if (score <= 0) return 'None';
  if (score === 1) return 'Prompting';
  if (score === 2) return 'Partial';
  return 'Full';
}

function mapSupportToAttendActivities(score: number): string {
  if (score <= 0) return 'None';
  if (score === 1) return 'Prompting';
  return 'Escort';
}

function appendAdlRows(
  adl: AdlComposeMetadata | null | undefined,
  activityIds: readonly string[],
  lines: string[],
  sources: CarePlanSuggestionSourceQuestion[],
): void {
  for (const activityId of activityIds) {
    const row = findAdlRow(adl, activityId);
    if (!row) continue;
    const line = formatAdlRowLine(row);
    lines.push(line);
    sources.push(sourceFromAdlMetadata(row.activity, line));
  }
}

function resolveSupportNeedsSummarySuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaFieldLine(ctx.ia, { fieldKey: 'whatMattersMost' }, lines, sources, {
    prefix: 'What matters most',
  });
  appendIaFieldLine(ctx.ia, { fieldKey: 'supportGoals' }, lines, sources, {
    prefix: 'Support goals',
  });
  return buildSuggestionParts(lines, sources);
}

function resolvePersonalCareAssistanceLevelSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const score = maxAdlScore(ctx.ia.adlMetadata, HSP_ADL_PERSONAL_CARE_ACTIVITY_IDS);
  if (score == null) return null;
  const level = mapPersonalCareAssistanceLevel(score);
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  for (const activityId of HSP_ADL_PERSONAL_CARE_ACTIVITY_IDS) {
    const row = findAdlRow(ctx.ia.adlMetadata, activityId);
    if (!row) continue;
    sources.push(sourceFromAdlMetadata(row.activity, adlScoreLabel(row.score)));
  }
  if (sources.length === 0) return null;
  return {
    suggestedValue: level,
    displayText: level,
    sources,
  };
}

function resolveToiletingContinenceSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendAdlRows(ctx.ia.adlMetadata, ['toileting'], lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'bladderContinenceOptions' }, lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'bowelContinenceOptions' }, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolvePreferredPersonalCareTimesSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaFieldLine(ctx.ia, { fieldKey: 'preferredVisitTimes' }, lines, sources, {
    prefix: 'Preferred visit times',
  });
  appendAboutMePart(ctx, 'routineSummary', 'Routine (About Me)', lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveDignityPrivacyPreferencesSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendAboutMePart(ctx, 'howToSupport', 'How to support (About Me)', lines, sources);
  appendIaFieldLine(ctx.ia, { fieldKey: 'lifestyleRoleChoices' }, lines, sources, {
    prefix: 'Lifestyle and choices',
  });
  return buildSuggestionParts(lines, sources);
}

function resolveDietaryPreferencesSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendAboutMePart(ctx, 'foodPreferences', 'Food preferences (About Me)', lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'foodTexture' }, lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'nutritionStatus' }, lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'nutritionalSupplementsPrescribed' }, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveFluidIntakeGuidanceSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaTextPart(ctx.ia, { fieldKey: 'fluidThickness' }, lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'adequatelyHydrated' }, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveDomesticSupportSuggestion(
  ctx: CarePlanComposeContext,
  label: string,
): HspSuggestionParts | null {
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendAboutMePart(ctx, 'domesticSupport', label, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveOtherHouseholdTasksSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendAboutMePart(ctx, 'domesticSupport', 'Domestic support (About Me)', lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'supportOther' }, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveDomesticAssistanceLevelSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const score = maxAdlScore(ctx.ia.adlMetadata, HSP_ADL_DOMESTIC_ACTIVITY_IDS);
  if (score == null) return null;
  const level = mapDomesticAssistanceLevel(score);
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  for (const activityId of HSP_ADL_DOMESTIC_ACTIVITY_IDS) {
    const row = findAdlRow(ctx.ia.adlMetadata, activityId);
    if (!row) continue;
    sources.push(sourceFromAdlMetadata(row.activity, adlScoreLabel(row.score)));
  }
  if (sources.length === 0) return null;
  return {
    suggestedValue: level,
    displayText: level,
    sources,
  };
}

function resolveSocialCommunityActivitiesSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendAboutMePart(ctx, 'meaningfulActivities', 'Activities (About Me)', lines, sources);
  appendAboutMePart(ctx, 'lifeHistoryInterests', 'Interests (About Me)', lines, sources);
  appendIaFieldLine(ctx.ia, { fieldKey: 'lifestyleRoleChoices' }, lines, sources, {
    prefix: 'Lifestyle and choices',
  });
  return buildSuggestionParts(lines, sources);
}

function resolveSupportToAttendActivitiesSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const score = maxAdlScore(ctx.ia.adlMetadata, [HSP_ADL_TRANSPORT_ACTIVITY_ID]);
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  if (score != null) {
    const level = mapSupportToAttendActivities(score);
    lines.push(`Transport / community mobility: ${level}`);
    const row = findAdlRow(ctx.ia.adlMetadata, HSP_ADL_TRANSPORT_ACTIVITY_ID);
    if (row) sources.push(sourceFromAdlMetadata(row.activity, adlScoreLabel(row.score)));
  }
  appendAboutMePart(ctx, 'meaningfulActivities', 'Activities (About Me)', lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveKeySafeEntryNotesSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaFieldLine(ctx.ia, { fieldKey: 'keySafeLocation' }, lines, sources, {
    prefix: 'Key safe location',
  });
  return buildSuggestionParts(lines, sources);
}

function resolveEquipmentAidsInHomeSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendAdlRows(ctx.ia.adlMetadata, HSP_ADL_EQUIPMENT_ACTIVITY_IDS, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveNoResponseProcedureSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaTextPart(ctx.ia, { fieldKey: 'noResponseProcedureAgreed' }, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveGoal1Suggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaFieldLine(ctx.ia, { fieldKey: 'whatMattersMost' }, lines, sources);
  appendIaFieldLine(ctx.ia, { fieldKey: 'supportGoals' }, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveGoal1CarerSupportSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaFieldLine(ctx.ia, { fieldKey: 'supportGoals' }, lines, sources, {
    prefix: 'How carers will support',
  });
  return buildSuggestionParts(lines, sources);
}

function resolveGoal2Suggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaFieldLine(ctx.ia, { fieldKey: 'supportGoals' }, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolveEscalationInstructionsSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  appendIaTextPart(ctx.ia, { fieldKey: 'staffVisitRisks' }, lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'breathingActionPlan' }, lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'painManagementPlan' }, lines, sources);
  return buildSuggestionParts(lines, sources);
}

function resolvePersonalCareTasksSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  const adl = ctx.ia.adlMetadata;

  for (const activityId of HSP_ADL_PERSONAL_CARE_ACTIVITY_IDS) {
    const row = findAdlRow(adl, activityId);
    if (!row) continue;
    const line = formatAdlRowLine(row);
    lines.push(line);
    sources.push(sourceFromAdlMetadata(row.activity, line));
  }

  if (ctx.aboutMe?.personalCare?.trim()) {
    const text = sanitizeComposeText(ctx.aboutMe.personalCare);
    if (text) {
      lines.push(`Personal hygiene (About Me): ${text}`);
      sources.push(sourceFromAboutMe('Personal hygiene', text));
    }
  }

  if (lines.length === 0) return null;
  const narrative = lines.join('\n');
  return {
    suggestedValue: narrative,
    displayText: narrative,
    sources,
  };
}

function resolveMealPreparationSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  const preparingFood = findAdlRow(ctx.ia.adlMetadata, HSP_ADL_MEAL_PREP_ACTIVITY_ID);
  if (preparingFood) {
    const line = formatAdlRowLine(preparingFood);
    lines.push(line);
    sources.push(sourceFromAdlMetadata(preparingFood.activity, line));
  }

  if (ctx.aboutMe?.domesticSupport?.trim()) {
    const text = sanitizeComposeText(ctx.aboutMe.domesticSupport);
    if (text) {
      lines.push(`Domestic support (About Me): ${text}`);
      sources.push(sourceFromAboutMe('Domestic support', text));
    }
  }

  if (lines.length === 0) return null;
  const narrative = lines.join('\n');
  return {
    suggestedValue: narrative,
    displayText: narrative,
    sources,
  };
}

function appendIaTextPart(
  ia: CarePlanComposeIaSnapshot,
  query: Parameters<typeof findIaAnswer>[1],
  lines: string[],
  sources: CarePlanSuggestionSourceQuestion[],
): void {
  const answer = findIaAnswer(ia.answers, query);
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
  if (!text || !answer) return;
  lines.push(`${answer.questionText}: ${text}`);
  sources.push(sourceFromIaAnswer(answer, text));
}

function resolveEnvironmentalHazardsSuggestion(ctx: CarePlanComposeContext): HspSuggestionParts | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];

  appendIaTextPart(ctx.ia, { fieldKey: 'fireSafetyRisksDetails' }, lines, sources);
  appendIaTextPart(ctx.ia, { fieldKey: 'homeEnvironmentSafetyMeasures' }, lines, sources);
  appendIaTextPart(
    ctx.ia,
    { specRef: '3.10', questionTextContains: 'environment / access hazard notes' },
    lines,
    sources,
  );
  appendIaTextPart(ctx.ia, { fieldKey: 'staffVisitRisks' }, lines, sources);

  if (lines.length === 0) return null;
  const narrative = lines.join('\n');
  return {
    suggestedValue: narrative,
    displayText: narrative,
    sources,
  };
}

export const HSP_AUTO_PREFILL_MAPPINGS: HspAutoPrefillMapping[] = [
  {
    businessKey: 'hsp_plan_start_date',
    resolve: resolvePlanStartDate,
  },
  {
    businessKey: 'hsp_review_frequency',
    resolve: (ctx) =>
      ctx.ia ? resolveTextAutoPrefill(ctx.ia, { fieldKey: 'reviewFrequency' }) : null,
  },
  {
    businessKey: 'hsp_next_review_due_date',
    resolve: (ctx) =>
      ctx.ia ? resolveDateAutoPrefill(ctx.ia, { fieldKey: 'nextReviewDate' }) : null,
  },
  {
    businessKey: 'hsp_eating_drinking_assistance_level',
    resolve: resolveEatingDrinkingAssistanceLevel,
  },
  {
    businessKey: 'hsp_shopping_errands',
    resolve: resolveShoppingErrands,
  },
  {
    businessKey: 'hsp_finance_support_required',
    resolve: (ctx) =>
      ctx.ia ? resolveBooleanAutoPrefill(ctx.ia, { fieldKey: 'financeSupportRequired' }) : null,
  },
  {
    businessKey: 'hsp_home_access_instructions',
    resolve: resolveHomeAccessInstructions,
  },
  {
    businessKey: 'hsp_key_safe_in_use',
    resolve: resolveKeySafeInUse,
  },
  {
    businessKey: 'hsp_telecare_pendant_in_use',
    resolve: (ctx) =>
      ctx.ia ? resolveBooleanAutoPrefill(ctx.ia, { fieldKey: 'pendantTelecare' }) : null,
  },
  {
    businessKey: 'hsp_can_answer_front_door',
    resolve: (ctx) =>
      ctx.ia ? resolveBooleanAutoPrefill(ctx.ia, { fieldKey: 'canAnswerFrontDoor' }) : null,
  },
  {
    businessKey: 'hsp_lives_alone',
    resolve: (ctx) => (ctx.ia ? resolveBooleanAutoPrefill(ctx.ia, { fieldKey: 'livesAlone' }) : null),
  },
  {
    businessKey: 'hsp_mobility_aids_in_use',
    resolve: resolveMobilityAidsInUse,
  },
  {
    businessKey: 'hsp_hoist_sling_in_use',
    resolve: (ctx) =>
      ctx.ia ? resolveBooleanAutoPrefill(ctx.ia, { fieldKey: 'usesHoistOrSling' }) : null,
  },
  {
    businessKey: 'hsp_informal_carer_involved',
    resolve: (ctx) =>
      ctx.ia ? resolveBooleanAutoPrefill(ctx.ia, { fieldKey: 'informalCarerSupport' }) : null,
  },
  {
    businessKey: 'hsp_informal_carer_contact',
    resolve: resolveInformalCarerContact,
  },
  {
    businessKey: 'hsp_other_care_agencies',
    resolve: (ctx) =>
      ctx.ia ? resolveTextAutoPrefill(ctx.ia, { fieldKey: 'otherCareAgencies' }) : null,
  },
  {
    businessKey: 'hsp_gp_pharmacy_professionals',
    resolve: resolveGpPharmacyProfessionals,
  },
];

export const HSP_SUGGESTION_MAPPINGS: HspSuggestionMapping[] = [
  {
    businessKey: 'hsp_support_needs_summary',
    resolve: resolveSupportNeedsSummarySuggestion,
  },
  {
    businessKey: 'hsp_personal_care_tasks',
    resolve: resolvePersonalCareTasksSuggestion,
  },
  {
    businessKey: 'hsp_personal_care_assistance_level',
    resolve: resolvePersonalCareAssistanceLevelSuggestion,
  },
  {
    businessKey: 'hsp_toileting_continence_support',
    resolve: resolveToiletingContinenceSuggestion,
  },
  {
    businessKey: 'hsp_preferred_personal_care_times',
    resolve: resolvePreferredPersonalCareTimesSuggestion,
  },
  {
    businessKey: 'hsp_dignity_privacy_preferences',
    resolve: resolveDignityPrivacyPreferencesSuggestion,
  },
  {
    businessKey: 'hsp_meal_preparation_support',
    resolve: resolveMealPreparationSuggestion,
  },
  {
    businessKey: 'hsp_dietary_preferences_restrictions',
    resolve: resolveDietaryPreferencesSuggestion,
  },
  {
    businessKey: 'hsp_fluid_intake_guidance',
    resolve: resolveFluidIntakeGuidanceSuggestion,
  },
  {
    businessKey: 'hsp_cleaning_tasks',
    resolve: (ctx) => resolveDomesticSupportSuggestion(ctx, 'Cleaning (About Me)'),
  },
  {
    businessKey: 'hsp_laundry_tasks',
    resolve: (ctx) => resolveDomesticSupportSuggestion(ctx, 'Laundry (About Me)'),
  },
  {
    businessKey: 'hsp_other_household_tasks',
    resolve: resolveOtherHouseholdTasksSuggestion,
  },
  {
    businessKey: 'hsp_domestic_assistance_level',
    resolve: resolveDomesticAssistanceLevelSuggestion,
  },
  {
    businessKey: 'hsp_social_community_activities',
    resolve: resolveSocialCommunityActivitiesSuggestion,
  },
  {
    businessKey: 'hsp_support_to_attend_activities',
    resolve: resolveSupportToAttendActivitiesSuggestion,
  },
  {
    businessKey: 'hsp_key_safe_entry_notes',
    resolve: resolveKeySafeEntryNotesSuggestion,
  },
  {
    businessKey: 'hsp_environmental_hazards_notes',
    resolve: resolveEnvironmentalHazardsSuggestion,
  },
  {
    businessKey: 'hsp_equipment_aids_in_home',
    resolve: resolveEquipmentAidsInHomeSuggestion,
  },
  {
    businessKey: 'hsp_no_response_procedure',
    resolve: resolveNoResponseProcedureSuggestion,
  },
  {
    businessKey: 'hsp_goal_1',
    resolve: resolveGoal1Suggestion,
  },
  {
    businessKey: 'hsp_goal_1_carer_support',
    resolve: resolveGoal1CarerSupportSuggestion,
  },
  {
    businessKey: 'hsp_goal_2',
    resolve: resolveGoal2Suggestion,
  },
  {
    businessKey: 'hsp_escalation_instructions',
    resolve: resolveEscalationInstructionsSuggestion,
  },
];

function assertSuggestionMappingsMatchRegistry(): void {
  if (HSP_SUGGESTION_MAPPINGS.length !== HSP_SUGGESTION_KEYS.length) {
    throw new Error(
      `HSP SUGGESTION mapping count ${HSP_SUGGESTION_MAPPINGS.length} !== registry tier ${HSP_SUGGESTION_KEYS.length}`,
    );
  }
  for (const key of HSP_SUGGESTION_KEYS) {
    if (!HSP_SUGGESTION_MAPPINGS.some((entry) => entry.businessKey === key)) {
      throw new Error(`HSP SUGGESTION field missing resolver mapping: ${key}`);
    }
  }
}

assertSuggestionMappingsMatchRegistry();
