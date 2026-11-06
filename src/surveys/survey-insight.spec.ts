import { surveyAccessFor } from './survey-access';
import { SurveyInsightService, answerTally, combineScaleResults, keyQuestionsBySection, kqsForSection, scalePosition } from './survey-insight.service';
import { cellsToHide, heatmapMinimum, planColumns, pointOf, poolPoints, questionLineKey, unitHiddenReason, unitYear } from './survey-insight.util';
import { countThemes, safeguardingKindsIn, themesIn } from './survey-text-themes.util';
import { duplicateIds, fastFlag, straightLined } from './survey-quality.util';
import { answerScore, scoreScales, validateScoring } from './survey-scoring.util';

jest.mock('./survey-access', () => ({ ...jest.requireActual('./survey-access'), surveyAccessFor: jest.fn() }));
const access = surveyAccessFor as jest.Mock;

describe('insight units (secondary suppression)', () => {
  it('hides a unit under the threshold, and an open unit where answers can be linked to no one', () => {
    expect(unitHiddenReason({ responsesInFigures: 4, threshold: 5, closed: true, unlinkedPossible: false })).toBe('TOO_FEW');
    expect(unitHiddenReason({ responsesInFigures: 0, threshold: 0, closed: true, unlinkedPossible: false })).toBe('TOO_FEW');
    expect(unitHiddenReason({ responsesInFigures: 9, threshold: 5, closed: false, unlinkedPossible: true })).toBe('NOT_CLOSED');
    expect(unitHiddenReason({ responsesInFigures: 9, threshold: 5, closed: false, unlinkedPossible: false })).toBeNull();
    expect(unitHiddenReason({ responsesInFigures: 5, threshold: 5, closed: true, unlinkedPossible: true })).toBeNull();
  });

  it('a point per question kind, pooled by adding the counts (never averaging percentages)', () => {
    const a = pointOf({ questionType: 'LIKERT', answerCount: 10, topTwo: { positive: 8, base: 10, percent: 80 } });
    const b = pointOf({ questionType: 'LIKERT', answerCount: 30, topTwo: { positive: 15, base: 30, percent: 50 } });
    expect(poolPoints([a, b])).toEqual({ kind: 'TOP_TWO', positive: 23, base: 40, percent: 57 });
    expect(pointOf({ questionType: 'YES_NO', answerCount: 4, options: [{ label: 'Yes', count: 3 }, { label: 'No', count: 1 }] })).toMatchObject({ kind: 'YES', percent: 75 });
    expect(poolPoints([{ kind: 'AVERAGE', average: 4, count: 10 }, { kind: 'AVERAGE', average: 2, count: 30 }])).toEqual({ kind: 'AVERAGE', average: 2.5, count: 40 });
    expect(pointOf({ questionType: 'TEXT', answerCount: 3 })).toBeNull();
  });

  it('a reworded question starts a new line; years come from the opening date or period key', () => {
    expect(questionLineKey({ questionType: 'LIKERT', questionText: ' I feel  safe ' })).toBe(questionLineKey({ questionType: 'LIKERT', questionText: 'I feel safe' }));
    expect(questionLineKey({ questionType: 'LIKERT', questionText: 'I feel safe' })).not.toBe(questionLineKey({ questionType: 'LIKERT', questionText: 'I feel very safe' }));
    expect(unitYear({ opensAt: new Date('2026-02-02T09:00:00Z') })).toBe(2026);
    expect(unitYear({ periodKey: '2025-11' })).toBe(2025);
  });
});

