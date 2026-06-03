export type CarePlanRuleConditionWhen =
  | 'yes'
  | 'no'
  | 'answered'
  | 'not_answered'
  | 'select_equals'
  | 'text_contains';

export type CarePlanRuleCondition = {
  fieldKey?: string;
  specRef?: string;
  questionTextContains?: string;
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
