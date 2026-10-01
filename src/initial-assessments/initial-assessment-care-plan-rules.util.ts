import { Prisma } from '@prisma/client';
import type { CarePlanRecommendation, CarePlanTriggerItem } from './initial-assessment-care-plan.util';
import type {
  CarePlanRecommendationRuleRow,
  CarePlanRuleCondition,
} from './initial-assessment-care-plan-rules.types';

export type SubmissionAnswerForRules = {
  questionId: string;
  questionText: string;
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

function parseConditions(raw: Prisma.JsonValue): CarePlanRuleCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: CarePlanRuleCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const when = row.when;
    if (
      when !== 'yes' &&
      when !== 'no' &&
      when !== 'answered' &&
      when !== 'not_answered' &&
      when !== 'select_equals' &&
      when !== 'text_contains'
    ) {
      continue;
    }
    const fieldKey = typeof row.fieldKey === 'string' ? row.fieldKey : undefined;
    const specRef = typeof row.specRef === 'string' ? row.specRef : undefined;
    const questionTextContains =
      typeof row.questionTextContains === 'string' ? row.questionTextContains : undefined;
    if (!fieldKey && !specRef && !questionTextContains) continue;
    out.push({
      fieldKey,
      specRef,
      questionTextContains,
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

export function isAnswerPositiveForRules(answer: SubmissionAnswerForRules): boolean {
  if (answer.checked === true || answer.booleanValue === true) return true;
  if (answer.textValue?.trim()) return true;
  return positiveSelections(answer.selectedOptions).length > 0;
}

function matchesCondition(
  condition: CarePlanRuleCondition,
  answers: SubmissionAnswerForRules[],
): { matched: boolean; trigger?: SubmissionAnswerForRules } {
  const needle = condition.questionTextContains?.toLowerCase().trim();
  const candidates = answers.filter((a) => {
    if (condition.fieldKey && a.fieldKey === condition.fieldKey) return true;
    if (condition.specRef && a.specRef === condition.specRef) {
      if (!needle) return true;
      return a.questionText.toLowerCase().includes(needle);
    }
    if (needle && a.questionText.toLowerCase().includes(needle)) return true;
    return false;
  });

  if (candidates.length === 0) {
    return { matched: condition.when === 'not_answered' };
  }

  for (const answer of candidates) {
    const positive = isAnswerPositiveForRules(answer);
    const sel = selectedValues(answer.selectedOptions);
    const text = answer.textValue?.trim().toLowerCase() ?? '';

    switch (condition.when) {
      case 'yes':
        if (answer.booleanValue === true || answer.checked === true) {
          return { matched: true, trigger: answer };
        }
        if (positive && answer.booleanValue !== false && answer.checked !== false) {
          return { matched: true, trigger: answer };
        }
        break;
      case 'no':
        if (answer.booleanValue === false || answer.checked === false) {
          return { matched: true, trigger: answer };
        }
        break;
      case 'answered':
        if (positive) return { matched: true, trigger: answer };
        break;
      case 'not_answered':
        if (!positive) return { matched: true, trigger: answer };
        break;
      case 'select_equals':
        if (condition.value && sel.some((v) => v === condition.value)) {
          return { matched: true, trigger: answer };
        }
        break;
      case 'text_contains':
        if (condition.value && text.includes(condition.value.toLowerCase())) {
          return { matched: true, trigger: answer };
        }
        break;
      default:
        break;
    }
  }

  return { matched: false };
}

export function ruleConditionsFromJson(raw: Prisma.JsonValue): CarePlanRuleCondition[] {
  return parseConditions(raw);
}

export function evaluateCarePlanRule(
  rule: CarePlanRecommendationRuleRow,
  answers: SubmissionAnswerForRules[],
): { matched: boolean; triggers: SubmissionAnswerForRules[] } {
  const conditions = rule.conditions;
  if (conditions.length === 0) return { matched: false, triggers: [] };

  const hits: SubmissionAnswerForRules[] = [];

  if (rule.matchMode === 'ANY') {
    for (const condition of conditions) {
      const result = matchesCondition(condition, answers);
      if (result.matched) {
        const triggers = result.trigger ? [result.trigger] : hits;
        return { matched: true, triggers };
      }
    }
    return { matched: false, triggers: [] };
  }

  for (const condition of conditions) {
    const result = matchesCondition(condition, answers);
    if (!result.matched) return { matched: false, triggers: [] };
    if (result.trigger) hits.push(result.trigger);
  }

  const unique = [...new Map(hits.map((t) => [t.questionId, t])).values()];
  return { matched: unique.length === conditions.length, triggers: unique };
}

export function buildRecommendationsFromRules(
  rules: CarePlanRecommendationRuleRow[],
  answers: SubmissionAnswerForRules[],
): CarePlanRecommendation[] {
  const recommendations: CarePlanRecommendation[] = [];

  for (const rule of rules) {
    const { matched, triggers } = evaluateCarePlanRule(rule, answers);
    if (!matched || triggers.length === 0) continue;

    const first = triggers[0];
    const formName = rule.formName ?? 'Care plan';
    const area = rule.suppressLegacyArea?.trim() || formName;

    recommendations.push({
      id: `rule-${rule.id}`,
      carePlanArea: area,
      sectionNumber: first.sectionNumber,
      sectionTitle: first.sectionTitle,
      title: rule.label?.trim() || `${formName} — recommended`,
      triggerCount: triggers.length,
      triggers: triggers.map((t) => ({
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

export function mergeCarePlanRecommendations(
  ruleBased: CarePlanRecommendation[],
  legacy: CarePlanRecommendation[],
  suppressAreasFromRules: string[] = [],
): CarePlanRecommendation[] {
  const suppressedAreas = new Set(
    [
      ...ruleBased.map((r) => r.carePlanArea.trim().toLowerCase()),
      ...suppressAreasFromRules.map((a) => a.trim().toLowerCase()),
    ].filter(Boolean),
  );

  const filteredLegacy = legacy.filter((rec) => !suppressedAreas.has(rec.carePlanArea.trim().toLowerCase()));
  return [...ruleBased, ...filteredLegacy].sort(
    (a, b) => a.sectionNumber - b.sectionNumber || a.title.localeCompare(b.title),
  );
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