describe('branch heatmap suppression', () => {
  it('never shows a branch under the minimum (5, or the threshold if higher)', () => {
    expect(heatmapMinimum(0)).toBe(5);
    expect(heatmapMinimum(10)).toBe(10);
  });

  it('combines small branches; when combined they are still small, the smallest shown branch joins them', () => {
    const plan = planColumns(
      [
        { key: 'a', label: 'A', responses: 20 },
        { key: 'b', label: 'B', responses: 9 },
        { key: 'c', label: 'C', responses: 2 },
      ],
      5,
    );
    expect(plan.shown.map((c) => c.key)).toEqual(['a']);
    expect(plan.other).toEqual({ keys: ['c', 'b'], responses: 11 });
  });

  it('small branches that together reach the minimum form "Other branches"', () => {
    const plan = planColumns(
      [
        { key: 'a', label: 'A', responses: 20 },
        { key: 'b', label: 'B', responses: 3 },
        { key: 'c', label: 'C', responses: 3 },
      ],
      5,
    );
    expect(plan.shown.map((c) => c.key)).toEqual(['a']);
    expect(plan.other?.responses).toBe(6);
  });

  it('with one large branch and a small remainder, nothing is split (overall minus the branch would give the rest)', () => {
    const plan = planColumns(
      [
        { key: 'a', label: 'A', responses: 20 },
        { key: 'b', label: 'B', responses: 2 },
      ],
      5,
    );
    expect(plan.shown).toEqual([]);
    expect(plan.other).toBeNull();
    expect(plan.hidden.sort()).toEqual(['a', 'b']);
  });

  it('a row hides small cells and, when needed, the next smallest so no hidden cell can be worked out', () => {
    expect([...cellsToHide([{ key: 'a', base: 12 }, { key: 'b', base: 8 }, { key: 'c', base: 2 }], 5)].sort()).toEqual(['b', 'c']);
    expect([...cellsToHide([{ key: 'a', base: 12 }, { key: 'b', base: 3 }, { key: 'c', base: 3 }], 5)].sort()).toEqual(['b', 'c']);
    expect([...cellsToHide([{ key: 'a', base: 12 }, { key: 'b', base: 8 }], 5)]).toEqual([]);
  });

  it('counts a scale answer by its top two, Yes / No as Yes, and nothing else', () => {
    const q = { id: 'q', key: null, questionText: 'Q', questionType: 'LIKERT', options: null, config: null, sectionTitle: null, sortOrder: 0 };
    expect(answerTally(q, { selectedOptions: ['Agree'] })).toEqual({ kind: 'TOP_TWO', positive: 1, base: 1 });
    expect(answerTally(q, { selectedOptions: ['Disagree'] })).toEqual({ kind: 'TOP_TWO', positive: 0, base: 1 });
    expect(answerTally(q, { selectedOptions: ["Don't know"] })).toBeNull();
    expect(answerTally({ ...q, questionType: 'YES_NO' }, { booleanValue: true })).toEqual({ kind: 'YES', positive: 1, base: 1 });
  });
});

describe('themes and safeguarding words (read inside CareFlow only)', () => {
  it('counts themes per written answer', () => {
    expect(themesIn("The carers are always late and I never know who's coming")).toEqual(expect.arrayContaining(['TIMEKEEPING', 'CONTINUITY']));
    const counts = countThemes(['Late again', 'Lovely kind carers', 'late visits', 'The office never calls back']);
    expect(counts[0]).toMatchObject({ code: 'TIMEKEEPING', count: 2 });
    expect(counts.find((c) => c.code === 'COMMUNICATION')?.count).toBe(1);
  });

  it('flags words that may point to harm, by kind', () => {
    expect(safeguardingKindsIn('She shouted at me and money went missing from my purse')).toEqual(expect.arrayContaining(['PSYCHOLOGICAL']));
    expect(safeguardingKindsIn('My money has gone missing')).toEqual(['FINANCIAL']);
    expect(safeguardingKindsIn('He was too rough with the hoist and left a bruise')).toEqual(['PHYSICAL']);
    expect(safeguardingKindsIn("Some days I don't want to live")).toEqual(['SELF_HARM']);
    expect(safeguardingKindsIn('The carers are lovely and always on time')).toEqual([]);
    // "white" never matches "hit": whole words only.
    expect(safeguardingKindsIn('a white towel')).toEqual([]);
  });
});

