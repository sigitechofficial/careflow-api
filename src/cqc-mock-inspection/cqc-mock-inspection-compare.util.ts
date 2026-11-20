import type {
  CqcRating,
  InspectionResult,
} from './cqc-mock-inspection-scoring.util';

/**
 * How an inspection compares with the previous completed one for the same service: overall and key
 * question ratings, the percentage change, and the statements whose score went up or down.
 * Statements are matched by code, so an inspection on a later framework version still compares for
 * the statements both versions share. Pure: the service loads the two inspections.
 */

export type ComparableInspection = {
  result: InspectionResult | null;
  keyQuestions: { code: string; title: string }[];
  statements: { code: string; title: string; score: number | null }[];
};

export type KeyQuestionChange = {
  code: string;
  title: string;
  fromRating: CqcRating | null;
  toRating: CqcRating | null;
  fromPercent: number | null;
  toPercent: number | null;
  /** Percentage points, to one decimal place; null when either side is not scored. */
  change: number | null;
};

export type StatementChange = {
  code: string;
  title: string;
  from: number;
  to: number;
};

export type InspectionComparison = {
  overall: { from: CqcRating | null; to: CqcRating | null };
  keyQuestions: KeyQuestionChange[];
  improved: StatementChange[];
  declined: StatementChange[];
  unchangedCount: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function compareInspections(
  current: ComparableInspection,
  previous: ComparableInspection,
): InspectionComparison {
  const keyQuestions = current.keyQuestions.map((k): KeyQuestionChange => {
    const to = current.result?.keyQuestions.find(
      (x) => x.keyQuestionCode === k.code,
    );
    const from = previous.result?.keyQuestions.find(
      (x) => x.keyQuestionCode === k.code,
    );
    const toPercent = to?.percent ?? null;
    const fromPercent = from?.percent ?? null;
    return {
      code: k.code,
      title: k.title,
      fromRating: from?.rating ?? null,
      toRating: to?.rating ?? null,
      fromPercent,
      toPercent,
      change:
        toPercent !== null && fromPercent !== null
          ? round1(toPercent - fromPercent)
          : null,
    };
  });

  const before = new Map(previous.statements.map((s) => [s.code, s.score]));
  const improved: StatementChange[] = [];
  const declined: StatementChange[] = [];
  let unchangedCount = 0;
  for (const s of current.statements) {
    const from = before.get(s.code);
    if (s.score === null || from === null || from === undefined) continue;
    if (s.score > from)
      improved.push({ code: s.code, title: s.title, from, to: s.score });
    else if (s.score < from)
      declined.push({ code: s.code, title: s.title, from, to: s.score });
    else unchangedCount += 1;
  }
  // Biggest moves first.
  improved.sort((a, b) => b.to - b.from - (a.to - a.from));
  declined.sort((a, b) => a.to - a.from - (b.to - b.from));

  return {
    overall: {
      from: previous.result?.overall ?? null,
      to: current.result?.overall ?? null,
    },
    keyQuestions,
    improved,
    declined,
    unchangedCount,
  };
}
