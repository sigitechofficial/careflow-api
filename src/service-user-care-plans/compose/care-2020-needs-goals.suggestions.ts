/**
 * Care 2020 "Needs, goals, support and risk" — STAFF SUGGESTIONS only.
 *
 * The four narrative fields may be suggested from explicit IA / About Me sources.
 * Area-risk YES/NO and the six risk follow-up fields stay MANUAL and are never suggested.
 *
 * Suggestions are never written into compose.values. Staff must Accept or Edit.
 * No keyword matching on free text. Exact fieldKey or exact questionText only.
 */
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type {
  CarePlanComposeContext,
  CarePlanFieldSuggestion,
  CarePlanFormFieldRef,
  CarePlanSuggestionSourceQuestion,
  ComposePlanResult,
} from './compose-context.types';
import {
  resolveIaBooleanValue,
  resolveIaDisplayValue,
} from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import { normalizeFieldLabel } from './compose-routes.util';

export const CARE_2020_NARRATIVE_SLOTS = [
  'service_user_needs',
  'needs_person_centred',
  'desired_goals_outcomes',
  'support_required',
] as const;

export type Care2020NarrativeSlot = (typeof CARE_2020_NARRATIVE_SLOTS)[number];

/** Form name → Care 2020 fieldKey prefix. Only plans with trustworthy IA sources. */
export const CARE_2020_FORM_PREFIX: Record<string, string> = {
  Continence: 'continence',
  'Washing and dressing': 'washing_dressing',
  Communication: 'communication',
  'Pressure Ulcer': 'pressure_ulcer',
  'Skin Integrity': 'skin_integrity',
  'Eating and Drinking': 'eating_and_drinking',
  'Sleeping and Night': 'sleeping_night',
  Mobility: 'mobility',
  'Dementia Care plan': 'dementia',
  'Cognition and Behaviour': 'cog',
  'Culture/Religion/Spirituality': 'crs',
  'Personal Safety': 'personal_safety',
};

export function care2020NarrativeKeys(prefix: string): string[] {
  return CARE_2020_NARRATIVE_SLOTS.map((slot) => `${prefix}_${slot}`);
}

export function isCare2020AreaRiskOrFollowUpKey(fieldKey: string | null | undefined): boolean {
  if (!fieldKey) return false;
  return /_(area_risk|risk_identify|risk_who_might_be_harmed|risk_level|risk_likelihood|risk_triggers|risk_management)$/.test(
    fieldKey,
  );
}

/** First-person service-user voice. Clinical/assessor third-person is not converted. */
export function looksFirstPerson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(i\b|i'|i’m|i'm|i’ve|i've|my\b|please\b|keep me\b)/i.test(trimmed);
}

function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function selectedCodes(answer: SubmissionAnswerForRules | undefined): string[] {
  if (!answer?.selectedOptions) return [];
  if (Array.isArray(answer.selectedOptions)) return answer.selectedOptions.map(String);
  if (typeof answer.selectedOptions === 'string' && answer.selectedOptions.trim()) {
    return [answer.selectedOptions.trim()];
  }
  return [];
}

function findAnswer(
  answers: SubmissionAnswerForRules[],
  query: { fieldKey?: string; questionText?: string },
): SubmissionAnswerForRules | undefined {
  if (query.fieldKey) {
    const byKey = answers.find((answer) => answer.fieldKey === query.fieldKey);
    if (byKey) return byKey;
  }
  if (query.questionText) {
    return answers.find((answer) => answer.questionText === query.questionText);
  }
  return undefined;
}

function sourceFromAnswer(
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

function sourceFromAboutMe(label: string, sourceValue: string): CarePlanSuggestionSourceQuestion {
  return {
    questionId: `about-me:${label}`,
    sourceSection: 'About Me',
    sourceLabel: label,
    sourceValue,
  };
}

type SlotParts = {
  suggestedValue: string;
  sources: CarePlanSuggestionSourceQuestion[];
};

function firstPersonFromAnswer(
  answers: SubmissionAnswerForRules[],
  query: { fieldKey?: string; questionText?: string },
): SlotParts | null {
  const answer = findAnswer(answers, query);
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(answer));
  if (!answer || !text || !looksFirstPerson(text)) return null;
  if (text === 'Yes' || text === 'No') return null;
  return { suggestedValue: text, sources: [sourceFromAnswer(answer, text)] };
}

