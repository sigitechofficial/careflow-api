import { averageComparison } from './cqc-dashboard-comparison.util';
import type { CqcScoringRules } from '../cqc-mock-inspection/cqc-mock-inspection-scoring.util';

const RULES: CqcScoringRules = {
  scale: [
    { score: 1, label: 'Poor' },
    { score: 2, label: 'Some shortfalls' },
    { score: 3, label: 'Good' },
    { score: 4, label: 'Exceptional' },
  ],
  keyQuestionBands: [
    { rating: 'OUTSTANDING', abovePercent: 87.5 },
    { rating: 'GOOD', abovePercent: 62.5 },
    { rating: 'REQUIRES_IMPROVEMENT', abovePercent: 37.5 },
    { rating: 'INADEQUATE', abovePercent: 0 },
  ],
  limiters: [],
  overallRules: [],
  overallDefault: 'GOOD',
};
const KQ = [
  { code: 'SAFE', title: 'Safe' },
  { code: 'WELL_LED', title: 'Well-led' },
];
const ST = [
  { code: 'S1', title: 'Staffing' },
  { code: 'S2', title: 'Learning culture' },
];
const kq = (safe: number | null, wellLed: number | null = null) => [
  { code: 'SAFE', percent: safe },
  { code: 'WELL_LED', percent: wellLed },
];

describe('averageComparison', () => {
  it('averages each branch’s latest score against the one before it', () => {
    const r = averageComparison(
      [
        // newest first
        {
          id: 'i1',
          locationId: 'a',
          keyQuestions: kq(80, 70),
          statements: [{ code: 'S1', score: 4 }],
        },
        {
          id: 'i2',
          locationId: 'b',
          keyQuestions: kq(50),
          statements: [{ code: 'S1', score: 2 }],
        },
        {
          id: 'i3',
          locationId: 'a',
          keyQuestions: kq(60, 70),
          statements: [{ code: 'S1', score: 3 }],
        },
        {
          id: 'i4',
          locationId: 'b',
          keyQuestions: kq(40),
          statements: [{ code: 'S1', score: 2 }],
        },
      ],
      KQ,
      ST,
      RULES,
    );
    expect(r?.branchIds.sort()).toEqual(['a', 'b']);
    // Safe: then (60 + 40) / 2 = 50, now (80 + 50) / 2 = 65.
    expect(r?.keyQuestions[0]).toMatchObject({
      code: 'SAFE',
      fromPercent: 50,
      toPercent: 65,
      change: 15,
      fromRating: 'REQUIRES_IMPROVEMENT',
      toRating: 'GOOD',
      branchCount: 2,
    });
    // Well-led only in branch a, unchanged.
    expect(r?.keyQuestions[1]).toMatchObject({
      code: 'WELL_LED',
      change: 0,
      branchCount: 1,
    });
    // Overall: the average of the key questions, then (50 + 70) / 2 = 60, now (65 + 70) / 2 = 67.5.
    expect(r?.overall).toEqual({
      from: 'REQUIRES_IMPROVEMENT',
      to: 'GOOD',
      fromPercent: 60,
      toPercent: 67.5,
      change: 7.5,
    });
    // Staffing: then (3 + 2) / 2 = 2.5, now (4 + 2) / 2 = 3.
    expect(r?.improved).toEqual([
      { code: 'S1', title: 'Staffing', from: 2.5, to: 3 },
    ]);
    expect(r?.declined).toEqual([]);
  });

  it('uses the latest inspection that scored each key question (a focused one covers only some)', () => {
    const r = averageComparison(
      [
        { id: 'i5', locationId: 'a', keyQuestions: kq(90), statements: [] },
        { id: 'i6', locationId: 'a', keyQuestions: kq(70, 50), statements: [] },
        { id: 'i7', locationId: 'a', keyQuestions: kq(60, 40), statements: [] },
      ],
      KQ,
      ST,
      RULES,
    );
    expect(
      r?.keyQuestions.map((k) => [k.code, k.fromPercent, k.toPercent]),
    ).toEqual([
      ['SAFE', 70, 90],
      ['WELL_LED', 40, 50],
    ]);
    // Safe: the newest against the one before; Well-led: the two before it.
    expect(r?.compared).toEqual([
      { toId: 'i5', fromId: 'i6' },
      { toId: 'i6', fromId: 'i7' },
    ]);
  });

  it('never compares one branch with another', () => {
    const r = averageComparison(
      [
        {
          id: 'i8',
          locationId: 'a',
          keyQuestions: kq(90),
          statements: [{ code: 'S1', score: 4 }],
        },
        {
          id: 'i9',
          locationId: 'b',
          keyQuestions: kq(40),
          statements: [{ code: 'S1', score: 1 }],
        },
        { id: 'i10', locationId: null, keyQuestions: kq(60), statements: [] },
      ],
      KQ,
      ST,
      RULES,
    );
    expect(r).toBeNull();
  });

  it('gives percentages without ratings when the framework has no scoring rules', () => {
    const r = averageComparison(
      [
        { id: 'i11', locationId: null, keyQuestions: kq(80), statements: [] },
        { id: 'i12', locationId: null, keyQuestions: kq(60), statements: [] },
      ],
      KQ,
      ST,
      null,
    );
    expect(r?.branchIds).toEqual([null]);
    expect(r?.overall).toEqual({
      from: null,
      to: null,
      fromPercent: 60,
      toPercent: 80,
      change: 20,
    });
  });
});
