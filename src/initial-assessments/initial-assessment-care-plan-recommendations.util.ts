import type {
  CarePlanRecommendation,
  CarePlanTriggerItem,
} from './initial-assessment-care-plan.util';
import { buildCarePlanRecommendations } from './initial-assessment-care-plan.util';
import type { CarePlanRecommendationRuleRow } from './initial-assessment-care-plan-rules.types';
import {
  buildRecommendationsFromRules,
  mergeCarePlanRecommendations,
  mergeRecommendationsByForm,
  ruleCoveredQuestionIds,
  type AdlRowForRules,
  type SubmissionAnswerForRules,
} from './initial-assessment-care-plan-rules.util';
import {
  enrichCarePlanRecommendationsWithForms,
  type CarePlanCatalogueRow,
} from './initial-assessment-care-plan-area-map.util';
import {
  buildRecommendationsFromMedicalConditions,
  mergeMedicalConditionRecommendations,
  type ActiveConditionForCarePlan,
} from './medical-condition-care-plan-map.util';
import { isCarePlanTriggerPositive } from './initial-assessment-care-plan-triggers.util';

export type CarePlanRecommendationInputs = {
  /** Active rules. Rules whose form is not in `catalogue` are ignored (never actionable). */
  rules: CarePlanRecommendationRuleRow[];
  /** All saved answers of the submission, shaped for rule evaluation. */
  answers: SubmissionAnswerForRules[];
  /** Care plan forms recommendations may target (not deleted, active). */
  catalogue: CarePlanCatalogueRow[];
  /** Active medical conditions; null when the submission has no service user. */
  medicalConditions: ActiveConditionForCarePlan[] | null;
  /** Questions currently shown on the assessment; answers to hidden questions are ignored. */
  visibleQuestionIds?: Set<string>;
  /** ADL worksheet rows (submission.metadata.adl.rows). */
  adlRows?: AdlRowForRules[];
};

/** A flagged (`carePlanTrigger`) question whose answer counts as positive. */
export function isLegacyCarePlanTriggerAnswer(
  answer: SubmissionAnswerForRules,
): boolean {
  return Boolean(answer.carePlanTrigger) && isCarePlanTriggerPositive(answer);
}

/** Legacy area-fallback trigger items from the submission answers. */
export function legacyTriggerItemsFromAnswers(
  answers: SubmissionAnswerForRules[],
): CarePlanTriggerItem[] {
  return answers.filter(isLegacyCarePlanTriggerAnswer).map((a) => ({
    answerId: a.questionId,
    questionId: a.questionId,
    questionText: a.questionText,
    notes: null,
    textValue: null,
    section: {
      id: `section-${a.sectionNumber}`,
      title: a.sectionTitle,
      sectionNumber: a.sectionNumber,
      carePlanArea: a.carePlanArea,
    },
    carePlanArea: a.carePlanArea,
    specRef: a.specRef,
  }));
}

/**
 * Legacy triggers a rule speaks for: a rule that suppresses a legacy area takes over only the
 * questions it actually refers to, not every question in that area.
 */
function legacyItemsNotCoveredByRules(
  items: CarePlanTriggerItem[],
  rules: CarePlanRecommendationRuleRow[],
  answers: SubmissionAnswerForRules[],
): CarePlanTriggerItem[] {
  const coveredByArea = new Map<string, Set<string>>();
  for (const rule of rules) {
    const area = rule.suppressLegacyArea?.trim().toLowerCase();
    if (!area) continue;
    const covered = coveredByArea.get(area) ?? new Set<string>();
    for (const id of ruleCoveredQuestionIds(rule, answers)) covered.add(id);
    coveredByArea.set(area, covered);
  }
  return items.filter((item) => {
    const area = (item.carePlanArea ?? item.section?.carePlanArea ?? '')
      .trim()
      .toLowerCase();
    return !coveredByArea.get(area)?.has(item.questionId);
  });
}

/**
 * Pure recommendation pipeline behind `InitialAssessmentCarePlanRulesService.resolveRecommendations`:
 * rules → legacy area fallback → form enrichment → one recommendation per form → medical conditions.
 */
export function computeCarePlanRecommendations(
  input: CarePlanRecommendationInputs,
): CarePlanRecommendation[] {
  const { catalogue, medicalConditions, visibleQuestionIds } = input;
  const availableFormIds = new Set(catalogue.map((f) => f.id));
  const rules = input.rules.filter((r) =>
    availableFormIds.has(r.carePathwayFormId),
  );
  const answers = visibleQuestionIds
    ? input.answers.filter((a) => visibleQuestionIds.has(a.questionId))
    : input.answers;

  const legacy = buildCarePlanRecommendations(
    legacyItemsNotCoveredByRules(
      legacyTriggerItemsFromAnswers(answers),
      rules,
      answers,
    ),
  );
  let merged =
    rules.length === 0
      ? legacy
      : mergeCarePlanRecommendations(
          buildRecommendationsFromRules(rules, answers, {
            adlRows: input.adlRows,
          }),
          legacy,
        );

  enrichCarePlanRecommendationsWithForms(merged, catalogue);
  merged = mergeRecommendationsByForm(merged);

  if (medicalConditions) {
    merged = mergeMedicalConditionRecommendations(
      merged,
      buildRecommendationsFromMedicalConditions(medicalConditions, catalogue),
    );
  }

  return merged;
}
