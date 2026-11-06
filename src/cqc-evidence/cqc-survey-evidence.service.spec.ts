import { CqcSurveyEvidenceService } from './cqc-survey-evidence.service';
import { CQC_RECAPTURE_MARK } from '../surveys/survey-pending-responses';

/** The ready-made details on an adopted template (Survey.libraryMeta), the parts the plan reads. */
const libraryMeta = {
  type: 'survey-library',
  group: { short: 'PWS' },
  cqc: { keyQuestions: ['CARING'], qualityStatements: ['Kindness, compassion and dignity'] },
  sections: [{ title: 'How you are treated', evidence: ['Kindness, compassion and dignity'] }],
};

const statement = {
  id: 'st-kind',
  code: 'CARING_KINDNESS',
  title: 'Kindness, compassion and dignity',
  aliases: [],
  keyQuestionCode: 'CARING',
};

const framework: any = {
  id: 'fw-1',
  version: 1,
  code: 'CQC_SAF',
  title: 'Single assessment framework',
  note: null,
  checkedOn: null,
  sources: null,
  keyQuestions: [],
  statements: [statement],
  categories: [{ code: 'PEOPLES_EXPERIENCE', title: "People's experience", description: '' }],
};

const survey = (over: Record<string, unknown> = {}): any => ({
  id: 's1',
  targetKind: 'SERVICE_USER',
  clonedFromId: null,
  createdFromTemplateId: null,
  libraryMeta: null,
  libraryReference: null,
  ...over,
});