describe('response quality (flagged, never removed)', () => {
  it('FAST only from a plausible time, and never under 3 answers', () => {
    expect(fastFlag(10, 10)).toBe(true);
    expect(fastFlag(30, 10)).toBe(false);
    expect(fastFlag(90, 100)).toBe(false);
    expect(fastFlag(1, 2)).toBe(false);
    expect(fastFlag(undefined, 10)).toBe(false);
    expect(fastFlag(-5, 10)).toBe(false);
  });

  it('straight-lining needs 6 scale answers in the same place', () => {
    const q = { questionType: 'LIKERT' };
    const answers = Array.from({ length: 6 }, (_, i) => ({ questionId: `q${i}`, selectedOptions: ['Agree'] }));
    expect(straightLined(answers, (a) => scalePosition(q, a))).toBe(true);
    expect(straightLined(answers.slice(0, 5), (a) => scalePosition(q, a))).toBe(false);
    expect(straightLined([...answers.slice(0, 5), { questionId: 'x', selectedOptions: ['Disagree'] }], (a) => scalePosition(q, a))).toBe(false);
  });

  it('duplicates need 5 answers in common including a written one', () => {
    const answers = [
      ...Array.from({ length: 4 }, (_, i) => ({ questionId: `q${i}`, selectedOptions: ['Agree'] })),
      { questionId: 't', textValue: 'The carers are wonderful people' },
    ];
    expect([...duplicateIds([{ id: 'r1', answers }, { id: 'r2', answers }, { id: 'r3', answers: answers.slice(0, 4) }])].sort()).toEqual(['r1', 'r2']);
    expect(duplicateIds([{ id: 'r1', answers: answers.slice(0, 4) }, { id: 'r2', answers: answers.slice(0, 4) }]).size).toBe(0);
  });
});

describe('scoring', () => {
  const qs = [
    { id: 'a', key: 'demands-1', questionType: 'SINGLE_SELECT', options: ['Never', 'Seldom', 'Sometimes', 'Often', 'Always'] },
    { id: 'b', key: 'demands-2', questionType: 'SINGLE_SELECT', options: ['Never', 'Seldom', 'Sometimes', 'Often', 'Always'] },
  ];
  const scoring = { scales: [{ key: 'demands', label: 'Demands', questionKeys: ['demands-1', 'demands-2'], reversed: ['demands-2'], method: 'MEAN' as const, bands: [{ from: 1, label: 'Act now' }, { from: 3.5, label: 'Good' }] }] };

  it('scores the first answer highest, reversed questions the other way round', () => {
    expect(answerScore(qs[0], { questionId: 'a', selectedOptions: ['Never'] }, false)).toEqual({ score: 5, max: 5 });
    expect(answerScore(qs[1], { questionId: 'b', selectedOptions: ['Never'] }, true)).toEqual({ score: 1, max: 5 });
    expect(answerScore(qs[0], { questionId: 'a', selectedOptions: ["Don't know"] }, false)).toBeNull();
  });

  it('averages per person, and lists bands only when each holds at least 3 people', () => {
    const r = (x: string, y: string) => new Map([['a', { questionId: 'a', selectedOptions: [x] }], ['b', { questionId: 'b', selectedOptions: [y] }]]);
    const people = [r('Never', 'Always'), r('Never', 'Always'), r('Never', 'Always'), r('Always', 'Never')];
    const [demands] = scoreScales(scoring, qs, people);
    expect(demands.people).toBe(4);
    expect(demands.average).toBe(4);
    expect(demands.band).toBe('Good');
    // One person alone in "Act now": the bands are not listed (it would single them out).
    expect(demands.bands).toBeNull();
    const combined = combineScaleResults(scoring.scales, [scoreScales(scoring, qs, people.slice(0, 3))]);
    expect(combined[0]).toMatchObject({ people: 3, average: 5, band: 'Good', bands: [{ label: 'Good', people: 3 }] });
  });

  it('checks the setting against the questions', () => {
    expect(() => validateScoring({ scales: [{ label: 'X', questionKeys: ['nope'], method: 'MEAN' }] }, qs)).toThrow(/no longer on the survey/);
    expect(validateScoring({ scales: [] }, qs)).toBeNull();
    expect(validateScoring({ scales: [{ label: 'Demands', questionKeys: ['demands-1'], method: 'MEAN', bands: [{ from: 3, label: 'OK' }] }] }, qs)?.scales[0]).toMatchObject({ key: 'scale-1', method: 'MEAN' });
  });
});

describe('360 report: key questions from the library section evidence', () => {
  it('reads "Safe: …" labels per section', () => {
    const m = keyQuestionsBySection({ sections: [{ title: 'Your safety', evidence: ['Safe: Safeguarding', 'Caring: Kindness, compassion and dignity'] }] });
    expect(m.get('Your safety')).toEqual(['SAFE', 'CARING']);
  });
});

