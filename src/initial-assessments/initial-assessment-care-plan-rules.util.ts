import { Prisma } from '@prisma/client';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';
import {
  CARE_PLAN_RULE_CONDITION_WHEN,
  type CarePlanRecommendationRuleRow,
  type CarePlanRuleCondition,
  type CarePlanRuleConditionWhen,
} from './initial-assessment-care-plan-rules.types';
import { isBooleanQuestionType, isSubstantiveText } from './initial-assessment-care-plan-triggers.util';

export type SubmissionAnswerForRules = {
  questionId: string;
  questionText: string;
  /** InitialAssessmentQuestionType of the question (YES_NO, TEXTAREA, …) when known. */
  questionType?: string;
  /** The question is flagged as a legacy care plan trigger (InitialAssessmentQuestion.carePlanTrigger). */
  carePlanTrigger?: boolean;
  checked: boolean | null;
  booleanValue: boolean | null;
  textValue: string | null;
  selectedOptions: Prisma.JsonValue;
  numberValue?: number | null;
  dateValue?: string | null;
  specRef?: string;
  fieldKey?: string;
  sectionNumber: number;
  sectionTitle: string;
  carePlanArea?: string | null;
};

/** One row of the IA ADL worksheet (submission.metadata.adl.rows); score 0 = does it themself … 4 = done for them. */
export type AdlRowForRules = { id: string; activity: string; score: number };

export type CarePlanRuleEvaluationContext = {
  adlRows?: AdlRowForRules[];
};

/** Section the ADL worksheet belongs to (enterprise spec §12.2–12.5). */
const ADL_SECTION = { sectionNumber: 12, sectionTitle: 'Mobility, ADL and Practical Support' };

function isConditionWhen(value: unknown): value is CarePlanRuleConditionWhen {
  return typeof value === 'string' && (CARE_PLAN_RULE_CONDITION_WHEN as readonly string[]).includes(value);
}

function parseConditions(raw: Prisma.JsonValue): CarePlanRuleCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: CarePlanRuleCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const when = row.when;
    if (!isConditionWhen(when)) continue;
    const fieldKey = typeof row.fieldKey === 'string' ? row.fieldKey : undefined;
    const specRef = typeof row.specRef === 'string' ? row.specRef : undefined;
    const questionTextContains =
      typeof row.questionTextContains === 'string' ? row.questionTextContains : undefined;
    const adlActivity = typeof row.adlActivity === 'string' ? row.adlActivity : undefined;
    if (when === 'adl_score_gte' ? !adlActivity : !fieldKey && !specRef && !questionTextContains) continue;
    out.push({
      fieldKey,
      specRef,
      questionTextContains,
      ...(adlActivity ? { adlActivity } : {}),
      when,
      value: typeof row.value === 'string' ? row.value : undefined,
    });
  }
  return out;
}

function selectedValues(selectedOptions: Prisma.JsonValue): string[] {
  if (!selectedOptions) return [];
  if (Array.isArray(selectedOptions)) return selectedOptions.map(String);
  if (typeof selectedOptions === 'string' && selectedOptions.trim()) return [selectedOptions.trim()];
  return [];
}

/** Select options that mean "nothing to report" — never a positive trigger for a care plan. */
const NEGATIVE_SELECT_VALUE = /^(no|none|no_concern|no_concerns|not_applicable|n\/?a|not_needed)$/i;

function positiveSelections(selectedOptions: Prisma.JsonValue): string[] {
  return selectedValues(selectedOptions).filter((v) => !NEGATIVE_SELECT_VALUE.test(v.trim()));
}

function isBooleanAnswer(answer: SubmissionAnswerForRules): boolean {
  if (answer.questionType) return isBooleanQuestionType(answer.questionType);
  return answer.booleanValue !== null || answer.checked !== null;
}

/** Answered with something meaningful: Yes, a real selection, or text beyond "None" / "N/A". */
export function isAnswerPositiveForRules(answer: SubmissionAnswerForRules): boolean {
  if (answer.checked === true || answer.booleanValue === true) return true;
  if (isSubstantiveText(answer.textValue)) return true;
  return positiveSelections(answer.selectedOptions).length > 0;
}

