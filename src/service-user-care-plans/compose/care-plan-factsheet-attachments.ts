/** Maps care plan template names to attached condition factsheet codes. */
export const CARE_PLAN_FACTSHEET_ATTACHMENTS: Record<string, string[]> = {
  'Dementia Care plan': ['dementia'],
  Medication: ['medication'],
  Falls: ['falls'],
  'Risk Assessment and Care Plan': ['falls', 'medication'],
};

export function factsheetCodesForCarePlan(formName: string | null | undefined): string[] {
  if (!formName?.trim()) return [];
  return CARE_PLAN_FACTSHEET_ATTACHMENTS[formName.trim()] ?? [];
}
