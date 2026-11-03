import { Prisma } from '@prisma/client';
import { shouldShowQuestionForValidation } from './initial-assessment-conditional-visibility.util';

/**
 * Free text recorded "for the record" that states nothing is needed. These are never read as a care
 * need — this list only *removes* triggers, it never creates one.
 */
const NON_ANSWER_TEXT =
  /^(none|no|nil|nothing|nothing to report|n\/?a|na|not applicable|no concerns?|no issues?|not required|not needed|-+|\.+)$/i;

export function isNonAnswerText(text: string | null | undefined): boolean {
  const normalized = (text ?? '')
    .trim()
    .replace(/[.!]+$/, '')
    .trim();
  if (!normalized) return true;
  return NON_ANSWER_TEXT.test(normalized);
}

/** Text that says something beyond "none" / "n/a". */
export function isSubstantiveText(text: string | null | undefined): boolean {
  return !isNonAnswerText(text);
}

const BOOLEAN_QUESTION_TYPES = new Set(['YES_NO', 'CHECKBOX']);

export function isBooleanQuestionType(
  questionType: string | undefined,
): boolean {
  return questionType !== undefined && BOOLEAN_QUESTION_TYPES.has(questionType);
}

/**
 * Whether a saved answer to a `carePlanTrigger` question counts as positive for the legacy
 * area fallback. Yes/No and checkbox questions are positive only when ticked Yes — text saved
 * alongside a "No" is context, not a trigger. Other types keep the previous rule (Yes or text),
 * except that "None" / "N/A"-style text no longer counts.
 */
export function isCarePlanTriggerPositive(answer: {
  questionType?: string;
  checked: boolean | null;
  booleanValue: boolean | null;
  textValue: string | null;
}): boolean {
  if (answer.checked === true || answer.booleanValue === true) return true;
  if (isBooleanQuestionType(answer.questionType)) return false;
  return isSubstantiveText(answer.textValue);
}

export type VisibilityQuestionRow = {
  id: string;
  questionText: string;
  metadata: Prisma.JsonValue;
  section: { sectionNumber: number };
};

export type VisibilityAnswerRow = {
  questionId: string;
  checked: boolean | null;
  booleanValue: boolean | null;
  selectedOptions?: Prisma.JsonValue;
};

/**
 * Question ids currently shown on the assessment (same gates as submit validation). Answers to
 * questions hidden by a gate are kept in the database but must not drive recommendations.
 */
export function visibleQuestionIdsForSubmission(
  questions: VisibilityQuestionRow[],
  answers: VisibilityAnswerRow[],
): Set<string> {
  const map = new Map(answers.map((a) => [a.questionId, a]));
  const visible = new Set<string>();
  for (const q of questions) {
    if (shouldShowQuestionForValidation(q, questions, map)) visible.add(q.id);
  }
  return visible;
}