/**
 * Answers a condition refers to. A `fieldKey` is the stable identifier and is used alone; otherwise
 * `specRef` and `questionTextContains` must BOTH match when both are given. A bare text needle
 * (legacy configuration) still searches every question.
 */
export function conditionCandidates(
  condition: CarePlanRuleCondition,
  answers: SubmissionAnswerForRules[],
): SubmissionAnswerForRules[] {
  if (condition.when === 'adl_score_gte') return [];
  const needle = condition.questionTextContains?.toLowerCase().trim();
  const textMatches = (a: SubmissionAnswerForRules) => !needle || a.questionText.toLowerCase().includes(needle);
  if (condition.fieldKey) return answers.filter((a) => a.fieldKey === condition.fieldKey);
  if (condition.specRef) return answers.filter((a) => a.specRef === condition.specRef && textMatches(a));
  if (needle) return answers.filter(textMatches);
  return [];
}

/**
 * For Yes/No conditions, when the condition also reaches a select or text question (e.g.
 * "Hearing impairment level" next to the derived "Hearing impairment (moderate or worse)?" gate),
 * only the Yes/No question decides.
 */
function evaluationCandidates(
  condition: CarePlanRuleCondition,
  answers: SubmissionAnswerForRules[],
): SubmissionAnswerForRules[] {
  const candidates = conditionCandidates(condition, answers);
  if ((condition.when === 'yes' || condition.when === 'no') && candidates.length > 1) {
    const booleans = candidates.filter(isBooleanAnswer);
    if (booleans.length > 0) return booleans;
  }
  return candidates;
}

function adlTrigger(row: AdlRowForRules): SubmissionAnswerForRules {
  return {
    questionId: `adl-metadata:${row.id}`,
    questionText: `ADL worksheet — ${row.activity}: score ${row.score} of 4`,
    checked: null,
    booleanValue: null,
    textValue: null,
    selectedOptions: null,
    ...ADL_SECTION,
    carePlanArea: null,
  };
}

function matchesAdlCondition(
  condition: CarePlanRuleCondition,
  context: CarePlanRuleEvaluationContext,
): { matched: boolean; triggers: SubmissionAnswerForRules[] } {
  const threshold = Number(condition.value);
  const row = context.adlRows?.find((r) => r.id === condition.adlActivity);
  if (!row || Number.isNaN(threshold) || row.score < threshold) return { matched: false, triggers: [] };
  return { matched: true, triggers: [adlTrigger(row)] };
}

function answerMatches(when: CarePlanRuleConditionWhen, condition: CarePlanRuleCondition, answer: SubmissionAnswerForRules): boolean {
  switch (when) {
    case 'yes':
      if (answer.booleanValue === true || answer.checked === true) return true;
      // A real selection on a select question still reads as "yes" (free text never does).
      return !isBooleanAnswer(answer) && positiveSelections(answer.selectedOptions).length > 0;
    case 'no':
      return answer.booleanValue === false || answer.checked === false;
    case 'answered':
      return isAnswerPositiveForRules(answer);
    case 'not_answered':
      return !isAnswerPositiveForRules(answer);
    case 'select_equals':
      return Boolean(condition.value) && selectedValues(answer.selectedOptions).some((v) => v === condition.value);
    case 'text_contains':
      return Boolean(condition.value) && (answer.textValue ?? '').trim().toLowerCase().includes(condition.value!.toLowerCase());
    default:
      return false;
  }
}

function matchesCondition(
  condition: CarePlanRuleCondition,
  answers: SubmissionAnswerForRules[],
  context: CarePlanRuleEvaluationContext,
): { matched: boolean; triggers: SubmissionAnswerForRules[] } {
  if (condition.when === 'adl_score_gte') return matchesAdlCondition(condition, context);

  const candidates = evaluationCandidates(condition, answers);
  if (candidates.length === 0) {
    return { matched: condition.when === 'not_answered', triggers: [] };
  }
  const triggers = candidates.filter((answer) => answerMatches(condition.when, condition, answer));
  return { matched: triggers.length > 0, triggers };
}