// ─── Service: units and the heatmap against the Results engine ───────────

function survey(over: Record<string, unknown> = {}) {
  return {
    id: 's1', title: 'Pulse', clonedFromId: null, isTemplate: false, isAnonymous: true, allowAnonymousResponses: false,
    targetKind: 'EMPLOYEE', status: 'ACTIVE', locationIds: [], recurrence: 'MONTHLY', eventTrigger: null, periodKey: null,
    opensAt: null, closesAt: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    createdFromTemplateId: null, libraryReference: null, libraryMeta: null, scoring: null, ...over,
  } as any;
}

function figures(n: number, summaries: unknown[] = []) {
  return { participation: { responsesInFigures: n }, questionSummaries: summaries, headline: null } as any;
}

function setup(opts: { periods: any[]; figures: Record<string, any>; responses?: any[]; questions?: any[] }) {
  const prisma: any = {
    survey: { findMany: jest.fn().mockResolvedValue(opts.periods), findUnique: jest.fn() },
    surveyResponse: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue(opts.responses ?? []) },
    surveyQuestion: { findMany: jest.fn().mockResolvedValue(opts.questions ?? []) },
    location: { findMany: jest.fn().mockResolvedValue([{ id: 'L1', name: 'North' }, { id: 'L2', name: 'South' }, { id: 'L3', name: 'East' }]) },
  };
  const surveys: any = {
    visibleSurvey: jest.fn().mockResolvedValue(survey()),
    figuresFor: jest.fn(async (u: any) => opts.figures[u.id]),
    inScope: jest.fn().mockReturnValue(true),
  };
  access.mockResolvedValue({ results: true, responses: false, threshold: 5 });
  return { service: new SurveyInsightService(prisma, surveys, { logAudit: jest.fn() } as any), prisma, surveys };
}

