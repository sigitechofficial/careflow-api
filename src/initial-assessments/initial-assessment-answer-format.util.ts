import { Prisma } from '@prisma/client';
import {
  formatPreferredVisitTimesForExport,
  isPreferredVisitTimesFieldKey,
} from './initial-assessment-preferred-visit-times.util';
import { decryptSecureText, isSecureQuestionMetadata } from './initial-assessment-secure-field.util';

type QuestionRow = {
  questionText: string;
  questionType: string;
  options: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
};

type AnswerRow = {
  checked: boolean | null;
  booleanValue: boolean | null;
  textValue: string | null;
  numberValue: Prisma.Decimal | null;
  dateValue: Date | null;
  selectedOptions: Prisma.JsonValue;
};

function optionLabel(options: Prisma.JsonValue, value: string): string {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return value;
  const list = (options as { options?: { value: string; label: string }[] }).options;
  if (!Array.isArray(list)) return value;
  return list.find((o) => o.value === value)?.label ?? value;
}

function isKeySafeQuestion(q: QuestionRow): boolean {
  return q.questionText.toLowerCase().includes('key safe');
}

export function formatInitialAssessmentAnswerForExport(
  q: QuestionRow,
  answer: AnswerRow | undefined,
  opts: { includeSecureFields: boolean },
): string | null {
  if (!answer) return null;

  const maskSecure =
    !opts.includeSecureFields && (isSecureQuestionMetadata(q.metadata) || isKeySafeQuestion(q));

  if (q.questionType === 'CHECKBOX' || q.questionType === 'YES_NO') {
    if (answer.checked === true || answer.booleanValue === true) return 'Yes';
    if (answer.checked === false || answer.booleanValue === false) return 'No';
    return null;
  }

  if (answer.numberValue != null) return String(Number(answer.numberValue));

  if (answer.dateValue) {
    return answer.dateValue.toISOString().slice(0, 10);
  }

  if (answer.textValue?.trim()) {
    if (maskSecure) return '[Withheld — secure field]';
    if (isSecureQuestionMetadata(q.metadata)) {
      return decryptSecureText(answer.textValue) ?? '[Secure value]';
    }
    return answer.textValue.trim();
  }

  const sel = answer.selectedOptions;
  if (isPreferredVisitTimesFieldKey(q.metadata)) {
    return formatPreferredVisitTimesForExport(sel, q.options);
  }
  if (Array.isArray(sel) && sel.length > 0) {
    return sel.map(String).map((v) => optionLabel(q.options, v)).join(', ');
  }
  if (typeof sel === 'string' && sel.trim()) {
    return optionLabel(q.options, sel.trim());
  }
  if (sel && typeof sel === 'object' && !Array.isArray(sel)) {
    const formatted = formatPreferredVisitTimesForExport(sel, q.options);
    if (formatted) return formatted;
  }

  return null;
}

export function isAnsweredForExport(q: QuestionRow, answer: AnswerRow | undefined): boolean {
  return formatInitialAssessmentAnswerForExport(q, answer, { includeSecureFields: false }) != null;
}

type AnswerComparable = {
  checked: boolean | null;
  booleanValue: boolean | null;
  textValue: string | null;
  numberValue: Prisma.Decimal | null;
  dateValue: Date | null;
  timeValue: string | null;
  selectedOptions: Prisma.JsonValue;
  notes: string | null;
};

export function comparableAnswerValue(
  q: Pick<QuestionRow, 'questionType' | 'metadata'>,
  answer: AnswerComparable | undefined,
): string | null {
  if (!answer) return null;
  const secure = isSecureQuestionMetadata(q.metadata);
  if (secure) {
    return answer.textValue?.trim() ? '[secure]' : null;
  }
  return formatInitialAssessmentAnswerForExport(
    { ...q, questionText: '', options: null },
    answer,
    { includeSecureFields: false },
  );
}
