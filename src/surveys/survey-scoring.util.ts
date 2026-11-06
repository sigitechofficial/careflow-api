/**
 * Scores for scored tools (Phase 2 part 5): HSE-indicator style scales (the average of 1–5 answers per area, some
 * questions reversed) and audit scores (the share of the most a person could score). Survey.scoring holds the scales;
 * scores are worked out from the answers when the results are shown, under the same reporting threshold, and bands
 * are listed only when every band shown holds at least SCORE_BAND_MIN people.
 */
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_LIKERT_OPTIONS, ratingRange, readNotCountedOptions } from './survey-question-config.util';

export const SCORE_METHODS = ['MEAN', 'PERCENT_OF_MAX'] as const;
export type ScoreMethod = (typeof SCORE_METHODS)[number];
export const SCORE_BAND_MIN = 3;
export const MAX_SCALES = 12;

export type ScoreBand = { from: number; label: string };
export type ScoreScale = {
  key: string;
  label: string;
  /** Question keys (SurveyQuestion.key) scored on this scale. */
  questionKeys: string[];
  /** Question keys scored the other way round (agreeing is the worse answer). */
  reversed: string[];
  method: ScoreMethod;
  /** Bands from the lowest "from" up: a score falls in the last band whose "from" it reaches. */
  bands: ScoreBand[];
};
export type SurveyScoring = { scales: ScoreScale[] };

/** A question as scoring needs it. */
export type ScoringQuestion = { id: string; key: string | null; questionType: string; options: unknown; config?: unknown };
export type ScoringAnswer = { questionId: string; selectedOptions?: unknown; numberValue?: number | null; booleanValue?: boolean | null };

const SCORABLE_TYPES = new Set(['LIKERT', 'SINGLE_SELECT', 'RATING', 'YES_NO']);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The options a scale question scores on (not-counted answers such as "Don't know" left out), best first. */
export function scoredOptions(q: ScoringQuestion): string[] {
  const options = Array.isArray(q.options) && q.options.some((o) => typeof o === 'string')
    ? (q.options as unknown[]).filter((o): o is string => typeof o === 'string')
    : q.questionType === 'LIKERT'
      ? [...DEFAULT_LIKERT_OPTIONS]
      : [];
  const notCounted = new Set(readNotCountedOptions(q.config));
  return options.filter((o) => !notCounted.has(o));
}

/**
 * One answer's score and the most it could have scored, or null when it does not score (not answered, "Don't know").
 * Choice and scale answers: the first (best) option scores the most (n), the last 1; reversed questions the other way.
 * Ratings: the value above the bottom of the range. Yes / No: 1 / 0 (reversed: 0 / 1).
 */
