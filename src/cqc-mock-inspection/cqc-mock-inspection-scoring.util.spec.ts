import {
  loadCqcFrameworks,
  validateCqcFramework,
} from '../../prisma/seed-lib/cqc-framework';
import {
  inspectionResult,
  isValidScore,
  keyQuestionResult,
  overallRating,
  parseScoringRules,
  scoreFromChecks,
  scoringRulesProblems,
  type CqcScoringRules,
  type StatementScore,
} from './cqc-mock-inspection-scoring.util';

const frameworks = loadCqcFrameworks();
const v1 = frameworks[0];
const rules = parseScoringRules(v1.scoring) as CqcScoringRules;
const KQS = ['SAFE', 'EFFECTIVE', 'CARING', 'RESPONSIVE', 'WELL_LED'];

/** Statements for every key question of v1, all given `score` unless overridden by code. */
function allStatements(
  score: number | null,
  overrides: Record<string, number | null> = {},
): StatementScore[] {
  return v1.keyQuestions.flatMap((k) =>
    k.statements.map((s) => ({
      statementId: s.code,
      keyQuestionCode: k.code,
      score: s.code in overrides ? overrides[s.code] : score,
    })),
  );
}
const firstStatement = (kq: string, i = 0) =>
  v1.keyQuestions.find((k) => k.code === kq)!.statements[i].code;

describe('CQC scoring rules in the framework seed', () => {
  it('version 1 has valid scoring rules on a 1–4 scale', () => {
    expect(scoringRulesProblems(v1.scoring)).toEqual([]);
    expect(rules.scale.map((s) => s.score)).toEqual([1, 2, 3, 4]);
    expect(rules.keyQuestionBands.map((b) => b.rating)).toEqual([
      'OUTSTANDING',
      'GOOD',
      'REQUIRES_IMPROVEMENT',
      'INADEQUATE',
    ]);
  });

  it('every framework file has valid rules, or none', () => {
    for (const f of frameworks) {
      if (f.scoring) expect(scoringRulesProblems(f.scoring)).toEqual([]);
    }
  });

  it('is marked unverified with its sources until checked on the CQC website', () => {
    expect(v1.scoring?.verification.status).toBe('unverified');
    expect(v1.scoring?.verification.sources).toContain('cqc-reach-rating');
  });

  it('the seed validator rejects a scoring block without a note or with an unknown source', () => {
    const bad = {
      ...v1,
      scoring: {
        ...v1.scoring,
        note: '',
        verification: { status: 'unverified', sources: ['nope'] },
      },
    };
    const errors = validateCqcFramework(bad, 'saf-v1.json');
    expect(errors.some((e) => e.includes('scoring: note is required'))).toBe(
      true,
    );
    expect(errors.some((e) => e.includes('unknown source nope'))).toBe(true);
  });
});

describe('parseScoringRules / scoringRulesProblems', () => {
  it('returns null when a version has no scoring', () => {
    expect(parseScoringRules(null)).toBeNull();
    expect(parseScoringRules(undefined)).toBeNull();
  });

  it('rejects bands out of order, a missing 0 band, bad limiters and a bad default', () => {
    const problems = scoringRulesProblems({
      ...rules,
      keyQuestionBands: [
        { rating: 'GOOD', abovePercent: 62 },
        { rating: 'OUTSTANDING', abovePercent: 87 },
      ],
      limiters: [
        { whenRatingIn: ['GOOD'], anyStatementScoreIn: [7], limitTo: 'GOOD' },
      ],
      overallDefault: 'FINE',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'keyQuestionBands must run from the highest abovePercent to the lowest',
        'the last key question band must be abovePercent 0',
        expect.stringContaining('limiters[0]'),
        'overallDefault must be a rating',
      ]),
    );
    expect(() => parseScoringRules({ ...rules, scale: [] })).toThrow(
      'CQC scoring rules are not valid',
    );
  });

  it('only accepts whole scores on the scale', () => {
    expect(isValidScore(rules, 3)).toBe(true);
    expect(isValidScore(rules, 0)).toBe(false);
    expect(isValidScore(rules, 2.5)).toBe(false);
    expect(isValidScore(rules, '3')).toBe(false);
  });
});