describe('SurveyInsightService', () => {
  const likert = (positive: number, base: number) => ({ questionId: 'q', questionText: 'I feel valued', questionType: 'LIKERT', sortOrder: 0, answerCount: base, status: 'current', topTwo: { positive, base, percent: Math.round((positive / base) * 100) } });

  it('trends: a small period and an open anonymous period are hidden and left out of every total', async () => {
    const periods = [
      survey({ id: 'p1', clonedFromId: 's1', title: 'Pulse — Jan 2026', status: 'CLOSED', opensAt: new Date('2026-01-05') }),
      survey({ id: 'p2', clonedFromId: 's1', title: 'Pulse — Feb 2026', status: 'CLOSED', opensAt: new Date('2026-02-02') }),
      survey({ id: 'p3', clonedFromId: 's1', title: 'Pulse — Mar 2026', status: 'ACTIVE', opensAt: new Date('2026-03-02') }),
    ];
    const { service } = setup({ periods, figures: { p1: figures(10, [likert(8, 10)]), p2: figures(3, [likert(0, 3)]), p3: figures(12, [likert(1, 12)]) } });
    const out = (await service.trends({ id: 'u', permissions: [] } as any, 's1')).data;
    expect(out.units.map((u: any) => [u.label, u.shown, u.hiddenNote])).toEqual([
      ['Jan 2026', true, null],
      ['Feb 2026', false, 'Too few answers to show'],
      ['Mar 2026', false, 'Shown once it closes'],
    ]);
    expect(out.units[1].responses).toBeNull();
    const line = out.questions[0];
    expect(line.points.map((p: any) => p.point?.percent ?? null)).toEqual([80, null, null]);
    expect(line.pooled).toMatchObject({ positive: 8, base: 10 });
    expect(out.responsesInFigures).toBe(10);
  });

  it('heatmap: a branch with too few answers is never shown on its own', async () => {
    const periods = [survey({ id: 'p1', clonedFromId: 's1', status: 'CLOSED' })];
    const q = { id: 'q', surveyId: 'p1', key: 'q', questionText: 'I feel valued', questionType: 'LIKERT', options: null, config: null, sectionTitle: null, sortOrder: 0, optionsFrom: null };
    const resp = (i: number, loc: string | null, opt: string) => ({ id: `r${i}`, surveyId: 'p1', locationId: loc, isAnonymous: false, channel: 'ONLINE', qualityFlags: [], answers: [{ questionId: 'q', selectedOptions: [opt], booleanValue: null, textValue: null, numberValue: null, otherText: null, comment: null }] });
    const responses = [
      ...Array.from({ length: 8 }, (_, i) => resp(i, 'L1', 'Agree')),
      ...Array.from({ length: 6 }, (_, i) => resp(10 + i, 'L2', 'Disagree')),
      resp(20, 'L3', 'Strongly disagree'),
    ];
    const { service } = setup({ periods, figures: { p1: figures(15) }, responses, questions: [q] });
    const out = (await service.heatmap({ id: 'u', permissions: [] } as any, 's1')).data as any;
    // East (1 answer) cannot stand alone or be combined alone: South (the smallest shown) joins it.
    expect(out.columns.map((c: any) => c.label)).toEqual(['North', 'Other branches (combined)']);
    expect(out.columns[1].responses).toBe(7);
    expect(out.rows[0].overall).toEqual({ percent: 53, base: 15 });
    expect(out.rows[0].cells.map((c: any) => c.percent)).toEqual([100, 0]);
  });

  it('heatmap: an open anonymous period adds nothing', async () => {
    const periods = [survey({ id: 'p1', clonedFromId: 's1', status: 'ACTIVE' })];
    const { service, prisma } = setup({ periods, figures: { p1: figures(40) } });
    const out = (await service.heatmap({ id: 'u', permissions: [] } as any, 's1')).data as any;
    expect(out.columns).toEqual([]);
    expect(prisma.surveyResponse.findMany.mock.calls[0][0].where.surveyId.in).toEqual([]);
  });

  it('themes: nothing until enough written answers, then counts only (never text)', async () => {
    const periods = [survey({ id: 'p1', clonedFromId: 's1', status: 'CLOSED' })];
    const q = { id: 'q', surveyId: 'p1', key: 'q', questionText: 'Anything else?', questionType: 'TEXTAREA', options: null, config: null, sectionTitle: null, sortOrder: 0, optionsFrom: null };
    const resp = (i: number, text: string) => ({ id: `r${i}`, surveyId: 'p1', locationId: null, isAnonymous: false, channel: 'ONLINE', qualityFlags: [], answers: [{ questionId: 'q', textValue: text, selectedOptions: null, booleanValue: null, numberValue: null, otherText: null, comment: null }] });
    const few = setup({ periods, figures: { p1: figures(6) }, responses: [resp(1, 'late'), resp(2, 'late')], questions: [q] });
    const out1 = (await few.service.themes({ id: 'u', permissions: [] } as any, 's1')).data;
    expect(out1.themes).toEqual([]);
    expect(out1.writtenAnswers).toBeNull();
    const many = setup({ periods, figures: { p1: figures(6) }, responses: ['late', 'always late', 'late again', 'kind carers', 'rota'].map((t, i) => resp(i, t)), questions: [q] });
    const out2 = (await many.service.themes({ id: 'u', permissions: [] } as any, 's1')).data;
    expect(out2.themes.find((t: any) => t.code === 'TIMEKEEPING')).toMatchObject({ count: 3 });
    expect(out2.themes.find((t: any) => t.code === 'KINDNESS')).toMatchObject({ count: null });
    expect(JSON.stringify(out2)).not.toContain('always late');
  });
});

