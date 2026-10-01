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

/**
 * Medication care plan SELECT labels (must match `MEDICATION_SUPPORT_LEVEL_OPTIONS` in
 * prisma/seeds/medication-care-plan.seed-data.ts — asserted by the compose spec).
 */
export const MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS = {
  selfAdministers: 'Self-administers',
  prompted: 'Prompted',
  assistedByCarer: 'Assisted by carer',
  administeredByCarer: 'Administered by carer',
  providedByOthers: 'Provided by others (family / nurse)',
  nurseOnly: 'Nurse only',
} as const;

const MEDICATION_SUPPORT_LEVEL_CODE_MAP: ReadonlyMap<string, string> = new Map(Object.entries({
  // IA §9.2 codes (MEDICATION_SUPPORT_LEVEL_OPTIONS in initial-assessment-enterprise-options.ts).
  level_0: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.selfAdministers,
  level_1a: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.prompted,
  level_1b: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.assistedByCarer,
  level_2a: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.assistedByCarer,
  level_2b: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.administeredByCarer,
  provided_by_others: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.providedByOthers,
  // Legacy medication-snapshot vocabulary.
  independent: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.selfAdministers,
  prompting: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.prompted,
  packaging: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.assistedByCarer,
  supervision: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.assistedByCarer,
  administration: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.administeredByCarer,
  full_admin: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.administeredByCarer,
  family: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.providedByOthers,
  district_nurse: MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS.nurseOnly,
}));

/**
 * Map IA medication support level codes to Medication care plan SELECT labels.
 *
 * Medication-safety critical: the mapping is exact (1:1) and never overstates or
 * understates what carers do. Anything not recognised — including 'mixed' — returns null
 * so the manager chooses; there is deliberately no fuzzy/substring guessing.
 */
export function mapMedicationSupportLevelToCarePlan(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (!v) return null;
  const mapped = MEDICATION_SUPPORT_LEVEL_CODE_MAP.get(v);
  if (mapped) return mapped;
  // A value that is already one of the care plan labels passes through unchanged.
  const label = Object.values(MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS).find(
    (l) => l.toLowerCase() === v,
  );
  return label ?? null;
}
