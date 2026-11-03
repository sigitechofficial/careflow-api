import type { Prisma } from '@prisma/client';
import { ADL_WORKSHEET_ACTIVITY_IDS } from './initial-assessment-adl.util';
import {
  CARE_PLAN_RULE_CONDITION_WHEN,
  type CarePlanRuleCondition,
} from './initial-assessment-care-plan-rules.types';
import {
  conditionCandidates,
  type SubmissionAnswerForRules,
} from './initial-assessment-care-plan-rules.util';
import { isBooleanQuestionType } from './initial-assessment-care-plan-triggers.util';

export type RuleTemplateQuestion = {
  id: string;
  questionText: string;
  questionType: string;
  options: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  carePlanTrigger: boolean;
  section: {
    sectionNumber: number;
    title?: string;
    carePlanArea: string | null;
  };
};

export type RuleConditionValidation = { errors: string[]; warnings: string[] };

const FREE_TEXT_TYPES = new Set(['TEXT', 'TEXTAREA']);

function metaOf(q: RuleTemplateQuestion): Record<string, unknown> {
  return q.metadata &&
    typeof q.metadata === 'object' &&
    !Array.isArray(q.metadata)
    ? q.metadata
    : {};
}

/** Template questions in the shape the rule matcher works on (no answer values). */
function asMatchRows(
  questions: RuleTemplateQuestion[],
): SubmissionAnswerForRules[] {
  return questions.map((q) => {
    const meta = metaOf(q);
    return {
      questionId: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      carePlanTrigger: q.carePlanTrigger,
      checked: null,
      booleanValue: null,
      textValue: null,
      selectedOptions: null,
      specRef: typeof meta.specRef === 'string' ? meta.specRef : undefined,
      fieldKey: typeof meta.fieldKey === 'string' ? meta.fieldKey : undefined,
      sectionNumber: q.section.sectionNumber,
      sectionTitle: q.section.title ?? '',
      carePlanArea: q.section.carePlanArea,
    };
  });
}

function optionValues(options: Prisma.JsonValue): string[] {
  const list = Array.isArray(options)
    ? options
    : options &&
        typeof options === 'object' &&
        Array.isArray((options as { options?: unknown }).options)
      ? (options as { options: unknown[] }).options
      : [];
  return list
    .map((o) =>
      o && typeof o === 'object' && !Array.isArray(o)
        ? (o as { value?: unknown }).value
        : o,
    )
    .filter((v): v is string => typeof v === 'string');
}

