import { SurveyRecurrence } from '@prisma/client';
import {
  checkOptionGroups,
  checkRotation,
  checkSkipMonths,
  checkWording,
  groupSummary,
  isSkippedMonth,
  libraryNotInMonths,
  asksTwoThings,
  closedAtOf,
  libraryRetention,
  libraryRetentionMonths,
  nextRunSkipping,
  parseRetentionNotice,
  retentionCutoff,
  runMonthsOf,
  promisedMinutes,
  retentionDue,
  rotatedOut,
} from './survey-platform.util';
import { SurveyPlatformService } from './survey-platform.service';
import { SurveysService } from './surveys.service';
import { checkEventTriggerInput, trainingContactRule, trainingSession } from './survey-event-triggers.util';
import { LIBRARY_EVENT_TRIGGERS } from '../../prisma/seed-lib/survey-event-triggers';
import { loadSurveyLibrary, surveyDescription, surveyLibraryMeta, surveyQuestionRows } from '../../prisma/seed-lib/survey-library';
import { CqcSurveyEvidenceService } from '../cqc-evidence/cqc-survey-evidence.service';

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

describe('repeats that skip months: never silently stopped', () => {
  it('a yearly or quarterly repeat whose every month is skipped keeps running (the setting is refused when saved)', () => {
    const yearly = new Date('2026-04-06T08:00:00Z');
    expect(runMonthsOf(yearly, SurveyRecurrence.YEARLY, TZ)).toEqual([4]);
    expect(runMonthsOf(new Date('2026-02-02T09:00:00Z'), SurveyRecurrence.QUARTERLY, TZ)).toEqual([2, 5, 8, 11]);
    const next = nextRunSkipping(yearly, SurveyRecurrence.YEARLY, yearly, new Date('2026-04-07T00:00:00Z'), TZ, [4]);
    expect(next.toISOString().slice(0, 10)).toBe('2027-04-06');
    const q = nextRunSkipping(new Date('2026-02-02T09:00:00Z'), SurveyRecurrence.QUARTERLY, new Date('2026-02-02T09:00:00Z'), new Date('2026-02-03T00:00:00Z'), TZ, [5, 8]);
    expect(q.toISOString().slice(0, 10)).toBe('2026-11-02');
  });

  it('crosses the year end, and keeps local time across the clock change', () => {
    const anchor = new Date('2026-01-15T09:00:00Z');
    const next = nextRunSkipping(anchor, SurveyRecurrence.MONTHLY, new Date('2026-11-15T09:00:00Z'), new Date('2026-11-16T00:00:00Z'), TZ, [12, 1, 2]);
    expect(next.toISOString()).toBe('2027-03-15T09:00:00.000Z');
    // April (BST): 09:00 London is 08:00 UTC.
    const spring = nextRunSkipping(anchor, SurveyRecurrence.MONTHLY, new Date('2026-02-15T09:00:00Z'), new Date('2026-02-16T00:00:00Z'), TZ, [3]);
    expect(spring.toISOString()).toBe('2026-04-15T08:00:00.000Z');
  });
});