function setup(rows: any[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const prisma: any = {
    survey: {
      findUnique: jest.fn(async (args: any) => byId.get(args.where.id) ?? null),
      findMany: jest.fn(async (args: any) => (args.where.id.in as string[]).map((id) => byId.get(id)).filter(Boolean)),
    },
    cqcSurveyStatementChoice: { findFirst: jest.fn(async () => null) },
    surveyQuestion: {
      findMany: jest.fn(async () => [
        { id: 'q1', sectionTitle: 'How you are treated' },
        { id: 'q2', sectionTitle: 'Anything else' },
      ]),
    },
    auditLog: { findMany: jest.fn(async () => []) },
  };
  const service = new CqcSurveyEvidenceService(prisma, {} as any, { logAudit: jest.fn() } as any, {
    inActiveVersion: jest.fn(),
  } as any);
  return { service, prisma };
}

describe('CqcSurveyEvidenceService.statementPlan — ready-made origin', () => {
  const template = survey({
    id: 't1',
    isTemplate: true,
    libraryMeta,
    libraryReference: 'SUR-PWS-003',
  });

  it('a survey started from a ready-made template evidences its statements (Survey.createdFromTemplateId)', async () => {
    const started = survey({ id: 's1', createdFromTemplateId: 't1', libraryReference: 'SUR-PWS-003' });
    const { service, prisma } = setup([template, started]);
    const plan = await service.statementPlan(started, framework);
    expect(plan).toMatchObject({ source: 'library', libraryReference: 'SUR-PWS-003', groupShort: 'PWS' });
    expect(plan.statements.map((s) => s.id)).toEqual(['st-kind']);
    expect([...(plan.questionIdsByStatement?.get('st-kind') ?? [])]).toEqual(['q1']);
    // No longer worked out from the creation audit entry.
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('a period of a repeating survey started from the template', async () => {
    const source = survey({ id: 'src', createdFromTemplateId: 't1' });
    const period = survey({ id: 'p1', clonedFromId: 'src' });
    const { service } = setup([template, source, period]);
    const plan = await service.statementPlan(period, framework);
    expect(plan.source).toBe('library');
    expect(plan.statements.map((s) => s.id)).toEqual(['st-kind']);
  });

  it('capture leaves out answers given without a name while fewer than 5 people answered that way', async () => {
    const closed = survey({
      id: 's1',
      title: 'Your views',
      status: 'CLOSED',
      isAnonymous: false,
      isTemplate: false,
      libraryMeta,
      libraryReference: 'SUR-PWS-003',
      locationIds: [],
      opensAt: new Date('2026-10-01T00:00:00.000Z'),
      closesAt: new Date('2026-10-31T00:00:00.000Z'),
      updatedAt: new Date('2026-10-31T00:00:00.000Z'),
      createdAt: new Date('2026-09-30T00:00:00.000Z'),
    });
    const run = async (chosenWithoutName: number) => {
      const { service, prisma } = setup([closed]);
      Object.assign(prisma, {
        survey: { ...prisma.survey, findFirst: jest.fn(async () => closed) },
        cqcSurveyCapture: { upsert: jest.fn(async () => ({})) },
        surveyRecipient: { groupBy: jest.fn(async () => [{ status: 'COMPLETED', _count: { _all: 12 } }]) },
        surveyResponse: {
          count: jest.fn(async (args: any) => (args.where.channel ? chosenWithoutName : args.where.isAnonymous ? chosenWithoutName : 12)),
        },
        surveyAnswer: { findMany: jest.fn(async () => []) },
        surveyPendingResponse: { groupBy: jest.fn(async () => []), count: jest.fn(async () => 0) },
        cqcEvidence: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'ev-1' })) },
      });
      prisma.surveyQuestion.findMany.mockImplementation(async () => [
        {
          id: 'q1',
          questionText: 'Overall, how was your experience of our service?',
          questionType: 'SINGLE_SELECT',
          options: ['Very good', 'Good', 'Neither good nor poor', 'Poor', 'Very poor'],
          sectionTitle: 'How you are treated',
          sortOrder: 0,
        },
      ]);
      (service as any).framework.active = jest.fn(async () => framework);
      await service.captureSurvey('s1', { actorId: null, trigger: 'close', now: new Date('2026-11-01T00:00:00.000Z') });
      return prisma.surveyAnswer.findMany.mock.calls[0][0].where.response;
    };
    expect(await run(2)).toEqual({
      surveyId: 's1',
      NOT: { isAnonymous: true, channel: { notIn: ['TELEPHONE', 'PAPER', 'IN_PERSON'] } },
    });
    expect(await run(5)).toEqual({ surveyId: 's1' });
  });

  it('capture writes answers still waiting (not linked to anyone) before counting, and counts them', async () => {
    const closed = survey({
      id: 's1',
      title: 'Your views',
      status: 'CLOSED',
      isAnonymous: true,
      isTemplate: false,
      libraryMeta,
      libraryReference: 'SUR-PWS-003',
      locationIds: [],
      opensAt: new Date('2026-10-01T00:00:00.000Z'),
      closesAt: new Date('2026-10-31T00:00:00.000Z'),
      updatedAt: new Date('2026-10-31T00:00:00.000Z'),
      createdAt: new Date('2026-09-30T00:00:00.000Z'),
    });
    const { service, prisma } = setup([closed]);
    const order: string[] = [];
    const day = new Date('2026-10-20T23:00:00.000Z');
    const waiting = [1, 2].map((n) => ({
      id: `held-${n}`,
      surveyId: 's1',
      isAnonymous: false,
      channel: 'ONLINE',
      createdAt: day,
      payload: { locationId: null, respondentRelation: null, answers: [{ questionId: 'q1', booleanValue: null, textValue: null, numberValue: null, selectedOptions: ['Good'], otherText: null, comment: null }] },
    }));
    let written = 0;
    Object.assign(prisma, {
      survey: { ...prisma.survey, findFirst: jest.fn(async () => closed) },
      cqcSurveyCapture: {
        upsert: jest.fn(async () => {
          order.push('record');
          return {};
        }),
        updateMany: jest.fn(async () => {
          order.push('mark');
          return { count: 1 };
        }),
      },
      surveyRecipient: { groupBy: jest.fn(async () => [{ status: 'COMPLETED', _count: { _all: 6 } }]) },
      surveyPendingResponse: {
        groupBy: jest.fn(async () => [{ surveyId: 's1', _count: { _all: 2 } }]),
        findMany: jest.fn(async () => waiting),
        deleteMany: jest.fn(async () => ({ count: 2 })),
        count: jest.fn(async () => 0),
      },
      surveyResponse: {
        createMany: jest.fn(async (args: any) => {
          for (const _ of args.data) {
            order.push('write');
            written += 1;
          }
          return { count: args.data.length };
        }),
        count: jest.fn(async () => {
          order.push('count');
          return 4 + written;
        }),
      },
      surveyAnswer: { findMany: jest.fn(async () => []), createMany: jest.fn(async (args: any) => ({ count: args.data.length })) },
      cqcEvidence: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'ev-1' })) },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    });
    prisma.surveyQuestion.findMany.mockImplementation(async () => [
      {
        id: 'q1',
        questionText: 'Overall, how was your experience of our service?',
        questionType: 'SINGLE_SELECT',
        options: ['Very good', 'Good', 'Neither good nor poor', 'Poor', 'Very poor'],
        sectionTitle: 'How you are treated',
        sortOrder: 0,
      },
    ]);
    (service as any).framework.active = jest.fn(async () => framework);
    await service.captureSurvey('s1', { actorId: null, trigger: 'sweep', now: new Date('2026-11-01T00:00:00.000Z') });
    expect(order.indexOf('write')).toBeGreaterThanOrEqual(0);
    expect(order.lastIndexOf('write')).toBeLessThan(order.indexOf('count'));
    // An earlier capture is marked out of date by the write, then this capture records over the mark.
    expect(order.indexOf('mark')).toBeLessThan(order.lastIndexOf('record'));
    expect(prisma.cqcSurveyCapture.upsert.mock.calls.at(-1)[0].update.surveyUpdatedAt).toEqual(closed.updatedAt);
    expect([...prisma.surveyPendingResponse.deleteMany.mock.calls[0][0].where.id.in].sort()).toEqual(['held-1', 'held-2']);
    const metrics = prisma.cqcEvidence.create.mock.calls[0][0].data.metrics;
    expect(JSON.stringify(metrics)).toMatch(/"responses":6/);
  });

  it('answers written at capture are dated in the organisation’s time zone', async () => {
    const closed = survey({ id: 's1', status: 'CLOSED', isAnonymous: true });
    const prisma: any = {
      survey: { findFirst: jest.fn(async () => closed), findMany: jest.fn(async () => [{ id: 's1', status: 'CLOSED', closesAt: null, deletedAt: null }]) },
      surveyPendingResponse: {
        groupBy: jest.fn(async () => [{ surveyId: 's1', _count: { _all: 1 } }]),
        findMany: jest.fn(async () => [
          { id: 'held-1', surveyId: 's1', isAnonymous: false, channel: 'ONLINE', createdAt: new Date('2026-10-01T00:00:00.000Z'), payload: { answers: [] } },
        ]),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      surveyResponse: { createMany: jest.fn(async () => ({ count: 1 })) },
      surveyAnswer: { createMany: jest.fn(async () => ({ count: 0 })) },
      cqcSurveyCapture: { updateMany: jest.fn(async () => ({ count: 0 })), upsert: jest.fn(async () => ({})) },
      cqcSurveyStatementChoice: { findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    const orgSettings = { getOperationalTimezone: jest.fn(async () => 'America/New_York') };
    const service = new CqcSurveyEvidenceService(prisma, {} as any, { logAudit: jest.fn() } as any, {} as any, orgSettings as any);
    (service as any).framework.active = jest.fn(async () => framework);
    await service.captureSurvey('s1', { actorId: null, trigger: 'sweep', now: new Date('2026-11-10T02:00:00.000Z') });
    // 02:00 UTC on 10 November is 9 November in New York: dated midnight there.
    expect(prisma.surveyResponse.createMany.mock.calls[0][0].data[0].submittedAt).toEqual(new Date('2026-11-09T05:00:00.000Z'));
  });

  /** A live closed one-off survey, as the mark check reads it. */
  const liveClosed = (id: string) => ({ id, status: 'CLOSED', deletedAt: null, isTemplate: false, isCatalogue: false, clones: [] });
  /** The sweep's own survey query (not the mark check). */
  const sweepQuery = (prisma: any) => prisma.survey.findMany.mock.calls.find((c: any[]) => !c[0].select?.clones)[0];

  describe('the recapture sweep takes the longest-waiting marks first, and never starves', () => {
    const now = new Date('2026-11-20T10:00:00.000Z');
    type Row = { surveyId: string; surveyUpdatedAt: Date; outcome: string; capturedAt: Date };
    const isMark = (d: Date) => d.getTime() === CQC_RECAPTURE_MARK.getTime();
    /** A store of capture rows and surveys, read the way the database would. */
    const store = (captures: Row[], surveys: Record<string, any>) => {
      const rows = captures.map((c) => ({ ...c }));
      const cmp = (a: Row, b: Row) => a.capturedAt.getTime() - b.capturedAt.getTime() || a.surveyId.localeCompare(b.surveyId);
      const prisma: any = {
        cqcSurveyCapture: {
          findMany: jest.fn(async (args: any) => {
            if (!args.where.surveyUpdatedAt) return rows.filter((r) => args.where.surveyId.in.includes(r.surveyId));
            const after = args.where.OR;
            return rows
              .filter((r) => isMark(r.surveyUpdatedAt))
              .filter(
                (r) =>
                  !after ||
                  r.capturedAt.getTime() > after[0].capturedAt.gt.getTime() ||
                  (r.capturedAt.getTime() === after[1].capturedAt.getTime() && r.surveyId > after[1].surveyId.gt),
              )
              .sort(cmp)
              .slice(0, args.take)
              .map((r) => ({ surveyId: r.surveyId, capturedAt: r.capturedAt }));
          }),
          updateMany: jest.fn(async (args: any) => {
            let count = 0;
            for (const r of rows) {
              if (args.where.surveyId.in.includes(r.surveyId) && isMark(r.surveyUpdatedAt)) {
                Object.assign(r, args.data);
                count += 1;
              }
            }
            return { count };
          }),
        },
        survey: {
          findMany: jest.fn(async (args: any) => {
            if (args.select?.clones) return (args.where.id.in as string[]).map((id) => surveys[id]).filter(Boolean);
            // The sweep's own query: closed, live, not a repeating survey's own row; marked ones here.
            const marked: string[] = args.where.OR?.[1]?.id.in ?? [];
            return marked
              .map((id) => surveys[id])
              .filter((s: any) => s && s.status === 'CLOSED' && !s.deletedAt && !s.clones.length)
              .map((s: any) => ({ id: s.id, updatedAt: s.updatedAt }));
          }),
        },
      };
      const service = new CqcSurveyEvidenceService(prisma, {} as any, { logAudit: jest.fn() } as any, {} as any);
      const captured: string[] = [];
      jest.spyOn(service, 'captureSurvey').mockImplementation(async (id: string) => {
        captured.push(id);
        return { surveyId: id, outcome: 'CAPTURED', created: 0, updated: 1, skipped: 0, evidenceIds: [], detail: null };
      });
      return { service, prisma, captured, rows };
    };
    const closedAt = new Date('2026-06-30T00:00:00.000Z');
    const live = (id: string, over: Record<string, unknown> = {}) => ({ ...liveClosed(id), updatedAt: closedAt, ...over });
    const mark = (surveyId: string, capturedAt: Date): Row => ({ surveyId, surveyUpdatedAt: CQC_RECAPTURE_MARK, outcome: 'CAPTURED', capturedAt });
    const stillMarked = (rows: Row[], id: string) => isMark(rows.find((r) => r.surveyId === id)!.surveyUpdatedAt);

    it('marks are read oldest capture first, in a fixed order', async () => {
      const { service, prisma } = store([], {});
      await service.captureRecentlyClosed(now);
      expect(prisma.cqcSurveyCapture.findMany.mock.calls[0][0]).toMatchObject({
        where: { surveyUpdatedAt: CQC_RECAPTURE_MARK },
        orderBy: [{ capturedAt: 'asc' }, { surveyId: 'asc' }],
        take: 200,
      });
    });

    it('250 older marks on deleted surveys never starve a real one: they are cleared, the real one is captured', async () => {
      const surveys: Record<string, any> = { real: live('real') };
      const captures: Row[] = [];
      for (let i = 0; i < 250; i += 1) {
        const id = `gone-${String(i).padStart(3, '0')}`;
        surveys[id] = live(id, { deletedAt: new Date('2026-08-01T00:00:00.000Z') });
        captures.push(mark(id, new Date(Date.UTC(2026, 6, 1, 0, i))));
      }
      captures.push(mark('real', new Date('2026-10-01T00:00:00.000Z')));
      const { service, captured, rows } = store(captures, surveys);
      expect(await service.captureRecentlyClosed(now)).toEqual({ checked: 1, captured: 1 });
      expect(captured).toEqual(['real']);
      // Cleared (no longer marked), so they are not read again.
      expect(rows.filter((r) => r.surveyId.startsWith('gone-') && isMark(r.surveyUpdatedAt))).toEqual([]);
      expect(rows.find((r) => r.surveyId === 'gone-000')!.surveyUpdatedAt).toEqual(now);
    });

    it('marks on a missing survey, a template or a repeating survey’s own row are cleared; a re-opened survey keeps its mark', async () => {
      const surveys = {
        series: live('series', { clones: [{ id: 'p1' }] }),
        tpl: live('tpl', { isTemplate: true }),
        reopened: live('reopened', { status: 'ACTIVE' }),
        real: live('real'),
      };
      const at = (d: number) => new Date(Date.UTC(2026, 6, d));
      const { service, captured, rows } = store(
        [mark('missing', at(1)), mark('series', at(2)), mark('tpl', at(3)), mark('reopened', at(4)), mark('real', at(5))],
        surveys,
      );
      await service.captureRecentlyClosed(now);
      expect(captured).toEqual(['real']);
      expect(['missing', 'series', 'tpl'].filter((id) => stillMarked(rows, id))).toEqual([]);
      expect(stillMarked(rows, 'reopened')).toBe(true);
    });

    it('with more real marks than one run takes, the longest-waiting go first', async () => {
      const surveys: Record<string, any> = {};
      const captures: Row[] = [];
      for (let i = 0; i < 230; i += 1) {
        // Ids in the reverse order of their age, so id order alone would pick the newest.
        const id = `s-${String(229 - i).padStart(3, '0')}`;
        surveys[id] = live(id);
        captures.push(mark(id, new Date(Date.UTC(2026, 6, 1, 0, i))));
      }
      const { service, prisma, captured } = store(captures, surveys);
      await service.captureRecentlyClosed(now);
      const considered: string[] = sweepQuery(prisma).where.OR[1].id.in;
      expect(considered).toHaveLength(200);
      expect(considered[0]).toBe('s-229');
      expect(considered).not.toContain('s-000');
      expect(captured).toHaveLength(20);
    });
  });

  describe('the sweep reads closed surveys a page at a time, oldest first', () => {
    const now = new Date('2026-11-20T10:00:00.000Z');
    /** Closed surveys and their captures, read (and paged) the way the database would. */
    const pagedStore = (surveys: Array<{ id: string; updatedAt: Date }>, captured: Set<string>) => {
      const sorted = [...surveys].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id));
      const prisma: any = {
        cqcSurveyCapture: {
          findMany: jest.fn(async (args: any) =>
            args.where.surveyUpdatedAt
              ? []
              : (args.where.surveyId.in as string[])
                  .filter((id) => captured.has(id))
                  .map((id) => {
                    const s = sorted.find((x) => x.id === id)!;
                    return { surveyId: id, surveyUpdatedAt: s.updatedAt, outcome: 'CAPTURED', capturedAt: s.updatedAt };
                  }),
          ),
        },
        survey: {
          findMany: jest.fn(async (args: any) => {
            const cursor = args.where.AND?.[0]?.OR;
            return sorted
              .filter(
                (s) =>
                  !cursor ||
                  s.updatedAt.getTime() > cursor[0].updatedAt.gt.getTime() ||
                  (s.updatedAt.getTime() === cursor[1].updatedAt.getTime() && s.id > cursor[1].id.gt),
              )
              .slice(0, args.take);
          }),
        },
      };
      const service = new CqcSurveyEvidenceService(prisma, {} as any, { logAudit: jest.fn() } as any, {} as any);
      const taken: string[] = [];
      jest.spyOn(service, 'captureSurvey').mockImplementation(async (id: string) => {
        taken.push(id);
        return { surveyId: id, outcome: 'CAPTURED', created: 0, updated: 1, skipped: 0, evidenceIds: [], detail: null };
      });
      return { service, prisma, taken };
    };

    it('more already-handled closes than one page do not hide a newer close', async () => {
      const handled = Array.from({ length: 250 }, (_, i) => ({
        id: `done-${String(i).padStart(3, '0')}`,
        updatedAt: new Date(Date.UTC(2026, 10, 10, 0, i)),
      }));
      const fresh = { id: 'fresh', updatedAt: new Date('2026-11-20T09:59:00.000Z') };
      const { service, prisma, taken } = pagedStore([...handled, fresh], new Set(handled.map((s) => s.id)));
      expect(await service.captureRecentlyClosed(now)).toEqual({ checked: 1, captured: 1 });
      expect(taken).toEqual(['fresh']);
      const pages = prisma.survey.findMany.mock.calls.map((c: any[]) => c[0]);
      expect(pages).toHaveLength(2);
      expect(pages[0]).toMatchObject({ orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 200 });
      // The second page starts after the last survey of the first.
      expect(pages[1].where.AND[0].OR[1]).toEqual({ updatedAt: handled[199]!.updatedAt, id: { gt: 'done-199' } });
    });

    it('stops reading once a batch is due, taking the oldest first', async () => {
      const waiting = Array.from({ length: 450 }, (_, i) => ({
        id: `w-${String(i).padStart(3, '0')}`,
        updatedAt: new Date(Date.UTC(2026, 10, 10, 0, i)),
      }));
      const { service, prisma, taken } = pagedStore(waiting, new Set());
      expect(await service.captureRecentlyClosed(now)).toEqual({ checked: 20, captured: 20 });
      expect(taken).toEqual(waiting.slice(0, 20).map((s) => s.id));
      expect(prisma.survey.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('late answers: captures marked out of date are taken again', () => {
    const sweep = (marked: string[], surveys: Array<{ id: string; updatedAt: Date }>, captures: any[]) => {
      const prisma: any = {
        cqcSurveyCapture: {
          findMany: jest.fn(async (args: any) =>
            args.where.surveyUpdatedAt ? marked.map((surveyId) => ({ surveyId, capturedAt: new Date(0) })) : captures,
          ),
        },
        survey: {
          findMany: jest.fn(async (args: any) =>
            args.select?.clones ? args.where.id.in.map((id: string) => liveClosed(id)) : surveys,
          ),
        },
      };
      const service = new CqcSurveyEvidenceService(prisma, {} as any, { logAudit: jest.fn() } as any, {} as any);
      const captured: string[] = [];
      jest.spyOn(service, 'captureSurvey').mockImplementation(async (id: string) => {
        captured.push(id);
        return { surveyId: id, outcome: 'CAPTURED', created: 0, updated: 1, skipped: 0, evidenceIds: [], detail: null };
      });
      return { service, prisma, captured };
    };
    const now = new Date('2026-11-20T10:00:00.000Z');

    it('a survey that closed long ago (outside the 14-day look-back) is captured again once marked', async () => {
      const closedLongAgo = { id: 'old', updatedAt: new Date('2026-06-30T00:00:00.000Z') };
      const { service, prisma, captured } = sweep(['old'], [closedLongAgo], [
        { surveyId: 'old', surveyUpdatedAt: CQC_RECAPTURE_MARK, outcome: 'CAPTURED', capturedAt: new Date('2026-07-01T00:00:00.000Z') },
      ]);
      expect(await service.captureRecentlyClosed(now)).toEqual({ checked: 1, captured: 1 });
      expect(captured).toEqual(['old']);
      expect(prisma.cqcSurveyCapture.findMany.mock.calls[0][0].where).toEqual({ surveyUpdatedAt: CQC_RECAPTURE_MARK });
      const where = sweepQuery(prisma).where;
      expect(where.OR).toEqual([{ updatedAt: { gte: expect.any(Date) } }, { id: { in: ['old'] } }]);
      expect(where).toMatchObject({ status: 'CLOSED', deletedAt: null, clones: { none: {} } });
    });

    it('nothing marked: the sweep is unchanged (recent closes only, each handled once)', async () => {
      const recent = { id: 'recent', updatedAt: new Date('2026-11-19T00:00:00.000Z') };
      const { service, prisma, captured } = sweep([], [recent], [
        { surveyId: 'recent', surveyUpdatedAt: recent.updatedAt, outcome: 'CAPTURED', capturedAt: recent.updatedAt },
      ]);
      expect(await service.captureRecentlyClosed(now)).toEqual({ checked: 0, captured: 0 });
      expect(captured).toEqual([]);
      const where = sweepQuery(prisma).where;
      expect(where.OR).toBeUndefined();
      expect(where.updatedAt).toEqual({ gte: new Date(now.getTime() - 14 * 86_400_000) });
    });
  });

  describe('the recapture mark is never lost', () => {
    const closed = survey({
      id: 'old',
      title: 'Your views',
      status: 'CLOSED',
      isAnonymous: true,
      isTemplate: false,
      libraryMeta,
      libraryReference: 'SUR-PWS-003',
      locationIds: [],
      opensAt: new Date('2026-06-01T00:00:00.000Z'),
      closesAt: new Date('2026-06-30T00:00:00.000Z'),
      updatedAt: new Date('2026-06-30T00:00:00.000Z'),
      createdAt: new Date('2026-05-30T00:00:00.000Z'),
    });
    const now = new Date('2026-11-20T10:00:00.000Z');

    /** A capture of `closed` against a store holding one capture row (or none). */
    const harness = (row: { surveyUpdatedAt: Date } | null, over: { responseCounts?: number[]; waiting?: number } = {}) => {
      const { service, prisma } = setup([closed]);
      let capture = row ? { surveyId: 'old', outcome: 'CAPTURED', ...row } : null;
      const counts = [...(over.responseCounts ?? [6, 6])];
      const matches = (where: any) =>
        capture &&
        (where.surveyUpdatedAt ? capture.surveyUpdatedAt.getTime() === where.surveyUpdatedAt.getTime() : true) &&
        (where.NOT ? capture.surveyUpdatedAt.getTime() !== where.NOT.surveyUpdatedAt.getTime() : true);
      Object.assign(prisma, {
        survey: { ...prisma.survey, findFirst: jest.fn(async () => closed) },
        cqcSurveyCapture: {
          upsert: jest.fn(async (args: any) => {
            capture = capture ? { ...capture, ...args.update } : { ...args.create };
            return capture;
          }),
          updateMany: jest.fn(async (args: any) => {
            if (!matches(args.where)) return { count: 0 };
            capture = { ...capture!, ...args.data };
            return { count: 1 };
          }),
          create: jest.fn(async (args: any) => {
            capture = { ...args.data };
            return capture;
          }),
        },
        surveyRecipient: { groupBy: jest.fn(async () => [{ status: 'COMPLETED', _count: { _all: 6 } }]) },
        surveyPendingResponse: {
          groupBy: jest.fn(async () => []),
          count: jest.fn(async () => over.waiting ?? 0),
        },
        surveyResponse: { count: jest.fn(async () => (counts.length > 1 ? counts.shift()! : counts[0]!)) },
        surveyAnswer: { findMany: jest.fn(async () => []) },
        cqcEvidence: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'ev-1' })) },
      });
      prisma.surveyQuestion.findMany.mockImplementation(async () => [
        { id: 'q1', questionText: 'Overall?', questionType: 'SINGLE_SELECT', options: ['Very good', 'Good', 'Poor'], sectionTitle: 'How you are treated', sortOrder: 0 },
      ]);
      (service as any).framework.active = jest.fn(async () => framework);
      return { service, prisma, capture: () => capture };
    };

    it('a failed recapture of a survey closed long ago keeps its mark, so it is tried again', async () => {
      const { service, prisma, capture } = harness({ surveyUpdatedAt: CQC_RECAPTURE_MARK });
      prisma.cqcEvidence.create.mockRejectedValue(new Error('database blip'));
      await expect(service.captureSurvey('old', { actorId: null, trigger: 'sweep', now })).rejects.toThrow('database blip');
      expect(capture()).toMatchObject({ surveyUpdatedAt: CQC_RECAPTURE_MARK, outcome: 'FAILED', capturedAt: now });
      expect(prisma.cqcSurveyCapture.upsert).not.toHaveBeenCalled();
    });

    it('a failed first capture records the survey’s updatedAt, as before (no mark)', async () => {
      const unmarked = harness({ surveyUpdatedAt: new Date('2026-06-01T00:00:00.000Z') });
      unmarked.prisma.cqcEvidence.create.mockRejectedValue(new Error('blip'));
      await expect(unmarked.service.captureSurvey('old', { actorId: null, trigger: 'sweep', now })).rejects.toThrow();
      expect(unmarked.capture()).toMatchObject({ surveyUpdatedAt: closed.updatedAt, outcome: 'FAILED' });

      const none = harness(null);
      none.prisma.cqcEvidence.create.mockRejectedValue(new Error('blip'));
      await expect(none.service.captureSurvey('old', { actorId: null, trigger: 'sweep', now })).rejects.toThrow();
      expect(none.capture()).toMatchObject({ surveyId: 'old', surveyUpdatedAt: closed.updatedAt, outcome: 'FAILED' });
    });

    it('a late answer written while the capture was counting marks it to be taken again', async () => {
      // Counted 6; by the time it is recorded a seventh has been written (its flush found no capture to mark).
      const late = harness(null, { responseCounts: [6, 7] });
      await late.service.captureSurvey('old', { actorId: null, trigger: 'close', now });
      expect(late.capture()).toMatchObject({ outcome: 'CAPTURED', surveyUpdatedAt: CQC_RECAPTURE_MARK });

      // Still waiting when recorded (held after the capture's own flush): marked too.
      const waiting = harness(null, { waiting: 1 });
      await waiting.service.captureSurvey('old', { actorId: null, trigger: 'close', now });
      expect(waiting.capture()).toMatchObject({ outcome: 'CAPTURED', surveyUpdatedAt: CQC_RECAPTURE_MARK });

      // Nothing new: recorded as captured, mark cleared.
      const steady = harness({ surveyUpdatedAt: CQC_RECAPTURE_MARK });
      await steady.service.captureSurvey('old', { actorId: null, trigger: 'sweep', now });
      expect(steady.capture()).toMatchObject({ outcome: 'CAPTURED', surveyUpdatedAt: closed.updatedAt });
      // Waiting answers are read before the count (an answer written in between is seen by one or the other).
      const pendingAt = steady.prisma.surveyPendingResponse.count.mock.invocationCallOrder[0];
      const countAt = steady.prisma.surveyResponse.count.mock.invocationCallOrder.at(-1);
      expect(pendingAt).toBeLessThan(countAt);
    });

    it('the sweep retries a failed marked capture hourly, however long ago the survey closed', async () => {
      const failedAt = (capturedAt: Date) => {
        const prisma: any = {
          cqcSurveyCapture: {
            findMany: jest.fn(async (args: any) =>
              args.where.surveyUpdatedAt
                ? [{ surveyId: 'old' }]
                : [{ surveyId: 'old', surveyUpdatedAt: CQC_RECAPTURE_MARK, outcome: 'FAILED', capturedAt }],
            ),
          },
          survey: {
            findMany: jest.fn(async (args: any) =>
              args.select?.clones ? [liveClosed('old')] : [{ id: 'old', updatedAt: closed.updatedAt }],
            ),
          },
        };
        const service = new CqcSurveyEvidenceService(prisma, {} as any, { logAudit: jest.fn() } as any, {} as any);
        jest.spyOn(service, 'captureSurvey').mockResolvedValue({
          surveyId: 'old', outcome: 'CAPTURED', created: 0, updated: 1, skipped: 0, evidenceIds: [], detail: null,
        });
        return service;
      };
      expect(await failedAt(new Date(now.getTime() - 10 * 60_000)).captureRecentlyClosed(now)).toEqual({ checked: 0, captured: 0 });
      expect(await failedAt(new Date(now.getTime() - 2 * 3_600_000)).captureRecentlyClosed(now)).toEqual({ checked: 1, captured: 1 });
    });
  });

  it('a survey of the organisation’s own has no ready-made statements', async () => {
    const own = survey({ id: 's2', createdFromTemplateId: 'own-template' });
    const { service } = setup([own, survey({ id: 'own-template', isTemplate: true })]);
    const plan = await service.statementPlan(own, framework);
    expect(plan).toMatchObject({ source: 'none', statements: [] });
  });
});
