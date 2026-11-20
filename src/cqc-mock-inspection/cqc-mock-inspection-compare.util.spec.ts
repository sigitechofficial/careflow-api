import {
  compareInspections,
  type ComparableInspection,
} from './cqc-mock-inspection-compare.util';
import type { InspectionResult } from './cqc-mock-inspection-scoring.util';

const kqResult = (
  code: string,
  percent: number | null,
  rating: InspectionResult['overall'],
) => ({
  keyQuestionCode: code,
  statementCount: 2,
  scoredCount: percent === null ? 0 : 2,
  total: 0,
  max: 0,
  percent,
  bandRating: rating,
  rating,
  limitedFrom: null,
  complete: percent !== null,
});

const KQS = [
  { code: 'SAFE', title: 'Safe' },
  { code: 'CARING', title: 'Caring' },
];

const inspection = (
  overall: InspectionResult['overall'],
  safe: [number | null, InspectionResult['overall']],
  caring: [number | null, InspectionResult['overall']],
  scores: Record<string, number | null>,
): ComparableInspection => ({
  result: {
    overall,
    complete: overall !== null,
    unscoredStatementIds: [],
    overallApplies: true,
    keyQuestions: [kqResult('SAFE', ...safe), kqResult('CARING', ...caring)],
  },
  keyQuestions: KQS,
  statements: Object.entries(scores).map(([code, score]) => ({
    code,
    title: code.toLowerCase(),
    score,
  })),
});

describe('compareInspections', () => {
  it('gives the overall and key question changes in percentage points', () => {
    const before = inspection(
      'REQUIRES_IMPROVEMENT',
      [50, 'REQUIRES_IMPROVEMENT'],
      [75, 'GOOD'],
      {},
    );
    const now = inspection('GOOD', [71.9, 'GOOD'], [62.5, 'GOOD'], {});
    const c = compareInspections(now, before);
    expect(c.overall).toEqual({ from: 'REQUIRES_IMPROVEMENT', to: 'GOOD' });
    expect(c.keyQuestions).toEqual([
      {
        code: 'SAFE',
        title: 'Safe',
        fromRating: 'REQUIRES_IMPROVEMENT',
        toRating: 'GOOD',
        fromPercent: 50,
        toPercent: 71.9,
        change: 21.9,
      },
      {
        code: 'CARING',
        title: 'Caring',
        fromRating: 'GOOD',
        toRating: 'GOOD',
        fromPercent: 75,
        toPercent: 62.5,
        change: -12.5,
      },
    ]);
  });

  it('lists statements that went up or down, biggest first, matched by code', () => {
    const before = inspection('GOOD', [75, 'GOOD'], [75, 'GOOD'], {
      A: 1,
      B: 3,
      C: 3,
      D: 4,
      E: 2,
      F: 3,
    });
    const now = inspection('GOOD', [75, 'GOOD'], [75, 'GOOD'], {
      A: 4,
      B: 3,
      C: 2,
      D: 1,
      E: 3,
      G: 3,
    });
    const c = compareInspections(now, before);
    expect(c.improved.map((s) => [s.code, s.from, s.to])).toEqual([
      ['A', 1, 4],
      ['E', 2, 3],
    ]);
    expect(c.declined.map((s) => [s.code, s.from, s.to])).toEqual([
      ['D', 4, 1],
      ['C', 3, 2],
    ]);
    // B unchanged; F only before, G only now: not compared.
    expect(c.unchangedCount).toBe(1);
  });

  it('leaves the change empty when a side is not scored, and skips unscored statements', () => {
    const before = inspection(null, [null, null], [75, 'GOOD'], {
      A: null,
      B: 2,
    });
    const now = inspection(null, [60, 'REQUIRES_IMPROVEMENT'], [null, null], {
      A: 3,
      B: null,
    });
    const c = compareInspections(now, before);
    expect(c.overall).toEqual({ from: null, to: null });
    expect(c.keyQuestions.map((k) => k.change)).toEqual([null, null]);
    expect(c.improved).toEqual([]);
    expect(c.declined).toEqual([]);
    expect(c.unchangedCount).toBe(0);
  });
});
