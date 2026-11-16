/**
 * Vacancy form choices and the questions asked when someone applies (careers page).
 * A question can be a "deal breaker": an answer outside `acceptedAnswers` marks the application in red
 * for staff. Nobody is rejected automatically: a person decides (Equality Act, CQC).
 */

export const WORK_SETTINGS = ['HOME_VISITS', 'CARE_HOME', 'OFFICE', 'LIVE_IN', 'REMOTE'] as const;
export const HOURS_TYPES = ['FULL_TIME', 'PART_TIME', 'FLEXIBLE'] as const;
export const SHIFTS = ['MORNINGS', 'AFTERNOONS', 'EVENINGS', 'NIGHTS', 'WEEKENDS', 'SLEEP_INS', 'LIVE_IN'] as const;
export const CV_REQUIREMENTS = ['REQUIRED', 'OPTIONAL', 'HIDDEN'] as const;
export const NOTIFY_MODES = ['EACH', 'DAILY', 'NONE'] as const;

export const QUESTION_KINDS = [
  'RIGHT_TO_WORK',
  'DRIVING',
  'DBS',
  'DBS_UPDATE_SERVICE',
  'CARE_EXPERIENCE',
  'QUALIFICATION',
  'WEEKENDS',
  'START_DATE',
  'CUSTOM',
] as const;
export const QUESTION_TYPES = ['YES_NO', 'CHOICE', 'TEXT'] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type ScreeningQuestion = {
  id: string;
  kind: QuestionKind;
  text: string;
  type: QuestionType;
  /** CHOICE only. YES_NO answers are "Yes" / "No". */
  options?: string[];
  required: boolean;
  /** Deal breaker: the answers that meet what the job needs (empty or absent = not a deal breaker). */
  acceptedAnswers?: string[];
};

export type ScreeningAnswer = { questionId: string; question: string; answer: string; dealBreakerMissed: boolean };

export const MAX_QUESTIONS = 15;
const MAX_TEXT = 300;
const MAX_OPTIONS = 10;
const MAX_ANSWER = 2000;

/**
 * Normalise questions sent by the vacancy form: trimmed, options only for CHOICE, accepted answers only
 * from the question's own answers, duplicate ids dropped. Throws a readable message for staff.
 */
export function normaliseQuestions(input: unknown): ScreeningQuestion[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error('Questions must be a list.');
  if (input.length > MAX_QUESTIONS) throw new Error(`Ask at most ${MAX_QUESTIONS} questions.`);
  const seen = new Set<string>();
  const out: ScreeningQuestion[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const id = String(raw?.id ?? '').trim().slice(0, 60);
    const text = String(raw?.text ?? '').trim().slice(0, MAX_TEXT);
    const kind = (QUESTION_KINDS as readonly string[]).includes(String(raw?.kind)) ? (raw.kind as QuestionKind) : 'CUSTOM';
    const type = (QUESTION_TYPES as readonly string[]).includes(String(raw?.type)) ? (raw.type as QuestionType) : 'YES_NO';
    if (!id || seen.has(id)) continue;
    if (!text) throw new Error('Every question needs its wording.');
    seen.add(id);
    const options =
      type === 'CHOICE'
        ? [...new Set((Array.isArray(raw.options) ? raw.options : []).map((o) => String(o).trim().slice(0, 120)).filter(Boolean))].slice(
            0,
            MAX_OPTIONS,
          )
        : undefined;
    if (type === 'CHOICE' && (!options || options.length < 2)) throw new Error(`"${text}" needs at least two answers to choose from.`);
    const possible = type === 'YES_NO' ? ['Yes', 'No'] : type === 'CHOICE' ? options! : [];
    const accepted = (Array.isArray(raw.acceptedAnswers) ? raw.acceptedAnswers : [])
      .map((a) => String(a))
      .filter((a) => possible.includes(a));
    out.push({
      id,
      kind,
      text,
      type,
      ...(options ? { options } : {}),
      required: kind === 'RIGHT_TO_WORK' ? true : Boolean(raw.required),
      ...(accepted.length && accepted.length < possible.length ? { acceptedAnswers: [...new Set(accepted)] } : {}),
    });
  }
  return out;
}

/** The questions as applicants see them: never which answers are wanted. */
export function publicQuestions(questions: ScreeningQuestion[]) {
  return questions.map(({ acceptedAnswers: _accepted, ...q }) => q);
}

/**
 * Check an application's answers. Returns what to save, the deal breakers missed (question wording),
 * and problems to show the applicant (a required question not answered, an answer not on the list).
 */
export function evaluateAnswers(
  questions: ScreeningQuestion[],
  given: Record<string, unknown>,
): { answers: ScreeningAnswer[]; missed: string[]; problems: string[] } {
  const answers: ScreeningAnswer[] = [];
  const missed: string[] = [];
  const problems: string[] = [];
  for (const q of questions) {
    const raw = given[q.id];
    const answer = typeof raw === 'string' ? raw.trim().slice(0, MAX_ANSWER) : '';
    if (!answer) {
      if (q.required) problems.push(`Please answer: ${q.text}`);
      continue;
    }
    const possible = q.type === 'YES_NO' ? ['Yes', 'No'] : q.type === 'CHOICE' ? (q.options ?? []) : null;
    if (possible && !possible.includes(answer)) {
      problems.push(`Choose one of the answers for: ${q.text}`);
      continue;
    }
    const dealBreakerMissed = Boolean(q.acceptedAnswers?.length && !q.acceptedAnswers.includes(answer));
    if (dealBreakerMissed) missed.push(q.text);
    answers.push({ questionId: q.id, question: q.text, answer, dealBreakerMissed });
  }
  return { answers, missed, problems };
}

/** A YES_NO question of this kind, answered: true / false; not asked or not answered: undefined. */
export function yesNoAnswerOfKind(questions: ScreeningQuestion[], answers: ScreeningAnswer[], kind: QuestionKind): boolean | undefined {
  const q = questions.find((x) => x.kind === kind && x.type === 'YES_NO');
  const a = q ? answers.find((x) => x.questionId === q.id) : undefined;
  return a ? a.answer === 'Yes' : undefined;
}

const money = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** "12.60 – 13.50", "12.60", or null: the pay text the careers page shows (with the period after it). */
export function payText(min: number | null | undefined, max: number | null | undefined): string | null {
  const lo = min ?? max;
  const hi = max ?? min;
  if (lo == null || hi == null) return null;
  return lo === hi ? `£${money(lo)}` : `£${money(Math.min(lo, hi))} – £${money(Math.max(lo, hi))}`;
}
