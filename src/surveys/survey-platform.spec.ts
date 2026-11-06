import { SurveyRecurrence } from '@prisma/client';
import {
  checkOptionGroups,
  checkRotation,
  checkSkipMonths,
  checkWording,
  groupSummary,
  isSkippedMonth,
  libraryNotInMonths,
  libraryRetentionMonths,
  nextRunSkipping,
  promisedMinutes,
  retentionDue,
  rotatedOut,
} from './survey-platform.util';
import { SurveyPlatformService } from './survey-platform.service';
import { checkEventTriggerInput, trainingContactRule, trainingSession } from './survey-event-triggers.util';
import { LIBRARY_EVENT_TRIGGERS } from '../../prisma/seed-lib/survey-event-triggers';

const TZ = 'Europe/London';

describe('repeats that skip months', () => {
  it('moves past skipped months to the next month it runs in', () => {
    const anchor = new Date('2026-01-05T09:00:00Z');
    // After the March run, April is skipped: the next run is in May.
    const next = nextRunSkipping(anchor, SurveyRecurrence.MONTHLY, new Date('2026-03-05T09:00:00Z'), new Date('2026-03-06T00:00:00Z'), TZ, [4, 9, 10, 11]);
    expect(next.toISOString().slice(0, 10)).toBe('2026-05-05');
    const afterAug = nextRunSkipping(anchor, SurveyRecurrence.MONTHLY, new Date('2026-08-05T08:00:00Z'), new Date('2026-08-06T00:00:00Z'), TZ, [4, 9, 10, 11]);
    expect(afterAug.toISOString().slice(0, 10)).toBe('2026-12-05');
    expect(isSkippedMonth(new Date('2026-04-01T09:00:00Z'), [4], TZ)).toBe(true);
    expect(isSkippedMonth(new Date('2026-04-01T09:00:00Z'), [], TZ)).toBe(false);
  });

  it('reads the months a ready-made survey does not run in, and checks the setting', () => {
    const when = 'Monthly on the first working day, open 7 days, in January, February…; not in April, September, October or November, when a longer all-staff survey goes out instead';
    expect(libraryNotInMonths({ timing: { when } })).toEqual([4, 9, 10, 11]);
    expect(() => checkSkipMonths([0])).toThrow(/1 \(January\)/);
    expect(() => checkSkipMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toThrow(/at least 2 months/);
    expect(checkSkipMonths([11, 4, 4])).toEqual([4, 11]);
  });
});

describe('a rotating question', () => {
  const q = (id: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({ id, key: id, questionText: `Q ${id}`, questionType: 'LIKERT', showIf: null, sortOrder, ...extra });

  it('each period asks one bank question, in turn', () => {
    expect([...rotatedOut(['a', 'b', 'c'], 0)].sort()).toEqual(['b', 'c']);
    expect([...rotatedOut(['a', 'b', 'c'], 1)].sort()).toEqual(['a', 'c']);
    expect([...rotatedOut(['a', 'b', 'c'], 5)].sort()).toEqual(['a', 'b']);
    expect(rotatedOut(['a'], 3).size).toBe(0);
  });

  it('never rotates a question another depends on, or one asked only after another answer', () => {
    const qs = [q('a', 0), q('b', 1), q('c', 2, { showIf: { questionKey: 'a', answers: ['Yes'] } })];
    expect(() => checkRotation(['a', 'b'], qs)).toThrow(/depends on/);
    expect(() => checkRotation(['b', 'c'], qs)).toThrow(/asked only after/);
    expect(() => checkRotation(['b'], qs)).toThrow(/2 to 12/);
    expect(checkRotation(['b', 'a'].filter((x) => x !== 'a').concat('d'), [...qs, q('d', 3)])).toEqual(['b', 'd']);
  });
});

describe('grouped answer choices', () => {
  const options = ['Hoist', 'Stand aid', 'Walking frame', 'Shower', 'Bath'];
  it('checks groups against the question’s answers', () => {
    expect(() => checkOptionGroups([{ heading: 'Moving', options: ['Hoist'] }], 'SINGLE_SELECT', options)).toThrow(/2 to 12/);
    expect(() => checkOptionGroups([{ heading: 'A', options: ['Hoist'] }, { heading: 'B', options: ['Hoist'] }], 'SINGLE_SELECT', options)).toThrow(/two groups/);
    expect(() => checkOptionGroups([{ heading: 'A', options: ['Lift'] }, { heading: 'B', options: ['Bath'] }], 'MULTI_SELECT', options)).toThrow(/not one of/);
    expect(() => checkOptionGroups([{ heading: 'A', options: ['Hoist'] }, { heading: 'B', options: ['Bath'] }], 'LIKERT', options)).toThrow(/Only single- and multi-choice/);
    expect(checkOptionGroups([], 'SINGLE_SELECT', options)).toBeNull();
  });

  it('counts people per group, and folds small groups where answers can be linked to no one', () => {
    const groups = [
      { heading: 'Moving', options: ['Hoist', 'Stand aid', 'Walking frame'] },
      { heading: 'Washing', options: ['Shower', 'Bath'] },
    ];
    const answers = [...Array.from({ length: 6 }, () => ['Hoist', 'Stand aid']), ['Shower'], ['Bath']];
    expect(groupSummary(groups, answers, { min: 5, fold: false })!.groups).toEqual([
      { heading: 'Moving', count: 6, percent: 75 },
      { heading: 'Washing', count: 2, percent: 25 },
    ]);
    // Anonymous: "Washing" (2) is too small alone, and too small even folded: nothing by group is shown.
    expect(groupSummary(groups, answers, { min: 5, fold: true })).toMatchObject({ groups: [], note: expect.stringMatching(/at least 5/) });
  });
});

describe('answer retention', () => {
  it('reads the ready-made privacy notice', () => {
    expect(libraryRetentionMonths({ privacyNotice: 'We keep your answers for 1 year after the survey closes.' })).toBe(12);
    expect(libraryRetentionMonths({ privacyNotice: 'We keep your answers for 3 years after it closes.' })).toBe(36);
    expect(libraryRetentionMonths({ privacyNotice: 'We keep this self-assessment as a governance record.' })).toBeNull();
    expect(retentionDue(new Date('2026-01-31T12:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  function setup(units: any[]) {
    const tx: any = {
      surveyResponse: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]), deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      surveyAnswer: { deleteMany: jest.fn() },
      surveyPendingResponse: { deleteMany: jest.fn() },
      surveyAlert: { updateMany: jest.fn() },
      survey: { update: jest.fn() },
    };
    const prisma: any = {
      survey: { findMany: jest.fn(async (args: any) => (args.where?.status === 'CLOSED' ? units : [])), findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const audit = { logAudit: jest.fn() };
    return { service: new SurveyPlatformService(prisma, {} as any, audit as any), tx, audit };
  }

  it('deletes the answers of a survey closed longer than its period, keeps follow-ups (without the answers), audited as counts', async () => {
    const unit = { id: 'p1', title: 'Pulse — Jan', clonedFromId: null, closesAt: new Date('2025-01-10T00:00:00Z'), answerRetentionMonths: 12, libraryReference: null, libraryMeta: null };
    const { service, tx, audit } = setup([unit]);
    await expect(service.runRetention(new Date('2026-02-01T00:00:00Z'))).resolves.toEqual({ units: 1, responses: 2 });
    expect(tx.surveyAnswer.deleteMany).toHaveBeenCalledWith({ where: { responseId: { in: ['r1', 'r2'] } } });
    expect(tx.surveyAlert.updateMany.mock.calls[0][0].data).toEqual({ details: 'Answers deleted under the retention period.', matched: [] });
    expect(audit.logAudit.mock.calls[0][0]).toMatchObject({ action: 'survey_answers_deleted_retention', newValues: { responses: 2, months: 12 } });
  });

  it('keeps answers still inside the period, and those of a survey with no period', async () => {
    const recent = { id: 'p2', title: 'x', clonedFromId: null, closesAt: new Date('2025-06-10T00:00:00Z'), answerRetentionMonths: 12, libraryReference: null, libraryMeta: null };
    const none = { id: 'p3', title: 'y', clonedFromId: null, closesAt: new Date('2020-06-10T00:00:00Z'), answerRetentionMonths: null, libraryReference: null, libraryMeta: null };
    const { service, tx } = setup([recent, none]);
    await expect(service.runRetention(new Date('2026-02-01T00:00:00Z'))).resolves.toEqual({ units: 0, responses: 0 });
    expect(tx.surveyResponse.deleteMany).not.toHaveBeenCalled();
  });
});

describe('wording checker', () => {
  const base = { isRequired: false, config: null, options: null };
  it('finds the library standard’s problems and says how to fix them', () => {
    const findings = checkWording({ description: 'This takes about 2 minutes.', isAnonymous: true }, [
      { ...base, id: 'q1', questionText: 'I do not feel supported by my manager', questionType: 'LIKERT' },
      { ...base, id: 'q2', questionText: 'Are the carers kind and on time?', questionType: 'YES_NO' },
      { ...base, id: 'q3', questionText: 'How good was the excellent service we utilised?', questionType: 'RATING' },
      { ...base, id: 'q4', questionText: 'Please give your full name', questionType: 'TEXT', isRequired: true },
      { ...base, id: 'q5', questionText: 'Which applies?', questionType: 'SINGLE_SELECT', options: ['Yes', 'No', "Don't know"] },
      ...Array.from({ length: 12 }, (_, i) => ({ ...base, id: `t${i}`, questionText: `Tell us more ${i}`, questionType: 'TEXTAREA' })),
    ]);
    const rules = (id: string | null) => findings.filter((f) => f.questionId === id).map((f) => f.rule);
    expect(rules('q1')).toContain('NEGATIVE');
    expect(rules('q2')).toContain('ONE_IDEA');
    expect(rules('q3')).toEqual(expect.arrayContaining(['LEADING', 'PLAIN_ENGLISH']));
    expect(rules('q4')).toEqual(expect.arrayContaining(['ANONYMITY', 'FORCED_WRITING']));
    expect(rules('q5')).toContain('SCALE');
    expect(findings.find((f) => f.rule === 'TIME' && f.severity === 'PROBLEM')?.message).toMatch(/promises 2 minutes/);
    expect(promisedMinutes('It takes 3 to 5 minutes')).toBe(5);
  });

  it('a well-written survey has nothing to fix', () => {
    const findings = checkWording({ description: 'It takes about 2 minutes.', isAnonymous: false }, [
      { ...base, id: 'a', questionText: 'My manager supports me', questionType: 'LIKERT' },
      { ...base, id: 'b', questionText: 'Do carers arrive on time?', questionType: 'YES_NO' },
    ]);
    expect(findings.filter((f) => f.severity === 'PROBLEM')).toEqual([]);
  });
});

describe('training feedback from Learning (decision S4)', () => {
  it('Part A is exempt from the 4-week rule; Part B is held back and skipped, never delayed', () => {
    expect(trainingContactRule('A')).toMatchObject({ holdBack: false, countsAsContact: false, reason: expect.stringMatching(/S4/) });
    expect(trainingContactRule('B')).toMatchObject({ holdBack: true, countsAsContact: true, whenHeld: 'SKIP', reason: expect.stringMatching(/S4/) });
  });

  it('each session gets its own copy named with the course, date and trainer', () => {
    expect(trainingSession({ id: 'e1', title: 'Session', courseTitle: 'Moving and handling', endDay: '2026-03-12', trainer: 'A. Trainer' })).toEqual({
      periodKey: 'training:e1',
      label: 'Moving and handling, 12 Mar 2026, A. Trainer',
      trainingEventId: 'e1',
      openDays: 14,
    });
  });

  it('is a staff event with Part A or B, and the library suggests Part A for SUR-STF-005', () => {
    const ok = checkEventTriggerInput({ event: 'TRAINING_ATTENDED', delayDays: 42, windowDays: 14, options: { part: 'B' } }, { audience: 'EMPLOYEE', today: '2026-11-07' });
    expect(ok).toMatchObject({ ok: true, trigger: { options: { part: 'B' } } });
    expect(checkEventTriggerInput({ event: 'TRAINING_ATTENDED', delayDays: 0, windowDays: 7 }, { audience: 'SERVICE_USER', today: '2026-11-07' })).toMatchObject({ ok: false });
    expect(LIBRARY_EVENT_TRIGGERS['SUR-STF-005']).toMatchObject({ event: 'TRAINING_ATTENDED', options: { part: 'A' } });
  });
});