describe('saving months to skip', () => {
  it('refuses skipping the only month a yearly repeat runs in', async () => {
    const survey = { id: 's', isCatalogue: false, clonedFromId: null, recurrence: 'YEARLY', recurrenceAnchorAt: new Date('2026-04-06T08:00:00Z'), distributeAt: null, title: 'T' };
    const surveys = { visibleSurvey: jest.fn().mockResolvedValue(survey), organisationTimeZone: jest.fn().mockResolvedValue(TZ) };
    const prisma: any = { survey: { update: jest.fn() } };
    const svc = new SurveyPlatformService(prisma, surveys as any, { logAudit: jest.fn() } as any);
    await expect(svc.saveSettings({ id: 'u' } as any, 's', { skipMonths: [4] })).rejects.toThrow(/only runs in April/);
    expect(prisma.survey.update).not.toHaveBeenCalled();
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

describe('a rotating question in a period copy', () => {
  const questionsForPeriod = (SurveysService.prototype as any).questionsForPeriod as (s: unknown) => Promise<Array<{ id: string }>>;
  const run = (questions: unknown[], made: number) =>
    questionsForPeriod.call(
      { prisma: { surveyQuestion: { findMany: jest.fn().mockResolvedValue(questions) }, survey: { count: jest.fn().mockResolvedValue(made) } } },
      { id: 'src', rotatingQuestionIds: ['a', 'b'] },
    );
  const q = (id: string, showIf: unknown = null) => ({ id, key: id, showIf });

  it('asks one bank question a period, in turn', async () => {
    const qs = [q('x'), q('a'), q('b')];
    expect((await run(qs, 0)).map((x) => x.id)).toEqual(['x', 'a']);
    expect((await run(qs, 1)).map((x) => x.id)).toEqual(['x', 'b']);
    expect((await run(qs, 2)).map((x) => x.id)).toEqual(['x', 'a']);
  });

  it('leaves out a question that depends on the one left out (a condition added later), down the chain', async () => {
    const qs = [q('a'), q('b'), q('c', { questionKey: 'b', answers: ['Yes'] }), q('d', { questionKey: 'c', answers: ['No'] }), q('e')];
    expect((await run(qs, 0)).map((x) => x.id)).toEqual(['a', 'e']);
    expect((await run(qs, 1)).map((x) => x.id)).toEqual(['b', 'c', 'd', 'e']);
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
  it('reads the ready-made privacy notice, with where the period starts', () => {
    expect(libraryRetentionMonths({ privacyNotice: 'We keep your answers for 1 year after the survey closes.' })).toBe(12);
    expect(libraryRetentionMonths({ privacyNotice: 'We keep your answers for 3 years after it closes.' })).toBe(36);
    expect(libraryRetentionMonths({ privacyNotice: 'We keep this self-assessment as a governance record.' })).toBeNull();
    expect(retentionDue(new Date('2026-01-31T12:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(parseRetentionNotice('We keep your answers for 3 years after this call, under our policy.')).toEqual({ months: 36, basis: 'FROM_ANSWER' });
    expect(parseRetentionNotice('We keep your answers for 3 years after this check-in closes.')).toEqual({ months: 36, basis: 'FROM_CLOSE' });
    expect(parseRetentionNotice('We keep the answers for 1 year in CareFlow after each self-assessment closes.')).toEqual({ months: 12, basis: 'FROM_CLOSE' });
    // Stored with the library details wins over the wording; a stored "none" is none.
    expect(libraryRetention({ retention: { months: 6, basis: 'FROM_ANSWER' }, privacyNotice: 'keep your answers for 1 year after the survey closes' })).toEqual({ months: 6, basis: 'FROM_ANSWER' });
    expect(libraryRetention({ retention: null, privacyNotice: 'keep your answers for 1 year after the survey closes' })).toBeNull();
  });

  it('every ready-made notice: the period and its starting point (from the answer for calls, reviews and conversations)', () => {
    const byRef = new Map<string, ReturnType<typeof parseRetentionNotice>>();
    for (const f of loadSurveyLibrary()) for (const s of f.surveys) byRef.set(s.reference, surveyLibraryMeta(s, f.group).retention);
    expect(byRef.size).toBe(56);
    const fromAnswer = [...byRef].filter(([, r]) => r?.basis === 'FROM_ANSWER').map(([k]) => k).sort();
    expect(fromAnswer).toEqual(
      ['SUR-FAM-002', 'SUR-FAM-005', 'SUR-PWS-001', 'SUR-PWS-002', 'SUR-PWS-006', 'SUR-PWS-007', 'SUR-PWS-009', 'SUR-PWS-020', 'SUR-STF-017', 'SUR-STF-022'].sort(),
    );
    expect(byRef.get('SUR-CQC-003')).toEqual({ months: 12, basis: 'FROM_CLOSE' });
    expect(byRef.get('SUR-PWS-010')).toEqual({ months: 36, basis: 'FROM_CLOSE' });
    expect(byRef.get('SUR-APP-001')).toEqual({ months: 12, basis: 'FROM_CLOSE' });
  });

  it('never deletes early: the cut-off is the inverse of the due day, and a closed unit closed when it really did', () => {
    const now = new Date('2026-03-31T10:00:00Z');
    const cut = retentionCutoff(now, 1);
    expect(cut.toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(retentionDue(cut, 1).getTime()).toBeLessThanOrEqual(now.getTime());
    for (const iso of ['2026-02-28T10:00:01Z', '2026-03-01T00:00:00Z']) expect(retentionDue(new Date(iso), 1).getTime()).toBeGreaterThan(cut.getTime());
    // Closed by hand before its end date (end date still to come) or with none: its last change, never earlier.
    expect(closedAtOf({ closesAt: new Date('2027-01-01T00:00:00Z'), updatedAt: new Date('2026-02-01T00:00:00Z') }).toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(closedAtOf({ closesAt: null, updatedAt: new Date('2026-02-01T00:00:00Z') }).toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(closedAtOf({ closesAt: new Date('2026-01-10T00:00:00Z'), updatedAt: new Date('2026-02-01T00:00:00Z') }).toISOString()).toBe('2026-01-10T00:00:00.000Z');
  });

  type Unit = Record<string, any>;
  const unit = (over: Unit = {}): Unit => ({
    id: 'u1',
    title: 'Pulse — Jan',
    status: 'CLOSED',
    clonedFromId: null,
    closesAt: new Date('2025-01-10T00:00:00Z'),
    updatedAt: new Date('2025-01-10T00:05:00Z'),
    deletedAt: null,
    answerRetentionMonths: 12,
    libraryReference: null,
    libraryMeta: null,
    ...over,
  });

  function setup(units: Unit[], opts: { capture?: any; linked?: any[]; openComplaints?: string[]; responses?: string[]; deletedAt?: Date | null } = {}) {
    const tx: any = {
      $executeRaw: jest.fn(),
      survey: { findUnique: jest.fn(async ({ where }: any) => ({ answersDeletedAt: opts.deletedAt ?? null, updatedAt: units.find((u) => u.id === where.id)!.updatedAt })), updateMany: jest.fn() },
      surveyResponse: {
        findMany: jest.fn(async () => (opts.responses ?? ['r1', 'r2']).map((id) => ({ id }))),
        deleteMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
      surveyAnswer: { deleteMany: jest.fn() },
      surveyPendingResponse: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      surveyAlert: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      surveyCallAttempt: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma: any = {
      survey: {
        findMany: jest.fn(async (args: any) => (args.where?.status ? (args.where.id?.gt ? [] : units) : [])),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      surveyResponse: { count: jest.fn().mockResolvedValue(2) },
      surveyPendingResponse: { count: jest.fn().mockResolvedValue(1) },
      cqcSurveyCapture: {
        findUnique: jest.fn().mockResolvedValue(opts.capture === undefined ? { outcome: 'CAPTURED', surveyUpdatedAt: new Date('2025-01-10T00:05:00Z') } : opts.capture),
      },
      surveyAlert: { findMany: jest.fn().mockResolvedValue(opts.linked ?? []) },
      feedbackRecord: { findMany: jest.fn(async ({ where }: any) => (opts.openComplaints ?? []).filter((id) => where.id.in.includes(id)).map((id) => ({ id }))) },
      safeguardingCase: { findMany: jest.fn().mockResolvedValue([]) },
      incident: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const audit = { logAudit: jest.fn() };
    return { service: new SurveyPlatformService(prisma, {} as any, audit as any), tx, audit, prisma };
  }
  const NOW = new Date('2026-02-01T00:00:00Z');

  it('deletes a closed unit’s answers once due, keeps follow-ups (without the answers) and leaves updatedAt alone; audited as counts', async () => {
    const { service, tx, audit } = setup([unit()]);
    await expect(service.runRetention(NOW)).resolves.toEqual({ units: 1, responses: 2 });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.surveyAnswer.deleteMany).toHaveBeenCalledWith({ where: { responseId: { in: ['r1', 'r2'] } } });
    expect(tx.surveyPendingResponse.deleteMany).toHaveBeenCalledWith({ where: { surveyId: 'u1' } });
    expect(tx.surveyAlert.updateMany.mock.calls[0][0].data).toEqual({ details: 'Answers deleted under the retention period.', matched: [] });
    expect(tx.surveyCallAttempt.updateMany.mock.calls[0][0].data).toEqual({ notes: null });
    // Marked done without moving updatedAt (else the CQC capture would take the empty survey again).
    expect(tx.survey.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', answersDeletedAt: null }, data: { answersDeletedAt: NOW, updatedAt: new Date('2025-01-10T00:05:00Z') } });
    const row = audit.logAudit.mock.calls[0][0];
    expect(row).toMatchObject({ action: 'survey_answers_deleted_retention', newValues: { responses: 2, months: 12, basis: 'FROM_CLOSE', whole: true } });
    expect(JSON.stringify(row)).not.toMatch(/r1|r2/);
  });

  it('keeps answers still inside the period, and those of a survey with no period', async () => {
    const recent = unit({ id: 'p2', closesAt: new Date('2025-06-10T00:00:00Z'), updatedAt: new Date('2025-06-10T00:00:00Z') });
    const none = unit({ id: 'p3', closesAt: new Date('2020-06-10T00:00:00Z'), answerRetentionMonths: null });
    const open = unit({ id: 'p4', status: 'ACTIVE', closesAt: null });
    const { service, tx } = setup([recent, none, open]);
    await expect(service.runRetention(NOW)).resolves.toEqual({ units: 0, responses: 0 });
    expect(tx.surveyResponse.deleteMany).not.toHaveBeenCalled();
  });

  it('a survey closed by hand early counts from when it closed, never from an earlier date', async () => {
    // Closed by hand on 1 Mar 2025 (its last change) with an end date of 2026: due 1 Mar 2026, not before.
    const early = unit({ closesAt: new Date('2026-12-01T00:00:00Z'), updatedAt: new Date('2025-03-01T00:00:00Z') });
    const { service, tx } = setup([early], { capture: { outcome: 'CAPTURED', surveyUpdatedAt: new Date('2025-03-01T00:00:00Z') } });
    await expect(service.runRetention(NOW)).resolves.toEqual({ units: 0, responses: 0 });
    await expect(service.runRetention(new Date('2026-03-01T00:00:01Z'))).resolves.toEqual({ units: 1, responses: 2 });
    expect(tx.surveyResponse.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('waits for the CQC evidence (totals) to be taken and up to date before deleting', async () => {
    for (const capture of [null, { outcome: 'FAILED', surveyUpdatedAt: new Date('2025-01-10T00:05:00Z') }, { outcome: 'CAPTURED', surveyUpdatedAt: new Date(0) }]) {
      const { service, tx } = setup([unit()], { capture });
      await expect(service.runRetention(NOW)).resolves.toEqual({ units: 0, responses: 0 });
      expect(tx.surveyResponse.deleteMany).not.toHaveBeenCalled();
    }
  });

  it('a second server finds it done (under the lock) and does nothing, audits nothing', async () => {
    const { service, tx, audit } = setup([unit()], { deletedAt: new Date('2026-02-01T00:00:00Z') });
    await expect(service.runRetention(NOW)).resolves.toEqual({ units: 0, responses: 0 });
    expect(tx.surveyResponse.deleteMany).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('holds answers and follow-up details linked to an open complaint; the rest goes, and the unit is not marked done', async () => {
    const linked = [
      { id: 'al-open', responseId: 'r1', linkedRecordType: 'COMPLAINT', linkedRecordId: 'c-open' },
      { id: 'al-closed', responseId: 'r2', linkedRecordType: 'COMPLAINT', linkedRecordId: 'c-closed' },
    ];
    const { service, tx, audit } = setup([unit()], { linked, openComplaints: ['c-open'], responses: ['r2'] });
    await expect(service.runRetention(NOW)).resolves.toEqual({ units: 1, responses: 1 });
    expect(tx.surveyResponse.findMany.mock.calls[0][0].where).toMatchObject({ surveyId: 'u1', id: { notIn: ['r1'] } });
    expect(tx.surveyAlert.updateMany.mock.calls[0][0].where).toMatchObject({ id: { notIn: ['al-open'] } });
    expect(tx.survey.updateMany).not.toHaveBeenCalled();
    expect(audit.logAudit.mock.calls[0][0].newValues).toMatchObject({ held: 2, whole: false });
  });

  it('counts from each answer where the notice says so: old answers go while the survey stays open', async () => {
    const calls = unit({ status: 'ACTIVE', closesAt: null, answerRetentionMonths: null, libraryMeta: { retention: { months: 36, basis: 'FROM_ANSWER' } } });
    const { service, tx, audit } = setup([calls], { responses: ['r-old'] });
    await expect(service.runRetention(NOW)).resolves.toEqual({ units: 1, responses: 1 });
    const cut = retentionCutoff(NOW, 36);
    expect(tx.surveyResponse.findMany.mock.calls[0][0].where).toEqual({ surveyId: 'u1', submittedAt: { lte: cut } });
    expect(tx.surveyPendingResponse.deleteMany).toHaveBeenCalledWith({ where: { surveyId: 'u1', createdAt: { lte: cut } } });
    expect(tx.surveyAlert.updateMany.mock.calls[0][0].where.OR).toEqual([{ responseId: { in: ['r-old'] } }, { responseId: null, createdAt: { lte: cut } }]);
    expect(tx.surveyCallAttempt.updateMany.mock.calls[0][0].where).toMatchObject({ createdAt: { lte: cut } });
    // Still open: never marked as all deleted.
    expect(tx.survey.updateMany).not.toHaveBeenCalled();
    expect(audit.logAudit.mock.calls[0][0].newValues).toMatchObject({ basis: 'FROM_ANSWER', whole: false });
  });

  it('nothing old enough on a from-the-answer survey: no transaction, no audit', async () => {
    const calls = unit({ status: 'ACTIVE', closesAt: null, answerRetentionMonths: null, libraryMeta: { retention: { months: 36, basis: 'FROM_ANSWER' } } });
    const { service, prisma, audit } = setup([calls]);
    prisma.surveyResponse.count.mockResolvedValue(0);
    prisma.surveyPendingResponse.count.mockResolvedValue(0);
    await expect(service.runRetention(NOW)).resolves.toEqual({ units: 0, responses: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('a period follows its repeating survey’s setting, never its own', async () => {
    const period = unit({ id: 'per', clonedFromId: 'src', answerRetentionMonths: null });
    const { service, prisma } = setup([period]);
    prisma.survey.findMany.mockImplementation(async (args: any) =>
      args.where?.status ? (args.where.id?.gt ? [] : [period]) : [{ id: 'src', answerRetentionMonths: 120, libraryReference: null, libraryMeta: null }],
    );
    await expect(service.runRetention(NOW)).resolves.toEqual({ units: 0, responses: 0 });
  });
});

describe('CQC evidence after retention', () => {
  it('is never taken again from a survey whose answers were deleted (the totals taken before are kept)', async () => {
    const prisma: any = {
      survey: { findFirst: jest.fn().mockResolvedValue({ id: 's1', status: 'CLOSED', answersDeletedAt: new Date('2026-01-01'), updatedAt: new Date('2025-01-01') }) },
      cqcSurveyCapture: { updateMany: jest.fn(), upsert: jest.fn() },
      cqcEvidence: { update: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    };
    const svc = new CqcSurveyEvidenceService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.captureSurvey('s1', { actorId: null, trigger: 'sweep' })).resolves.toMatchObject({ outcome: 'ANSWERS_DELETED' });
    expect(prisma.cqcEvidence.update).not.toHaveBeenCalled();
    expect(prisma.cqcEvidence.create).not.toHaveBeenCalled();
    expect(prisma.cqcSurveyCapture.updateMany.mock.calls[0][0].data.surveyUpdatedAt).toEqual(new Date('2025-01-01'));
  });
});

describe('wording checker: one idea per question', () => {
  it('flags two rated qualities or two questions joined, never lists of things', () => {
    expect(asksTwoThings('Are the carers kind and on time?')).toBe(true);
    expect(asksTwoThings('Was the office helpful and quick to reply?')).toBe(true);
    expect(asksTwoThings('Do you get on with your manager and do you feel supported?')).toBe(true);
    for (const t of [
      'Would you prefer a man or a woman to help with your personal care?',
      'Do your care workers respect your culture and beliefs?',
      'Do your care workers ask you before they start helping you wash, dress or use the toilet?',
      'Did we work well with the hospital, nurses or therapists?',
    ])
      expect(asksTwoThings(t)).toBe(false);
  });

  it('runs over the whole ready-made library with no problems (suggestions only)', () => {
    let problems = 0;
    let n = 0;
    for (const f of loadSurveyLibrary())
      for (const s of f.surveys) {
        n += 1;
        const qs = surveyQuestionRows(s).map((q, i) => ({ id: String(i), questionText: q.questionText, questionType: q.questionType, options: q.options, config: q.config, isRequired: q.isRequired }));
        problems += checkWording({ description: surveyDescription(s), isAnonymous: Boolean(s.anonymous) }, qs).filter((x) => x.severity === 'PROBLEM').length;
      }
    expect(n).toBe(56);
    expect(problems).toBe(0);
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
