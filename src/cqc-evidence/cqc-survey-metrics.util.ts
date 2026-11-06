import type { SurveyQuestionType } from '@prisma/client';
import { MIN_ANONYMOUS_GROUP_SIZE } from '../surveys/survey-breakdown.util';
import {
  DEFAULT_LIKERT_OPTIONS,
  currentAnswerLabels,
  readNotCountedOptions,
} from '../surveys/survey-question-config.util';

/**
 * Survey results kept as CQC evidence: counts, response rate and "top two" percentages for scale
 * questions only. Never individual answers, free text or who answered.
 *
 * Nothing is broken down below CQC_MIN_REPORTING_RESPONSES responses (the anonymity threshold the
 * survey results use), and a question answered by fewer people than that shows no percentage.
 */
export const CQC_MIN_REPORTING_RESPONSES = MIN_ANONYMOUS_GROUP_SIZE;

/** The first question of every library survey for people we support and families. */
export const OVERALL_QUESTION_TEXT = 'Overall, how was your experience of our service?';
/** Its question key in the ready-made library (kept on copies, so a reworded copy is still found). */
export const OVERALL_QUESTION_KEY = 'q-overall';

/** Five-point scales and which answers count as positive ("top two box"). */
export const POSITIVE_SCALES: ReadonlyArray<{ labels: readonly string[]; positive: readonly string[] }> = [
  { labels: ['Very good', 'Good', 'Neither good nor poor', 'Poor', 'Very poor'], positive: ['Very good', 'Good'] },
  { labels: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'], positive: ['Always', 'Usually'] },
  {
    labels: ['Strongly agree', 'Agree', 'Neither agree nor disagree', 'Disagree', 'Strongly disagree'],
    positive: ['Strongly agree', 'Agree'],
  },
  {
    labels: ['Very satisfied', 'Satisfied', 'Neither satisfied nor dissatisfied', 'Dissatisfied', 'Very dissatisfied'],
    positive: ['Very satisfied', 'Satisfied'],
  },
];

/** Answers left out of the percentage base. */
export const EXCLUDED_ANSWERS: readonly string[] = ["Don't know", 'Does not apply to me', 'Not applicable', 'Prefer not to say'];

export type MetricsQuestion = {
  id: string;
  questionText: string;
  questionType: SurveyQuestionType | string;
  options: unknown;
  sectionTitle: string | null;
  sortOrder: number;
  /** The question key ("q-overall" for the overall-experience question). */
  key?: string | null;
  /** Its settings: answers marked "Not counted in percentages" are left out of the base. */
  config?: unknown;
};

/** Only the chosen option labels are read; text, numbers and notes never reach this code. */
export type MetricsAnswer = { questionId: string; selectedOptions: unknown };

export type QuestionResult = {
  questionText: string;
  sectionTitle: string | null;
  positiveLabels: string[];
  /** People who gave a scale answer (excluding "Don't know" and similar). */
  base: number;
  positive: number | null;
  percent: number | null;
  /** True when fewer than the threshold answered, so no percentage is kept. */
  suppressed: boolean;
};

export type CqcSurveyMetrics = {
  kind: 'survey-result';
  version: 1;
  surveyId: string;
  surveyTitle: string;
  seriesId: string | null;
  periodKey: string | null;
  audience: string;
  anonymous: boolean;
  libraryReference: string | null;
  /** People the survey was sent to; null for a shared public link. */
  recipients: number | null;
  completed: number;
  responses: number;
  /**
   * Named surveys: responses given without a name (online, or recorded by staff without one) and
   * their share of all responses. Absent on older evidence; null on anonymous surveys.
   */
  answeredWithoutName?: number | null;
  answeredWithoutNamePercent?: number | null;
  /** completed / recipients, whole per cent; null for a shared public link or nobody sent to. */
  responseRate: number | null;
  threshold: number;
  /** Fewer responses than the threshold: no percentages are kept at all. */
  suppressed: boolean;
  note: string | null;
  headline: QuestionResult | null;
  questions: QuestionResult[];
  capturedAt: string;
};

const answerLabels = (q: MetricsQuestion, selected: unknown): string[] => {
  const raw = Array.isArray(selected) ? selected.filter((v): v is string => typeof v === 'string') : [];
  try {
    return currentAnswerLabels(q.questionType as SurveyQuestionType, q.options, raw);
  } catch {
    return raw;
  }
};

/** The options a question offers (the built-in agree scale for a Likert question without its own). */
export function questionOptions(q: Pick<MetricsQuestion, 'questionType' | 'options'>): string[] {
  const list = Array.isArray(q.options) ? q.options.filter((v): v is string => typeof v === 'string') : [];
  if (q.questionType === 'LIKERT' && !list.length) return [...DEFAULT_LIKERT_OPTIONS];
  return list;
}

/** The positive answers of a question's scale, or null when it is not a recognised five-point scale. */
export function positiveLabelsFor(q: Pick<MetricsQuestion, 'questionType' | 'options'>): string[] | null {
  if (q.questionType !== 'LIKERT' && q.questionType !== 'SINGLE_SELECT') return null;
  const options = questionOptions(q).map((o) => o.trim());
  const scale = POSITIVE_SCALES.find((sc) => sc.labels.filter((l) => options.includes(l)).length >= 3);
  return scale ? [...scale.positive] : null;
}

/**
 * The overall-experience question: the library's question key, else the house-style wording, else
 * the first "Overall …" question on the "Very good … Very poor" scale.
 */
export function findOverallQuestion<Q extends MetricsQuestion>(questions: readonly Q[]): Q | null {
  const ordered = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);
  const byKey = ordered.find((q) => q.key === OVERALL_QUESTION_KEY && positiveLabelsFor(q));
  if (byKey) return byKey;
  const exact = ordered.find((q) => q.questionText.trim() === OVERALL_QUESTION_TEXT && positiveLabelsFor(q));
  if (exact) return exact;
  return (
    ordered.find((q) => /^overall\b/i.test(q.questionText.trim()) && positiveLabelsFor(q)?.includes('Very good')) ??
    null
  );
}