describe('keyQuestionResult', () => {
  it("matches CQC's worked example: Safe scoring 21 of 32 (65.6%) is good", () => {
    const r = keyQuestionResult('SAFE', [3, 3, 3, 2, 3, 2, 2, 3], rules);
    expect(r).toMatchObject({
      total: 21,
      max: 32,
      percent: 65.6,
      bandRating: 'GOOD',
      rating: 'GOOD',
      limitedFrom: null,
      complete: true,
    });
  });

  it('rates each band', () => {
    expect(keyQuestionResult('X', [4, 4, 4, 4], rules).rating).toBe(
      'OUTSTANDING',
    );
    expect(keyQuestionResult('X', [3, 3, 3, 3], rules).rating).toBe('GOOD');
    expect(keyQuestionResult('X', [2, 2, 2, 2], rules).rating).toBe(
      'REQUIRES_IMPROVEMENT',
    );
    expect(keyQuestionResult('X', [1, 1, 1, 1], rules).rating).toBe(
      'INADEQUATE',
    );
  });

  it('puts a score between bands in the higher band (stored as "above" values)', () => {
    // 6 statements: 21/24 = 87.5%, 15/24 = 62.5%, 9/24 = 37.5%
    expect(keyQuestionResult('X', [4, 4, 4, 3, 3, 3], rules)).toMatchObject({
      percent: 87.5,
      rating: 'OUTSTANDING',
    });
    expect(keyQuestionResult('X', [3, 3, 3, 2, 2, 2], rules)).toMatchObject({
      percent: 62.5,
      rating: 'GOOD',
    });
    expect(keyQuestionResult('X', [2, 2, 2, 1, 1, 1], rules)).toMatchObject({
      percent: 37.5,
      rating: 'INADEQUATE',
    });
  });

  it('limits a good-range score with a statement at 1 to requires improvement', () => {
    const r = keyQuestionResult('X', [4, 4, 4, 1], rules); // 13/16 = 81.3%
    expect(r).toMatchObject({
      percent: 81.3,
      bandRating: 'GOOD',
      rating: 'REQUIRES_IMPROVEMENT',
      limitedFrom: 'GOOD',
    });
  });

  it('limits an outstanding-range score with a statement at 1 or 2 to good', () => {
    const r = keyQuestionResult('X', [4, 4, 4, 4, 4, 4, 4, 2], rules); // 30/32 = 93.8%
    expect(r).toMatchObject({
      bandRating: 'OUTSTANDING',
      rating: 'GOOD',
      limitedFrom: 'OUTSTANDING',
    });
  });

  it('rates only the statements scored so far and says it is not complete', () => {
    const r = keyQuestionResult('X', [3, null, 3, null], rules);
    expect(r).toMatchObject({
      scoredCount: 2,
      statementCount: 4,
      total: 6,
      max: 8,
      rating: 'GOOD',
      complete: false,
    });
    expect(keyQuestionResult('X', [null, null], rules)).toMatchObject({
      percent: null,
      rating: null,
      complete: false,
    });
  });

  it('refuses a score that is not on the scale', () => {
    expect(() => keyQuestionResult('SAFE', [3, 5], rules)).toThrow(
      'SAFE: 5 is not a score on the scale',
    );
  });
});

describe('overallRating', () => {
  it.each([
    [['INADEQUATE', 'INADEQUATE', 'GOOD', 'GOOD', 'GOOD'], 'INADEQUATE'],
    [
      ['INADEQUATE', 'OUTSTANDING', 'OUTSTANDING', 'GOOD', 'GOOD'],
      'REQUIRES_IMPROVEMENT',
    ],
    [
      ['REQUIRES_IMPROVEMENT', 'REQUIRES_IMPROVEMENT', 'GOOD', 'GOOD', 'GOOD'],
      'REQUIRES_IMPROVEMENT',
    ],
    [
      ['REQUIRES_IMPROVEMENT', 'OUTSTANDING', 'OUTSTANDING', 'GOOD', 'GOOD'],
      'GOOD',
    ],
    [['OUTSTANDING', 'OUTSTANDING', 'GOOD', 'GOOD', 'GOOD'], 'OUTSTANDING'],
    [['OUTSTANDING', 'GOOD', 'GOOD', 'GOOD', 'GOOD'], 'GOOD'],
    [['GOOD', 'GOOD', 'GOOD', 'GOOD', 'GOOD'], 'GOOD'],
  ] as const)('%j → %s', (kqRatings, expected) => {
    expect(overallRating([...kqRatings], rules)).toBe(expected);
  });
});