export function ruleConditionsFromJson(raw: Prisma.JsonValue): CarePlanRuleCondition[] {
  return parseConditions(raw);
}

function uniqueByQuestion(triggers: SubmissionAnswerForRules[]): SubmissionAnswerForRules[] {
  return [...new Map(triggers.map((t) => [t.questionId, t])).values()];
}

export function evaluateCarePlanRule(
  rule: CarePlanRecommendationRuleRow,
  answers: SubmissionAnswerForRules[],
  context: CarePlanRuleEvaluationContext = {},
): { matched: boolean; triggers: SubmissionAnswerForRules[] } {
  const conditions = rule.conditions;
  if (conditions.length === 0) return { matched: false, triggers: [] };

  const results = conditions.map((condition) => matchesCondition(condition, answers, context));
  const matched = rule.matchMode === 'ALL' ? results.every((r) => r.matched) : results.some((r) => r.matched);
  if (!matched) return { matched: false, triggers: [] };

  // Every matched condition contributes its evidence.
  const triggers = uniqueByQuestion(results.filter((r) => r.matched).flatMap((r) => r.triggers));
  return { matched: triggers.length > 0, triggers };
}

/**
 * Question ids a rule looks at. When the rule suppresses its legacy area, only these questions
 * are taken out of the legacy fallback — other questions in the same area still count.
 */
export function ruleCoveredQuestionIds(
  rule: CarePlanRecommendationRuleRow,
  answers: SubmissionAnswerForRules[],
): Set<string> {
  return new Set(rule.conditions.flatMap((c) => conditionCandidates(c, answers).map((a) => a.questionId)));
}

export function buildRecommendationsFromRules(
  rules: CarePlanRecommendationRuleRow[],
  answers: SubmissionAnswerForRules[],
  context: CarePlanRuleEvaluationContext = {},
): CarePlanRecommendation[] {
  const recommendations: CarePlanRecommendation[] = [];

  for (const rule of rules) {
    const { matched, triggers } = evaluateCarePlanRule(rule, answers, context);
    if (!matched || triggers.length === 0) continue;

    const ordered = [...triggers].sort((a, b) => a.sectionNumber - b.sectionNumber);
    const first = ordered[0];
    const formName = rule.formName ?? 'Care plan';
    const area = rule.suppressLegacyArea?.trim() || formName;

    recommendations.push({
      id: `rule-${rule.id}`,
      carePlanArea: area,
      sectionNumber: first.sectionNumber,
      sectionTitle: first.sectionTitle,
      title: rule.label?.trim() || `${formName} — recommended`,
      triggerCount: ordered.length,
      triggers: ordered.map((t) => ({
        questionId: t.questionId,
        questionText: t.questionText,
        specRef: t.specRef,
      })),
      status: 'pending',
      carePathwayFormId: rule.carePathwayFormId,
      carePathwayFormName: formName,
      source: 'rule',
      ruleId: rule.id,
    });
  }

  return recommendations.sort((a, b) => a.sectionNumber - b.sectionNumber || a.title.localeCompare(b.title));
}

/** Fold `other` into `target`: evidence is appended (no duplicates) and its ids become aliases. */
export function absorbRecommendation(target: CarePlanRecommendation, other: CarePlanRecommendation): void {
  const seen = new Set(target.triggers.map((t) => t.questionId));
  for (const trigger of other.triggers) {
    if (seen.has(trigger.questionId)) continue;
    target.triggers.push(trigger);
    seen.add(trigger.questionId);
  }
  target.triggerCount = target.triggers.length;
  const aliases = new Set(target.aliasIds ?? []);
  for (const id of [other.id, ...(other.aliasIds ?? [])]) {
    if (id !== target.id) aliases.add(id);
  }
  if (aliases.size > 0) target.aliasIds = [...aliases];
}

/**
 * Legacy area recommendations for an area a matched rule already speaks for are merged into that
 * rule's recommendation (their evidence is kept); other legacy recommendations are kept as they are.
 */