export function answerScore(q: ScoringQuestion, a: ScoringAnswer | undefined, reversed: boolean): { score: number; max: number } | null {
  if (!a) return null;
  if (q.questionType === 'YES_NO') {
    if (typeof a.booleanValue !== 'boolean') return null;
    return { score: a.booleanValue !== reversed ? 1 : 0, max: 1 };
  }
  if (q.questionType === 'RATING') {
    if (typeof a.numberValue !== 'number' || Number.isNaN(a.numberValue)) return null;
    const { min, max } = ratingRange(q.config);
    const v = Math.min(max, Math.max(min, a.numberValue)) - min;
    const top = max - min;
    return { score: reversed ? top - v : v, max: top };
  }
  const options = scoredOptions(q);
  const chosen = Array.isArray(a.selectedOptions) ? (a.selectedOptions as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  if (chosen.length !== 1) return null;
  const at = options.indexOf(chosen[0] === 'Neutral' ? 'Neither agree nor disagree' : chosen[0]);
  if (at < 0) return null;
  const n = options.length;
  const pos = n - at; // best first → n … 1
  return { score: reversed ? n + 1 - pos : pos, max: n };
}

/** A person's score on one scale, or null when fewer than half the scale's questions scored. */
export function personScaleScore(
  scale: ScoreScale,
  questionsByKey: ReadonlyMap<string, ScoringQuestion>,
  answersByQuestion: ReadonlyMap<string, ScoringAnswer>,
): number | null {
  const reversed = new Set(scale.reversed);
  const parts: Array<{ score: number; max: number }> = [];
  for (const key of scale.questionKeys) {
    const q = questionsByKey.get(key);
    if (!q) continue;
    const s = answerScore(q, answersByQuestion.get(q.id), reversed.has(key));
    if (s) parts.push(s);
  }
  if (!parts.length || parts.length * 2 < scale.questionKeys.length) return null;
  if (scale.method === 'PERCENT_OF_MAX') {
    const max = parts.reduce((n, p) => n + p.max, 0);
    return max > 0 ? (parts.reduce((n, p) => n + p.score, 0) / max) * 100 : null;
  }
  return parts.reduce((n, p) => n + p.score, 0) / parts.length;
}

export function bandOf(bands: ReadonlyArray<ScoreBand>, score: number): string | null {
  let label: string | null = null;
  for (const b of [...bands].sort((x, y) => x.from - y.from)) if (score >= b.from) label = b.label;
  return label;
}

export type ScaleResult = {
  key: string;
  label: string;
  method: ScoreMethod;
  /** People with a score on this scale. */
  people: number;
  average: number | null;
  band: string | null;
  /** How many people fell in each band; null when any band shown would hold fewer than SCORE_BAND_MIN. */
  bands: Array<{ label: string; people: number }> | null;
};

/** Every scale's result over the responses (each a map of question id → answer). */
export function scoreScales(
  scoring: SurveyScoring,
  questions: ReadonlyArray<ScoringQuestion>,
  responses: ReadonlyArray<ReadonlyMap<string, ScoringAnswer>>,
): ScaleResult[] {
  const byKey = new Map(questions.filter((q) => q.key).map((q) => [q.key as string, q]));
  return scoring.scales.map((scale) => {
    const scores = responses.map((r) => personScaleScore(scale, byKey, r)).filter((s): s is number => s !== null);
    const average = scores.length ? Math.round((scores.reduce((n, s) => n + s, 0) / scores.length) * 100) / 100 : null;
    let bands: ScaleResult['bands'] = null;
    if (scale.bands.length && scores.length) {
      const counts = new Map<string, number>();
      for (const s of scores) {
        const b = bandOf(scale.bands, s) ?? 'Below the lowest band';
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
      const list = [...counts].map(([label, people]) => ({ label, people }));
      bands = list.every((b) => b.people >= SCORE_BAND_MIN) ? list : null;
    }
    return {
      key: scale.key,
      label: scale.label,
      method: scale.method,
      people: scores.length,
      average: average === null ? null : scale.method === 'PERCENT_OF_MAX' ? Math.round(average) : average,
      band: average === null ? null : bandOf(scale.bands, average),
      bands,
    };
  });
}

/** Stored scoring read leniently (bad entries dropped); null when there is none. */
export function readScoring(v: unknown): SurveyScoring | null {
  if (!v || typeof v !== 'object' || !Array.isArray((v as { scales?: unknown }).scales)) return null;
  const scales = ((v as { scales: unknown[] }).scales)
    .map((s) => s as Record<string, unknown>)
    .filter((s) => s && typeof s.key === 'string' && typeof s.label === 'string' && Array.isArray(s.questionKeys))
    .map((s) => ({
      key: s.key as string,
      label: s.label as string,
      questionKeys: (s.questionKeys as unknown[]).filter((k): k is string => typeof k === 'string'),
      reversed: Array.isArray(s.reversed) ? (s.reversed as unknown[]).filter((k): k is string => typeof k === 'string') : [],
      method: (SCORE_METHODS as readonly string[]).includes(s.method as string) ? (s.method as ScoreMethod) : 'MEAN',
      bands: Array.isArray(s.bands)
        ? (s.bands as Array<Record<string, unknown>>)
            .filter((b) => b && typeof b.from === 'number' && typeof b.label === 'string')
            .map((b) => ({ from: b.from as number, label: b.label as string }))
        : [],
    }));
  return scales.length ? { scales } : null;
}

/** Checks a scoring setting against the survey's questions; throws with every problem in words. */
export function validateScoring(input: unknown, questions: ReadonlyArray<ScoringQuestion>): SurveyScoring | null {
  if (input === null || input === undefined) return null;
  const raw = input as { scales?: unknown };
  if (!Array.isArray(raw.scales)) throw new BadRequestException('Scoring needs a list of scales.');
  if (raw.scales.length === 0) return null;
  if (raw.scales.length > MAX_SCALES) throw new BadRequestException(`At most ${MAX_SCALES} scales.`);
  const byKey = new Map(questions.filter((q) => q.key).map((q) => [q.key as string, q]));
  const problems: string[] = [];
  const keys = new Set<string>();
  const scales: ScoreScale[] = raw.scales.map((s0, i) => {
    const s = (s0 ?? {}) as Record<string, unknown>;
    const label = text(s.label, 80);
    const at = `Scale ${i + 1}${label ? ` (${label})` : ''}`;
    if (!label) problems.push(`${at}: give it a name.`);
    const key = text(s.key, 40) || `scale-${i + 1}`;
    if (keys.has(key)) problems.push(`${at}: two scales have the same key.`);
    keys.add(key);
    const questionKeys = [...new Set(Array.isArray(s.questionKeys) ? (s.questionKeys as unknown[]).filter((k): k is string => typeof k === 'string') : [])];
    if (questionKeys.length < 1) problems.push(`${at}: choose at least one question.`);
    for (const k of questionKeys) {
      const q = byKey.get(k);
      if (!q) problems.push(`${at}: a chosen question is no longer on the survey.`);
      else if (!SCORABLE_TYPES.has(q.questionType)) problems.push(`${at}: only scale, single-choice, rating and yes/no questions can be scored.`);
      else if ((q.questionType === 'LIKERT' || q.questionType === 'SINGLE_SELECT') && scoredOptions(q).length < 2) problems.push(`${at}: a chosen question has fewer than 2 answers to score.`);
    }
    const reversed = (Array.isArray(s.reversed) ? (s.reversed as unknown[]).filter((k): k is string => typeof k === 'string') : []).filter((k) => questionKeys.includes(k));
    const method = (SCORE_METHODS as readonly string[]).includes(s.method as string) ? (s.method as ScoreMethod) : null;
    if (!method) problems.push(`${at}: choose how it is scored.`);
    const bands = (Array.isArray(s.bands) ? (s.bands as Array<Record<string, unknown>>) : [])
      .map((b) => ({ from: Number(b?.from), label: text(b?.label, 60) }))
      .filter((b) => b.label);
    if (bands.some((b) => !Number.isFinite(b.from))) problems.push(`${at}: each band needs a starting score.`);
    if (bands.length > 6) problems.push(`${at}: at most 6 bands.`);
    if (new Set(bands.map((b) => b.from)).size !== bands.length) problems.push(`${at}: two bands start at the same score.`);
    return { key, label, questionKeys, reversed, method: method ?? 'MEAN', bands: bands.sort((x, y) => x.from - y.from) };
  });
  if (problems.length) throw new BadRequestException(problems.join(' '));
  return { scales };
}
