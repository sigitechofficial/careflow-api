export type CarePlanRuleConditionWhen =
  | 'yes'
  | 'no'
  | 'answered'
  | 'not_answered'
  | 'select_equals'
  | 'text_contains'
  /** ADL worksheet (submission.metadata.adl) score for `adlActivity` is at least `value` (0–4). */
  | 'adl_score_gte';

export const CARE_PLAN_RULE_CONDITION_WHEN: readonly CarePlanRuleConditionWhen[] = [
  'yes',
  'no',
  'answered',
  'not_answered',
  'select_equals',
  'text_contains',
  'adl_score_gte',
];

export type CarePlanRuleCondition = {
  fieldKey?: string;
  specRef?: string;
  questionTextContains?: string;
  /** ADL worksheet activity id (initial-assessment-adl.util ADL_WORKSHEET_ACTIVITY_IDS). */
  adlActivity?: string;
  when: CarePlanRuleConditionWhen;
  value?: string;
};

export type CarePlanRecommendationRuleRow = {
  id: string;
  carePathwayFormId: string;
  label: string | null;
  matchMode: 'ANY' | 'ALL';
  conditions: CarePlanRuleCondition[];
  suppressLegacyArea: string | null;
  sortOrder: number;
  isActive: boolean;
  formName?: string;
};