describe('inspectionResult', () => {
  it('rates every key question in order and gives an overall rating once all 34 statements are scored', () => {
    const r = inspectionResult(allStatements(3), KQS, rules);
    expect(r.keyQuestions.map((k) => k.keyQuestionCode)).toEqual(KQS);
    expect(r.keyQuestions.map((k) => k.statementCount)).toEqual([
      8, 6, 5, 7, 8,
    ]);
    expect(r.keyQuestions.every((k) => k.rating === 'GOOD')).toBe(true);
    expect(r).toMatchObject({
      complete: true,
      overall: 'GOOD',
      unscoredStatementIds: [],
    });
  });

  it('has no overall rating while a statement is unscored, and lists it', () => {
    const missing = firstStatement('CARING');
    const r = inspectionResult(
      allStatements(3, { [missing]: null }),
      KQS,
      rules,
    );
    expect(r).toMatchObject({
      complete: false,
      overall: null,
      unscoredStatementIds: [missing],
    });
    expect(
      r.keyQuestions.find((k) => k.keyQuestionCode === 'CARING'),
    ).toMatchObject({ complete: false, rating: 'GOOD' });
  });

  it('carries a limiter through to the overall rating', () => {
    const r = inspectionResult(
      allStatements(3, {
        [firstStatement('SAFE')]: 1,
        [firstStatement('WELL_LED')]: 1,
      }),
      KQS,
      rules,
    );
    expect(
      r.keyQuestions.find((k) => k.keyQuestionCode === 'SAFE'),
    ).toMatchObject({ bandRating: 'GOOD', rating: 'REQUIRES_IMPROVEMENT' });
    expect(r.overall).toBe('REQUIRES_IMPROVEMENT');
  });

  it('is not complete with no statements', () => {
    expect(inspectionResult([], KQS, rules)).toMatchObject({
      complete: false,
      overall: null,
    });
  });

  it('rates a focused inspection by key question but gives no overall rating', () => {
    const focused = allStatements(3).filter(
      (s) => s.keyQuestionCode === 'SAFE' || s.keyQuestionCode === 'WELL_LED',
    );
    const r = inspectionResult(focused, ['SAFE', 'WELL_LED'], rules, KQS);
    expect(r.keyQuestions.map((k) => [k.keyQuestionCode, k.rating])).toEqual([
      ['SAFE', 'GOOD'],
      ['WELL_LED', 'GOOD'],
    ]);
    expect(r).toMatchObject({
      complete: true,
      overallApplies: false,
      overall: null,
    });
  });

  it('gives an overall rating when every key question of the framework is covered', () => {
    expect(inspectionResult(allStatements(3), KQS, rules, KQS)).toMatchObject({
      overallApplies: true,
      overall: 'GOOD',
    });
  });
});

describe('scoreFromChecks', () => {
  const checks = Array.from({ length: 8 }, (_, i) => ({
    part: 'lookAt',
    text: `Check ${i + 1}`,
  }));
  const answer = (...answers: Array<'MET' | 'PARTIALLY_MET' | 'NOT_MET'>) =>
    answers.map((a, i) => ({
      part: 'lookAt',
      text: `Check ${i + 1}`,
      answer: a,
    }));
  const M = 'MET' as const;
  const P = 'PARTIALLY_MET' as const;
  const N = 'NOT_MET' as const;

  it('uses the points and % levels it is given', () => {
    const strict = {
      metPoints: 3,
      partlyMetPoints: 1,
      notMetPoints: 0,
      score4Percent: 90,
      score3Percent: 80,
      score2Percent: 60,
    };
    // 7 Met and 1 Partially met: 22 of 24 = 91.7% → 4 (with the defaults it is a 3).
    expect(scoreFromChecks(checks, answer(M, M, M, M, M, M, M, P), strict)).toMatchObject({ score: 4, percent: 91.7 });
    // 6 Met and 2 Not met: 18 of 24 = 75% → 2 here (80% needed for a 3).
    expect(scoreFromChecks(checks, answer(M, M, M, M, M, M, N, N), strict).score).toBe(2);
  });

  it('gives no score until every check is answered', () => {
    expect(scoreFromChecks(checks, answer(M, M, M))).toEqual({
      score: null,
      answered: 3,
      total: 8,
      percent: null,
    });
    expect(scoreFromChecks([], [])).toMatchObject({ score: null, total: 0 });
  });

  it('scores 4 only when every check is met, then 3 from 75%, 2 from 50%, else 1', () => {
    expect(
      scoreFromChecks(checks, answer(M, M, M, M, M, M, M, M)),
    ).toMatchObject({ score: 4, percent: 100 });
    // 7.5 / 8 = 93.8%
    expect(
      scoreFromChecks(checks, answer(M, M, M, M, M, M, M, P)),
    ).toMatchObject({ score: 3, percent: 93.8 });
    // 6 / 8 = 75% exactly
    expect(scoreFromChecks(checks, answer(M, M, M, M, M, M, N, N)).score).toBe(
      3,
    );
    // 5.5 / 8 = 68.8%
    expect(scoreFromChecks(checks, answer(M, M, M, M, M, P, N, N)).score).toBe(
      2,
    );
    // 4 / 8 = 50% exactly
    expect(scoreFromChecks(checks, answer(M, M, M, M, N, N, N, N)).score).toBe(
      2,
    );
    // 3.5 / 8 = 43.8%
    expect(scoreFromChecks(checks, answer(M, M, M, P, N, N, N, N)).score).toBe(
      1,
    );
    expect(scoreFromChecks(checks, answer(N, N, N, N, N, N, N, N)).score).toBe(
      1,
    );
  });

  it('ignores answers to checks the statement no longer has', () => {
    const extra = [
      ...answer(M, M, M, M, M, M, M, M),
      { part: 'askStaff', text: 'Old', answer: N },
    ];
    expect(scoreFromChecks(checks, extra).score).toBe(4);
  });
});