function firstPersonFromAboutMe(
  ctx: CarePlanComposeContext,
  key: keyof NonNullable<CarePlanComposeContext['aboutMe']>,
  label: string,
): SlotParts | null {
  const raw = ctx.aboutMe?.[key];
  const text = sanitizeComposeTextOrNull(typeof raw === 'string' ? raw : null);
  if (!text || !looksFirstPerson(text)) return null;
  return { suggestedValue: text, sources: [sourceFromAboutMe(label, text)] };
}

function joinUnique(parts: Array<SlotParts | null>): SlotParts | null {
  const lines: string[] = [];
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    const value = part.suggestedValue.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    lines.push(value);
    sources.push(...part.sources);
  }
  if (lines.length === 0) return null;
  return { suggestedValue: lines.join('\n'), sources };
}

const CONTINENCE_INCONTINENCE_CODES = new Set(['incontinence', 'stress', 'nocturnal']);
const CONTINENCE_PRODUCT_CODES = new Set(['products']);

function continenceHasProductsOrIncontinence(ctx: CarePlanComposeContext): {
  usesProducts: boolean;
  incontinent: boolean;
  sources: CarePlanSuggestionSourceQuestion[];
} | null {
  if (!ctx.ia) return null;
  const bladder = findAnswer(ctx.ia.answers, { fieldKey: 'bladderContinenceOptions' });
  const bowel = findAnswer(ctx.ia.answers, { fieldKey: 'bowelContinenceOptions' });
  const productsInUse = findAnswer(ctx.ia.answers, { questionText: 'Continence products in use?' });
  const bladderCodes = selectedCodes(bladder);
  const bowelCodes = selectedCodes(bowel);
  const codes = [...bladderCodes, ...bowelCodes];
  const usesProducts =
    codes.some((code) => CONTINENCE_PRODUCT_CODES.has(code)) ||
    resolveIaBooleanValue(productsInUse) === true;
  const incontinent = codes.some((code) => CONTINENCE_INCONTINENCE_CODES.has(code));
  if (!usesProducts && !incontinent) return null;
  const sources: CarePlanSuggestionSourceQuestion[] = [];
  if (bladder && bladderCodes.length > 0) {
    const value = bladderCodes.join(', ');
    sources.push(sourceFromAnswer(bladder, value));
  }
  if (bowel && bowelCodes.length > 0) {
    const value = bowelCodes.join(', ');
    sources.push(sourceFromAnswer(bowel, value));
  }
  if (productsInUse && resolveIaBooleanValue(productsInUse) === true) {
    sources.push(sourceFromAnswer(productsInUse, 'Yes'));
  }
  return { usesProducts, incontinent, sources };
}

function resolveContinence(ctx: CarePlanComposeContext): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  if (!ctx.ia) return {};
  const structured = continenceHasProductsOrIncontinence(ctx);
  const productDetails = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Continence product details',
  });
  const out: Partial<Record<Care2020NarrativeSlot, SlotParts>> = {};
  if (structured) {
    out.service_user_needs = {
      suggestedValue: structured.usesProducts
        ? 'I need support with managing my continence products and maintaining my comfort and dignity.'
        : 'I need support to stay comfortable and manage my continence with dignity.',
      sources: structured.sources,
    };
    if (structured.usesProducts) {
      out.support_required = {
        suggestedValue:
          'Please support me with changing my continence products and check my skin regularly.',
        sources: structured.sources,
      };
    }
  }
  if (productDetails) {
    out.needs_person_centred = productDetails;
  }
  return out;
}

function resolveWashing(ctx: CarePlanComposeContext): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  const hygiene =
    (ctx.ia
      ? firstPersonFromAnswer(ctx.ia.answers, { fieldKey: 'personalHygiene' })
      : null) ?? firstPersonFromAboutMe(ctx, 'personalCare', 'Personal hygiene');
  const howToSupport =
    (ctx.ia
      ? firstPersonFromAnswer(ctx.ia.answers, { fieldKey: 'howAndWhenToSupportMe' })
      : null) ?? firstPersonFromAboutMe(ctx, 'howToSupport', 'How and when to support me');
  const privacy = ctx.ia
    ? firstPersonFromAnswer(ctx.ia.answers, {
        questionText: 'How should staff support privacy during personal care?',
      })
    : null;
  const bathing = ctx.ia
    ? firstPersonFromAnswer(ctx.ia.answers, {
        questionText: 'Bathing / shower and dressing preferences',
      })
    : null;
  return {
    service_user_needs: hygiene ?? undefined,
    needs_person_centred: joinUnique([howToSupport, privacy]) ?? undefined,
    support_required: bathing ?? howToSupport ?? undefined,
  };
}

