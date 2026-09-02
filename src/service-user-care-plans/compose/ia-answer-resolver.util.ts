import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

export type IaAnswerQuery = {
  fieldKey?: string;
  specRef?: string;
  questionTextContains?: string;
};

function selectedValues(selectedOptions: SubmissionAnswerForRules['selectedOptions']): string[] {
  if (!selectedOptions) return [];
  if (Array.isArray(selectedOptions)) return selectedOptions.map(String);
  if (typeof selectedOptions === 'string' && selectedOptions.trim()) return [selectedOptions.trim()];
  if (typeof selectedOptions === 'object') {
    const row = selectedOptions as Record<string, unknown>;
    if (typeof row.value === 'string' && row.value.trim()) return [row.value.trim()];
  }
  return [];
}

function matchesQuery(answer: SubmissionAnswerForRules, query: IaAnswerQuery): boolean {
  const needle = query.questionTextContains?.toLowerCase().trim();
  if (query.fieldKey && answer.fieldKey === query.fieldKey) return true;
  if (query.specRef && answer.specRef === query.specRef) {
    if (!needle) return true;
    return answer.questionText.toLowerCase().includes(needle);
  }
  if (needle && answer.questionText.toLowerCase().includes(needle)) return true;
  return false;
}

export function findIaAnswer(
  answers: SubmissionAnswerForRules[],
  query: IaAnswerQuery,
): SubmissionAnswerForRules | undefined {
  return answers.find((a) => matchesQuery(a, query));
}

export function resolveIaDisplayValue(answer: SubmissionAnswerForRules | undefined): string | null {
  if (!answer) return null;
  if (answer.checked === true || answer.booleanValue === true) return 'Yes';
  if (answer.checked === false || answer.booleanValue === false) return 'No';
  if (answer.textValue?.trim()) return answer.textValue.trim();
  const selected = selectedValues(answer.selectedOptions);
  if (selected.length > 0) return selected.join(', ');
  return null;
}

export function resolveIaRawValue(answer: SubmissionAnswerForRules | undefined): string | null {
  if (!answer) return null;
  if (answer.checked === true || answer.booleanValue === true) return 'yes';
  if (answer.checked === false || answer.booleanValue === false) return 'no';
  if (answer.textValue?.trim()) return answer.textValue.trim();
  const selected = selectedValues(answer.selectedOptions);
  if (selected.length > 0) return selected[0] ?? null;
  return null;
}

export function resolveIaBooleanYes(answer: SubmissionAnswerForRules | undefined): boolean {
  const raw = resolveIaRawValue(answer);
  if (!raw) return false;
  return raw.toLowerCase() === 'yes' || raw === 'true';
}

export function resolveIaBooleanValue(answer: SubmissionAnswerForRules | undefined): boolean | null {
  if (!answer) return null;
  if (answer.checked === true || answer.booleanValue === true) return true;
  if (answer.checked === false || answer.booleanValue === false) return false;
  return null;
}

export function resolveIaNumberValue(answer: SubmissionAnswerForRules | undefined): number | null {
  if (!answer) return null;
  if (answer.numberValue != null && !Number.isNaN(Number(answer.numberValue))) {
    return Number(answer.numberValue);
  }
  if (answer.textValue?.trim()) {
    const n = Number(answer.textValue.trim());
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

export function resolveIaDateIso(answer: SubmissionAnswerForRules | undefined): string | null {
  if (!answer?.dateValue) return null;
  const raw = answer.dateValue;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw.trim() ? raw : null;
  }
  return date.toISOString();
}

/** Map IA medication support level codes to Medication care plan SELECT labels. */
export function mapMedicationSupportLevelToCarePlan(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'level_0' || v === 'independent') return 'Self-administers';
  if (v === 'level_1a' || v === 'prompting') return 'Prompted';
  if (v === 'level_1b' || v === 'packaging' || v === 'supervision') return 'Administered by carer';
  if (v === 'level_2a' || ['administration', 'full_admin', 'mixed', 'family'].includes(v)) {
    return 'Administered by carer';
  }
  if (v === 'level_2b' || v === 'district_nurse') return 'Nurse only';
  if (v.includes('prompt')) return 'Prompted';
  if (v.includes('independ') || v === 'level_0') return 'Self-administers';
  if (v.includes('nurse')) return 'Nurse only';
  if (v.includes('admin') || v.includes('carer')) return 'Administered by carer';
  return null;
}