export function questionResult(q: MetricsQuestion, answers: readonly MetricsAnswer[], threshold = CQC_MIN_REPORTING_RESPONSES): QuestionResult | null {
  const positiveLabels = positiveLabelsFor(q);
  if (!positiveLabels) return null;
  const scaleLabels = new Set(POSITIVE_SCALES.find((s) => s.positive[0] === positiveLabels[0])?.labels ?? []);
  // Answers marked "Not counted in percentages" on the question are left out too.
  const excluded = new Set([...EXCLUDED_ANSWERS, ...readNotCountedOptions(q.config)]);
  let base = 0;
  let positive = 0;
  for (const a of answers) {
    if (a.questionId !== q.id) continue;
    const labels = answerLabels(q, a.selectedOptions).filter((l) => !excluded.has(l));
    const onScale = labels.filter((l) => scaleLabels.has(l));
    if (!onScale.length) continue;
    base += 1;
    if (onScale.some((l) => positiveLabels.includes(l))) positive += 1;
  }
  const suppressed = base < threshold;
  return {
    questionText: q.questionText.trim(),
    sectionTitle: q.sectionTitle,
    positiveLabels,
    base,
    positive: suppressed ? null : positive,
    percent: suppressed || base === 0 ? null : Math.round((positive / base) * 100),
    suppressed,
  };
}

export type BuildSurveyMetricsInput = {
  survey: {
    id: string;
    title: string;
    targetKind: string;
    isAnonymous: boolean;
    periodKey: string | null;
    clonedFromId: string | null;
  };
  libraryReference: string | null;
  recipients: number;
  completed: number;
  responses: number;
  /** Named surveys: responses not linked to anyone (given or recorded without a name). */
  answeredWithoutName?: number;
  questions: readonly MetricsQuestion[];
  answers: readonly MetricsAnswer[];
  /** Questions that evidence this statement (null = every scale question, capped). */
  questionIds: ReadonlySet<string> | null;
  now: Date;
  threshold?: number;
};

const MAX_QUESTIONS = 12;

/** The figures one evidence item keeps for one quality statement. */
export function buildSurveyMetrics(input: BuildSurveyMetricsInput): CqcSurveyMetrics {
  const threshold = input.threshold ?? CQC_MIN_REPORTING_RESPONSES;
  const isPublic = input.survey.targetKind === 'PUBLIC';
  const suppressed = input.responses < threshold;
  const overall = findOverallQuestion(input.questions);
  const headline = !suppressed && overall ? questionResult(overall, input.answers, threshold) : null;
  const questions = suppressed
    ? []
    : [...input.questions]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((q) => q.id !== overall?.id && (!input.questionIds || input.questionIds.has(q.id)))
        .map((q) => questionResult(q, input.answers, threshold))
        .filter((r): r is QuestionResult => r !== null)
        .slice(0, MAX_QUESTIONS);
  return {
    kind: 'survey-result',
    version: 1,
    surveyId: input.survey.id,
    surveyTitle: input.survey.title,
    seriesId: input.survey.clonedFromId,
    periodKey: input.survey.periodKey,
    audience: input.survey.targetKind,
    anonymous: input.survey.isAnonymous,
    libraryReference: input.libraryReference,
    recipients: isPublic ? null : input.recipients,
    completed: input.completed,
    responses: input.responses,
    answeredWithoutName: input.survey.isAnonymous ? null : (input.answeredWithoutName ?? 0),
    answeredWithoutNamePercent:
      input.survey.isAnonymous || input.responses <= 0
        ? null
        : Math.round(((input.answeredWithoutName ?? 0) / input.responses) * 100),
    responseRate: isPublic || input.recipients <= 0 ? null : Math.round((input.completed / input.recipients) * 100),
    threshold,
    suppressed,
    note: suppressed
      ? `Fewer than ${threshold} responses, so results are not broken down to protect the people who answered.`
      : null,
    headline,
    questions,
    capturedAt: input.now.toISOString(),
  };
}

/** One-line summary for the evidence list: "42 responses (38% of 110 asked). 86% said Very good or Good overall." */
export function surveyMetricsSummary(m: CqcSurveyMetrics): string {
  const parts: string[] = [];
  const responses = `${m.responses} response${m.responses === 1 ? '' : 's'}`;
  parts.push(
    m.responseRate !== null && m.recipients
      ? `${responses} (${m.responseRate}% of ${m.recipients} asked).`
      : `${responses}.`,
  );
  if (m.answeredWithoutName && m.answeredWithoutNamePercent !== null && m.answeredWithoutNamePercent !== undefined) {
    parts.push(`${m.answeredWithoutName} (${m.answeredWithoutNamePercent}%) answered without their name.`);
  }
  if (m.suppressed) parts.push(`Fewer than ${m.threshold} responses, so no breakdown is kept.`);
  else if (m.headline?.percent !== null && m.headline?.percent !== undefined) {
    parts.push(`${m.headline.percent}% said ${m.headline.positiveLabels.join(' or ')} overall.`);
  }
  return parts.join(' ');
}