function describe(condition: CarePlanRuleCondition): string {
  if (condition.adlActivity) return `ADL "${condition.adlActivity}"`;
  return [
    condition.fieldKey ? `fieldKey "${condition.fieldKey}"` : null,
    condition.specRef ? `§${condition.specRef}` : null,
    condition.questionTextContains
      ? `"${condition.questionTextContains}"`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Checks rule conditions against the assessment template. Errors make a condition unusable (it could
 * never match, or is malformed); warnings point at configurations that need a second look.
 */
export function validateRuleConditionsAgainstTemplate(
  conditions: CarePlanRuleCondition[],
  questions: RuleTemplateQuestion[],
): RuleConditionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = asMatchRows(questions);
  const byId = new Map(questions.map((q) => [q.id, q]));

  conditions.forEach((condition, index) => {
    const label = `Condition ${index + 1} (${describe(condition) || 'no question'})`;

    if (
      !(CARE_PLAN_RULE_CONDITION_WHEN as readonly string[]).includes(
        condition.when,
      )
    ) {
      errors.push(`${label}: unknown operator "${String(condition.when)}".`);
      return;
    }

    if (condition.when === 'adl_score_gte') {
      if (
        !condition.adlActivity ||
        !(ADL_WORKSHEET_ACTIVITY_IDS as readonly string[]).includes(
          condition.adlActivity,
        )
      ) {
        errors.push(
          `${label}: "${condition.adlActivity ?? ''}" is not an ADL worksheet activity.`,
        );
        return;
      }
      const score = Number(condition.value);
      if (!Number.isInteger(score) || score < 0 || score > 4) {
        errors.push(
          `${label}: ADL score threshold must be a whole number from 0 to 4.`,
        );
      }
      return;
    }

    if (
      !condition.fieldKey &&
      !condition.specRef &&
      !condition.questionTextContains
    ) {
      errors.push(`${label}: needs a field key, spec ref or question text.`);
      return;
    }
    if (
      (condition.when === 'select_equals' ||
        condition.when === 'text_contains') &&
      !condition.value?.trim()
    ) {
      errors.push(`${label}: "${condition.when}" needs a value.`);
      return;
    }
    if (
      condition.fieldKey &&
      !rows.some((r) => r.fieldKey === condition.fieldKey)
    ) {
      errors.push(
        `${label}: fieldKey "${condition.fieldKey}" is not on the assessment template.`,
      );
      return;
    }

    const candidates = conditionCandidates(condition, rows);
    if (candidates.length === 0) {
      errors.push(`${label}: matches no question on the assessment template.`);
      return;
    }
    const candidateQuestions = candidates
      .map((c) => byId.get(c.questionId)!)
      .filter(Boolean);

    if (condition.when === 'select_equals') {
      const values = new Set(
        candidateQuestions.flatMap((q) => optionValues(q.options)),
      );
      if (values.size > 0 && !values.has(condition.value!)) {
        errors.push(
          `${label}: "${condition.value}" is not an option of the matched question.`,
        );
        return;
      }
    }

    if (
      condition.fieldKey &&
      (condition.specRef || condition.questionTextContains)
    ) {
      warnings.push(
        `${label}: fieldKey is used on its own; spec ref / question text are ignored.`,
      );
    }
    if (!condition.fieldKey && !condition.specRef) {
      warnings.push(
        `${label}: question text alone can match questions in any section — add a spec ref or use a field key.`,
      );
    }
    if (candidates.length > 1) {
      warnings.push(
        `${label}: matches ${candidates.length} questions (${candidateQuestions.map((q) => `"${q.questionText}"`).join(', ')}).`,
      );
    }
    const allFreeText = candidateQuestions.every((q) =>
      FREE_TEXT_TYPES.has(q.questionType),
    );
    if (
      (condition.when === 'yes' || condition.when === 'no') &&
      !candidateQuestions.some((q) => isBooleanQuestionType(q.questionType))
    ) {
      if (allFreeText)
        warnings.push(
          `${label}: a Yes/No condition on a free-text question never matches.`,
        );
    }
    if (
      allFreeText &&
      (condition.when === 'answered' || condition.when === 'text_contains')
    ) {
      warnings.push(
        `${label}: free-text trigger — a typed answer is not structured clinical evidence; needs clinical approval.`,
      );
    }
  });

  return { errors, warnings };
}

export type RuleDiagnosticsRule = {
  id: string;
  carePathwayFormId: string;
  label: string | null;
  matchMode: 'ANY' | 'ALL';
  conditions: CarePlanRuleCondition[];
  suppressLegacyArea: string | null;
  isActive: boolean;
};

export type RuleDiagnosticsForm = {
  id: string;
  name: string;
  isActive: boolean;
  status: string;
  formType: string;
  deletedAt: Date | null;
};

export type RuleTargetStatus =
  | 'OK'
  | 'MISSING'
  | 'DELETED'
  | 'INACTIVE'
  | 'NOT_CARE_PLAN';

export type StarterRuleForDiagnostics = {
  formName: string;
  matchMode?: 'ANY' | 'ALL';
  suppressLegacyArea?: string;
  conditions: CarePlanRuleCondition[];
};

function conditionKey(c: CarePlanRuleCondition): string {
  return JSON.stringify([
    c.when,
    c.fieldKey ?? '',
    c.specRef ?? '',
    c.questionTextContains ?? '',
    c.adlActivity ?? '',
    c.value ?? '',
  ]);
}

/** Read-only health report of the live IA → care plan rule configuration. */
export function diagnoseCarePlanRules(input: {
  rules: RuleDiagnosticsRule[];
  forms: RuleDiagnosticsForm[];
  questions: RuleTemplateQuestion[];
  starterRules: StarterRuleForDiagnostics[];
}) {
  const formById = new Map(input.forms.map((f) => [f.id, f]));
  const areas = new Set(
    input.questions
      .map((q) => q.section.carePlanArea?.trim().toLowerCase())
      .filter((a): a is string => Boolean(a)),
  );
  const rulesPerForm = new Map<string, number>();
  for (const r of input.rules)
    rulesPerForm.set(
      r.carePathwayFormId,
      (rulesPerForm.get(r.carePathwayFormId) ?? 0) + 1,
    );

  const rules = input.rules.map((rule) => {
    const form = formById.get(rule.carePathwayFormId);
    const targetStatus: RuleTargetStatus = !form
      ? 'MISSING'
      : form.deletedAt
        ? 'DELETED'
        : form.formType !== 'CARE_PLAN'
          ? 'NOT_CARE_PLAN'
          : !form.isActive
            ? 'INACTIVE'
            : 'OK';
    const { errors, warnings } = validateRuleConditionsAgainstTemplate(
      rule.conditions,
      input.questions,
    );
    if (targetStatus !== 'OK') {
      errors.unshift(
        targetStatus === 'DELETED'
          ? `Target form "${form!.name}" was deleted on ${form!.deletedAt!.toISOString().slice(0, 10)}; the rule produces no recommendation.`
          : targetStatus === 'MISSING'
            ? 'Target form does not exist; the rule produces no recommendation.'
            : targetStatus === 'INACTIVE'
              ? `Target form "${form!.name}" is inactive; the rule produces no recommendation.`
              : `Target form "${form!.name}" is not a care plan form.`,
      );
    } else if (form!.status !== 'PUBLISHED') {
      warnings.push(
        `Target form "${form!.name}" is ${form!.status}, not PUBLISHED.`,
      );
    }
    if ((rulesPerForm.get(rule.carePathwayFormId) ?? 0) > 1) {
      warnings.push('Another rule targets the same care plan form.');
    }
    if (
      rule.suppressLegacyArea &&
      !areas.has(rule.suppressLegacyArea.trim().toLowerCase())
    ) {
      warnings.push(
        `suppressLegacyArea "${rule.suppressLegacyArea}" matches no assessment section.`,
      );
    }
    return {
      ruleId: rule.id,
      label: rule.label,
      formId: rule.carePathwayFormId,
      formName: form?.name ?? null,
      isActive: rule.isActive,
      targetStatus,
      actionable: rule.isActive && targetStatus === 'OK' && errors.length === 0,
      errors,
      warnings,
    };
  });

  const starterDrift = input.starterRules.map((starter) => {
    const forms = input.forms.filter(
      (f) =>
        !f.deletedAt &&
        f.formType === 'CARE_PLAN' &&
        f.name === starter.formName,
    );
    const live = input.rules.find((r) =>
      forms.some((f) => f.id === r.carePathwayFormId),
    );
    if (!live)
      return {
        formName: starter.formName,
        status: forms.length ? 'NO_RULE' : 'NO_FORM',
        missingConditions: [],
        extraConditions: [],
      };
    const liveKeys = new Set(live.conditions.map(conditionKey));
    const starterKeys = new Set(starter.conditions.map(conditionKey));
    const missingConditions = starter.conditions.filter(
      (c) => !liveKeys.has(conditionKey(c)),
    );
    const extraConditions = live.conditions.filter(
      (c) => !starterKeys.has(conditionKey(c)),
    );
    const settingsDiffer =
      (starter.matchMode ?? 'ANY') !== live.matchMode ||
      (starter.suppressLegacyArea ?? null) !==
        (live.suppressLegacyArea ?? null);
    return {
      formName: starter.formName,
      ruleId: live.id,
      status:
        missingConditions.length ||
        extraConditions.length ||
        settingsDiffer ||
        !live.isActive
          ? 'DIFFERS'
          : 'MATCHES',
      isActive: live.isActive,
      missingConditions,
      extraConditions,
    };
  });

  const legacyFreeTextTriggers = input.questions
    .filter((q) => q.carePlanTrigger && FREE_TEXT_TYPES.has(q.questionType))
    .map((q) => ({
      questionId: q.id,
      questionText: q.questionText,
      sectionNumber: q.section.sectionNumber,
      carePlanArea: q.section.carePlanArea,
    }));

  return {
    rules,
    starterDrift,
    legacyFreeTextTriggers,
    summary: {
      ruleCount: rules.length,
      actionableRuleCount: rules.filter((r) => r.actionable).length,
      rulesWithErrors: rules.filter((r) => r.errors.length > 0).length,
      rulesWithWarnings: rules.filter((r) => r.warnings.length > 0).length,
      starterRulesDiffering: starterDrift.filter((d) => d.status !== 'MATCHES')
        .length,
    },
  };
}