export function mergeCarePlanRecommendations(
  ruleBased: CarePlanRecommendation[],
  legacy: CarePlanRecommendation[],
): CarePlanRecommendation[] {
  const merged = ruleBased.map((r) => ({ ...r, triggers: [...r.triggers] }));
  const byArea = new Map<string, CarePlanRecommendation>();
  for (const rec of merged) {
    const key = rec.carePlanArea.trim().toLowerCase();
    if (key && !byArea.has(key)) byArea.set(key, rec);
  }

  for (const rec of legacy) {
    const target = byArea.get(rec.carePlanArea.trim().toLowerCase());
    if (target) absorbRecommendation(target, rec);
    else merged.push(rec);
  }

  return merged.sort((a, b) => a.sectionNumber - b.sectionNumber || a.title.localeCompare(b.title));
}

const SOURCE_PRIORITY: Record<NonNullable<CarePlanRecommendation['source']>, number> = {
  rule: 0,
  legacy: 1,
  medical_condition: 2,
};

/**
 * One recommendation per care plan form: when several recommendations resolve to the same form,
 * the first rule-based one (else the first legacy one) keeps its id and absorbs the rest.
 * Recommendations without a resolved form are left untouched.
 */
export function mergeRecommendationsByForm(recommendations: CarePlanRecommendation[]): CarePlanRecommendation[] {
  const ordered = recommendations
    .map((rec, index) => ({ rec, index }))
    .sort(
      (a, b) =>
        SOURCE_PRIORITY[a.rec.source ?? 'legacy'] - SOURCE_PRIORITY[b.rec.source ?? 'legacy'] || a.index - b.index,
    );
  const primaryByForm = new Map<string, CarePlanRecommendation>();
  const absorbed = new Set<CarePlanRecommendation>();
  for (const { rec } of ordered) {
    const formId = rec.carePathwayFormId?.trim();
    if (!formId) continue;
    const primary = primaryByForm.get(formId);
    if (!primary) {
      primaryByForm.set(formId, rec);
      continue;
    }
    absorbRecommendation(primary, rec);
    absorbed.add(rec);
  }
  return recommendations.filter((rec) => !absorbed.has(rec));
}

export function submissionAnswersForRules(
  rows: Array<{
    questionId: string;
    checked: boolean | null;
    booleanValue: boolean | null;
    textValue: string | null;
    selectedOptions: Prisma.JsonValue;
    numberValue?: Prisma.Decimal | number | null;
    dateValue?: Date | string | null;
    question: {
      questionText: string;
      questionType?: string;
      carePlanTrigger?: boolean;
      metadata: Prisma.JsonValue;
      section: {
        sectionNumber: number;
        title: string;
        carePlanArea: string | null;
      };
    };
  }>,
): SubmissionAnswerForRules[] {
  return rows.map((a) => {
    const meta =
      a.question.metadata && typeof a.question.metadata === 'object' && !Array.isArray(a.question.metadata)
        ? (a.question.metadata as Record<string, unknown>)
        : {};
    const rawNumber = a.numberValue;
    const numberValue =
      rawNumber == null
        ? null
        : typeof rawNumber === 'number'
          ? rawNumber
          : Number(rawNumber);
    const rawDate = a.dateValue;
    const dateValue =
      rawDate == null
        ? null
        : rawDate instanceof Date
          ? rawDate.toISOString()
          : String(rawDate);
    return {
      questionId: a.questionId,
      questionText: a.question.questionText,
      questionType: a.question.questionType,
      carePlanTrigger: a.question.carePlanTrigger,
      checked: a.checked,
      booleanValue: a.booleanValue,
      textValue: a.textValue,
      selectedOptions: a.selectedOptions,
      numberValue: numberValue != null && !Number.isNaN(numberValue) ? numberValue : null,
      dateValue,
      specRef: typeof meta.specRef === 'string' ? meta.specRef : undefined,
      fieldKey: typeof meta.fieldKey === 'string' ? meta.fieldKey : undefined,
      sectionNumber: a.question.section.sectionNumber,
      sectionTitle: a.question.section.title,
      carePlanArea: a.question.section.carePlanArea,
    };
  });
}