describe('review fixes (part 5)', () => {
  it('360: a section with no CQC evidence counts towards no key question when the survey maps its sections', () => {
    const m = keyQuestionsBySection({ sections: [{ title: 'Overall', evidence: [] }, { title: 'Feeling safe', evidence: ['Safe: Safeguarding'] }] });
    expect(kqsForSection(m, ['SAFE', 'CARING', 'WELL_LED'], 'Overall')).toEqual([]);
    expect(kqsForSection(m, ['SAFE', 'CARING', 'WELL_LED'], 'Feeling safe')).toEqual(['SAFE']);
    expect(kqsForSection(m, ['SAFE'], null)).toEqual([]);
    // A survey with no section mapping at all: its own key questions.
    expect(kqsForSection(new Map(), ['SAFE', 'CARING'], 'Anything')).toEqual(['SAFE', 'CARING']);
  });

  it('scoring: a 1–5 rating averages 1–5 (MEAN) and reversed ratings count from the other end', () => {
    const rating = { id: 'r', key: 'r', questionType: 'RATING', options: null, config: { min: 1, max: 5 } };
    expect(answerScore(rating, { questionId: 'r', numberValue: 4 }, false)).toEqual({ score: 4, max: 5 });
    expect(answerScore(rating, { questionId: 'r', numberValue: 4 }, true)).toEqual({ score: 2, max: 5 });
    const s = { scales: [{ key: 'x', label: 'X', questionKeys: ['r'], reversed: [], method: 'MEAN' as const, bands: [] }] };
    const people = [4, 5, 3].map((v) => new Map([['r', { questionId: 'r', numberValue: v }]]));
    expect(scoreScales(s, [rating], people)[0].average).toBe(4);
    const pct = { scales: [{ ...s.scales[0], method: 'PERCENT_OF_MAX' as const }] };
    expect(scoreScales(pct, [rating], people)[0].average).toBe(80);
  });

  it('safeguarding words: abuse, restraint, neglect and staff exploitation; "hit and miss" is not physical harm', () => {
    expect(safeguardingKindsIn('I think this is abuse')).toContain('ABUSE');
    expect(safeguardingKindsIn('They used restraint on him')).toContain('PHYSICAL');
    expect(safeguardingKindsIn('Mum was dehydrated when I came')).toContain('NEGLECT');
    expect(safeguardingKindsIn('The agency kept my passport and I have to pay back the visa fees')).toContain('EXPLOITATION');
    expect(safeguardingKindsIn('I want to take my own life')).toContain('SELF_HARM');
    expect(safeguardingKindsIn('Visits are hit and miss')).toEqual([]);
    expect(safeguardingKindsIn('At the end my carer always says goodbye')).toEqual([]);
    expect(safeguardingKindsIn('He hit me')).toContain('PHYSICAL');
  });

  it('heatmap: a repeating survey compares branches in one period only (no subtracting one period from all)', async () => {
    const periods = [
      survey({ id: 'p1', clonedFromId: 's1', title: 'Pulse — Jan 2026', status: 'CLOSED' }),
      survey({ id: 'p2', clonedFromId: 's1', title: 'Pulse — Feb 2026', status: 'CLOSED' }),
    ];
    const q = (sid: string) => ({ id: `q-${sid}`, surveyId: sid, key: 'q', questionText: 'I feel valued', questionType: 'LIKERT', options: null, config: null, sectionTitle: null, sortOrder: 0, optionsFrom: null });
    const resp = (i: number, sid: string, loc: string) => ({ id: `r${i}`, surveyId: sid, locationId: loc, isAnonymous: false, channel: 'ONLINE', qualityFlags: [], answers: [{ questionId: `q-${sid}`, selectedOptions: ['Agree'], booleanValue: null, textValue: null, numberValue: null, otherText: null, comment: null }] });
    const { service, prisma } = setup({
      periods,
      figures: { p1: figures(10), p2: figures(10) },
      responses: Array.from({ length: 10 }, (_, i) => resp(i, 'p2', 'L1')),
      questions: [q('p2')],
    });
    const out = (await service.heatmap({ id: 'u', permissions: [] } as any, 's1')).data as any;
    expect(prisma.surveyResponse.findMany.mock.calls[0][0].where.surveyId.in).toEqual(['p2']);
    expect(out.period).toEqual({ id: 'p2', label: 'Feb 2026' });
    expect(out.note).toMatch(/^Showing Feb 2026/);
  });
});