function resolveCommunication(ctx: CarePlanComposeContext): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  if (!ctx.ia) {
    const about = firstPersonFromAboutMe(ctx, 'communication', 'How I communicate');
    return about
      ? { service_user_needs: about, needs_person_centred: about, support_required: about }
      : {};
  }
  const needs = firstPersonFromAnswer(ctx.ia.answers, { fieldKey: 'communicationNeeds' });
  const howICommunicate =
    firstPersonFromAnswer(ctx.ia.answers, { fieldKey: 'howICommunicate' }) ??
    firstPersonFromAboutMe(ctx, 'communication', 'How I communicate');
  const staff = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Staff communication instructions',
  });
  const notes = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Communication support notes',
  });
  const voice = joinUnique([howICommunicate, needs]);
  const support = joinUnique([staff, notes, howICommunicate]);
  return {
    service_user_needs: voice ?? undefined,
    needs_person_centred: howICommunicate ?? needs ?? undefined,
    support_required: support ?? undefined,
  };
}

function resolveSkinOrPressure(
  ctx: CarePlanComposeContext,
): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  if (!ctx.ia) return {};
  const wounds = firstPersonFromAnswer(ctx.ia.answers, { questionText: 'Ulcers or wounds comment' });
  const skinNotes = firstPersonFromAnswer(ctx.ia.answers, { fieldKey: 'skinIntegrityComments' });
  const equipment = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Pressure equipment details',
  });
  const further = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Further pressure equipment comment',
  });
  const needs = joinUnique([wounds, skinNotes]);
  const support = joinUnique([skinNotes, further, equipment]);
  return {
    service_user_needs: needs ?? undefined,
    needs_person_centred: wounds ?? skinNotes ?? undefined,
    support_required: support ?? undefined,
  };
}

function resolveEating(ctx: CarePlanComposeContext): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  const nutrition = ctx.ia
    ? firstPersonFromAnswer(ctx.ia.answers, { questionText: 'Nutrition / hydration comments' })
    : null;
  const food =
    firstPersonFromAboutMe(ctx, 'foodPreferences', 'Food likes and dislikes') ??
    (ctx.ia
      ? firstPersonFromAnswer(ctx.ia.answers, {
          questionText: 'Religious or cultural dietary requirements',
        })
      : null);
  return {
    service_user_needs: nutrition ?? undefined,
    needs_person_centred: food ?? undefined,
    support_required: nutrition ?? undefined,
  };
}

function resolveSleeping(ctx: CarePlanComposeContext): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  const night =
    (ctx.ia ? firstPersonFromAnswer(ctx.ia.answers, { fieldKey: 'nightSupport' }) : null) ??
    firstPersonFromAboutMe(ctx, 'nightSupport', 'Night support');
  return {
    service_user_needs: night ?? undefined,
    needs_person_centred: night ?? undefined,
    support_required: night ?? undefined,
  };
}

function resolveMobility(ctx: CarePlanComposeContext): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  if (!ctx.ia) return {};
  const transfer = firstPersonFromAnswer(ctx.ia.answers, { questionText: 'Transfer comments' });
  return {
    service_user_needs: transfer ?? undefined,
    needs_person_centred: transfer ?? undefined,
    support_required: transfer ?? undefined,
  };
}

function resolveCulture(ctx: CarePlanComposeContext): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  if (!ctx.ia) return {};
  const spiritual = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Religious or spiritual needs',
  });
  const prayer = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Prayer routine or worship needs',
  });
  const diet = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Religious or cultural dietary requirements',
  });
  const adjustments = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'Religion, culture, language, reasonable adjustments',
  });
  return {
    service_user_needs: joinUnique([spiritual, diet]) ?? undefined,
    needs_person_centred: joinUnique([spiritual, prayer, adjustments]) ?? undefined,
    support_required: joinUnique([prayer, diet]) ?? undefined,
  };
}

function resolvePersonalSafety(
  ctx: CarePlanComposeContext,
): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  if (!ctx.ia) return {};
  const worried = firstPersonFromAnswer(ctx.ia.answers, {
    questionText: 'What are they worried about?',
  });
  return {
    service_user_needs: worried ?? undefined,
    needs_person_centred: worried ?? undefined,
  };
}