describe('review fixes (part 5, second round)', () => {
  const textResp = (i: number, unit: string, text: string) => ({ id: `${unit}-r${i}`, surveyId: unit, locationId: null, isAnonymous: false, channel: 'ONLINE', qualityFlags: [], answers: [{ questionId: `q-${unit}`, textValue: text, selectedOptions: null, booleanValue: null, numberValue: null, otherText: null, comment: null }] });
  const textQ = (unit: string) => ({ id: `q-${unit}`, surveyId: unit, key: 'q', questionText: 'Anything else?', questionType: 'TEXTAREA', options: null, config: null, sectionTitle: null, sortOrder: 0, optionsFrom: null });

  it('themes on a repeating survey come from the latest period that can be shown only (nothing to subtract)', async () => {
    const periods = [
      survey({ id: 'p1', clonedFromId: 's1', title: 'Pulse — Jan 2026', status: 'CLOSED' }),
      survey({ id: 'p2', clonedFromId: 's1', title: 'Pulse — Feb 2026', status: 'CLOSED' }),
      survey({ id: 'p3', clonedFromId: 's1', title: 'Pulse — Mar 2026', status: 'ACTIVE' }),
    ];
    const { service, prisma } = setup({ periods, figures: { p1: figures(6), p2: figures(6), p3: figures(9) }, responses: [], questions: [textQ('p2')] });
    const out = (await service.themes({ id: 'u', permissions: [] } as any, 's1')).data;
    expect(prisma.surveyResponse.findMany.mock.calls[0][0].where.surveyId.in).toEqual(['p2']);
    expect(out.period).toEqual({ id: 'p2', label: 'Feb 2026' });
  });

  it('duplicates are compared only within periods that can be shown, never an open anonymous one', async () => {
    const periods = [survey({ id: 'p1', clonedFromId: 's1', status: 'CLOSED' }), survey({ id: 'p2', clonedFromId: 's1', status: 'ACTIVE' })];
    const same = 'The carers are wonderful and very kind people';
    const answers = (unit: string, i: number) => ({
      ...textResp(i, unit, same),
      answers: [
        ...Array.from({ length: 4 }, (_, k) => ({ questionId: `s${k}`, selectedOptions: ['Agree'], booleanValue: null, textValue: null, numberValue: null, otherText: null, comment: null })),
        { questionId: 't', textValue: same, selectedOptions: null, booleanValue: null, numberValue: null, otherText: null, comment: null },
      ],
    });
    const { service } = setup({ periods, figures: { p1: figures(6), p2: figures(6) }, responses: [answers('p1', 1), answers('p2', 2)] });
    access.mockResolvedValue({ results: true, responses: true, threshold: 5 });
    const flags = (await service.responseFlags({ id: 'u', permissions: [] } as any, 's1')).data;
    expect(flags.some((f: any) => f.flags.some((x: any) => x.flag === 'DUPLICATE'))).toBe(false);
  });

  it('a share of the most is combined from unrounded sums, then rounded once', () => {
    const scale = { key: 'a', bands: [] };
    const unit = (people: number, sum: number) => [{ key: 'a', label: 'Audit', method: 'PERCENT_OF_MAX' as const, people, average: Math.round(sum / people), band: null, bands: null, sum }];
    // 1 person at 66.6 and 2 at 66.6 each: 66.6 overall, not (67 + 67*2)/3.
    expect(combineScaleResults([scale], [unit(1, 66.4), unit(2, 133.2)])[0].average).toBe(67);
    expect(combineScaleResults([scale], [unit(2, 101), unit(2, 0)])[0].average).toBe(25);
  });

  it('a draft with no opening date or period key belongs to no year', () => {
    expect(unitYear({ createdAt: new Date('2026-03-01') })).toBeNull();
  });

  it('scores are locked once anyone has answered; an admin unlocks with a reason, audited', async () => {
    const { service, prisma } = setup({ periods: [], figures: {} });
    prisma.surveyResponse.count.mockResolvedValue(3);
    prisma.surveyPendingResponse = { count: jest.fn().mockResolvedValue(0) };
    prisma.surveyQuestion.findMany.mockResolvedValue([{ id: 'q', key: 'k', questionType: 'LIKERT', options: null, config: null }]);
    prisma.survey.update = jest.fn();
    const scoring = { scales: [{ label: 'Demands', questionKeys: ['k'], method: 'MEAN' }] };
    await expect(service.saveScoring({ id: 'u', roles: ['manager'], permissions: ['surveys.manage'] } as any, 's1', scoring)).rejects.toThrow(/locked once people have answered/);
    await expect(service.saveScoring({ id: 'u', roles: ['Admin'], permissions: [] } as any, 's1', scoring)).rejects.toThrow(/Give the reason/);
    const audit = (service as any).audit;
    await service.saveScoring({ id: 'u', roles: ['Admin'], permissions: [] } as any, 's1', scoring, undefined, 'Wrong band in the HSE tool');
    expect(audit.logAudit.mock.calls.at(-1)[0].newValues).toMatchObject({ unlockedAfterAnswers: true, reason: 'Wrong band in the HSE tool' });
  });
});