function resolveDementiaOrCognition(
  ctx: CarePlanComposeContext,
): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  const howToSupport =
    (ctx.ia
      ? firstPersonFromAnswer(ctx.ia.answers, { fieldKey: 'howAndWhenToSupportMe' })
      : null) ?? firstPersonFromAboutMe(ctx, 'howToSupport', 'How and when to support me');
  const communication =
    firstPersonFromAboutMe(ctx, 'communication', 'How I communicate') ??
    (ctx.ia ? firstPersonFromAnswer(ctx.ia.answers, { fieldKey: 'communicationNeeds' }) : null);
  return {
    needs_person_centred: howToSupport ?? undefined,
    support_required: joinUnique([howToSupport, communication]) ?? undefined,
  };
}

function resolveForForm(
  formName: string,
  ctx: CarePlanComposeContext,
): Partial<Record<Care2020NarrativeSlot, SlotParts>> {
  switch (formName) {
    case 'Continence':
      return resolveContinence(ctx);
    case 'Washing and dressing':
      return resolveWashing(ctx);
    case 'Communication':
      return resolveCommunication(ctx);
    case 'Pressure Ulcer':
    case 'Skin Integrity':
      return resolveSkinOrPressure(ctx);
    case 'Eating and Drinking':
      return resolveEating(ctx);
    case 'Sleeping and Night':
      return resolveSleeping(ctx);
    case 'Mobility':
      return resolveMobility(ctx);
    case 'Culture/Religion/Spirituality':
      return resolveCulture(ctx);
    case 'Personal Safety':
      return resolvePersonalSafety(ctx);
    case 'Dementia Care plan':
    case 'Cognition and Behaviour':
      return resolveDementiaOrCognition(ctx);
    default:
      return {};
  }
}

function fieldForSlot(
  fields: CarePlanFormFieldRef[],
  prefix: string,
  slot: Care2020NarrativeSlot,
): CarePlanFormFieldRef | undefined {
  const businessKey = `${prefix}_${slot}`;
  return fields.find((field) => field.fieldKey === businessKey);
}

function buildSuggestion(params: {
  prefix: string;
  slot: Care2020NarrativeSlot;
  field: CarePlanFormFieldRef;
  ia: NonNullable<CarePlanComposeContext['ia']>;
  parts: SlotParts;
}): CarePlanFieldSuggestion {
  const { prefix, slot, field, ia, parts } = params;
  const suggestedValue = parts.suggestedValue;
  return {
    id: `care2020:${prefix}:${slot}:${fnv1a(
      `${normalizeFieldLabel(field.label)}|${ia.submissionId}|${suggestedValue}|${parts.sources
        .map((source) => source.questionId)
        .join(',')}`,
    )}`,
    kind: 'value',
    targetFieldKey: field.key,
    targetLabel: field.label,
    targetFieldType: field.fieldType,
    suggestedValue,
    displayText: suggestedValue,
    sourceType: 'INITIAL_ASSESSMENT',
    submissionId: ia.submissionId,
    sourceDate: ia.submittedAt,
    sourceQuestions: parts.sources,
    transform: 'narrative',
    questionId: parts.sources[0]?.questionId,
    questionFieldKey: parts.sources[0]?.questionFieldKey,
    specRef: parts.sources[0]?.specRef,
    sourceSection: parts.sources[0]?.sourceSection,
    sourceLabel: parts.sources[0]?.sourceLabel,
    sourceValue: parts.sources[0]?.sourceValue,
  };
}

/**
 * Append Care 2020 narrative suggestions. Never writes values. Never suggests area-risk.
 */
export function attachCare2020NeedsGoalsSuggestions(
  formName: string,
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  result: ComposePlanResult,
): ComposePlanResult {
  const prefix = CARE_2020_FORM_PREFIX[formName];
  if (!prefix || !ctx.ia) return result;

  const slots = resolveForForm(formName, ctx);
  const existingTargets = new Set((result.suggestions ?? []).map((item) => item.targetFieldKey));
  const additions: CarePlanFieldSuggestion[] = [];

  for (const slot of CARE_2020_NARRATIVE_SLOTS) {
    const parts = slots[slot];
    if (!parts?.suggestedValue) continue;
    const field = fieldForSlot(fields, prefix, slot);
    if (!field || isCare2020AreaRiskOrFollowUpKey(field.fieldKey)) continue;
    if (existingTargets.has(field.key)) continue;
    if (result.values[field.key] != null && result.values[field.key] !== '') continue;
    additions.push(buildSuggestion({ prefix, slot, field, ia: ctx.ia, parts }));
  }

  if (additions.length === 0) return result;

  return {
    ...result,
    suggestions: [...(result.suggestions ?? []), ...additions],
  };
}
