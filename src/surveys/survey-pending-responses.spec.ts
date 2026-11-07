import { Prisma } from '@prisma/client';
import {
  CQC_RECAPTURE_MARK,
  SUBMIT_CLAIM_STEP_MS,
  claimRecipient,
  claimableWhere,
  submitClaimExpiry,
  PENDING_BATCH_SIZE,
  PENDING_RESERVE,
  PendingFlushFailed,
  errorKind,
  writtenOutDay,
  flushPendingResponses,
  holdUnlinkedResponse,
  pendingFlushDue,
  shuffled,
  toPendingAnswers,
} from './survey-pending-responses';

const day = new Date('2026-11-04T00:00:00.000Z');

/** A pending row as the store holds it; answers carry the submission number so order can be read back. */
const waitingRow = (n: number, surveyId = 's1', over: Record<string, unknown> = {}) => ({
  id: `held-${n}`,
  surveyId,
  isAnonymous: false,
  channel: 'ONLINE',
  createdAt: day,
  payload: {
    locationId: 'loc-leeds',
    respondentRelation: null,
    answers: [
      { questionId: 'q1', booleanValue: null, textValue: `answer ${n}`, numberValue: '4', selectedOptions: ['Good'], otherText: null, comment: null },
    ],
  },
  ...over,
});

/** Prisma mock that records which calls happen inside which transaction. */
function store(rows: any[], surveys: any[] = []) {
  const transactions: string[][] = [];
  let current: string[] | null = null;
  const log = (name: string) => current?.push(name);
  const prisma: any = {
    surveyPendingResponse: {
      groupBy: jest.fn(async (args: any) => {
        const ids = args.where?.surveyId?.in as string[] | undefined;
        const counts = new Map<string, number>();
        for (const r of rows) if (!ids || ids.includes(r.surveyId)) counts.set(r.surveyId, (counts.get(r.surveyId) ?? 0) + 1);
        return [...counts].map(([surveyId, n]) => ({ surveyId, _count: { _all: n } }));
      }),
      findMany: jest.fn(async (args: any) => {
        log('pending.findMany');
        return rows.filter((r) => r.surveyId === args.where.surveyId);
      }),
      deleteMany: jest.fn(async (args: any) => {
        log('pending.deleteMany');
        return { count: args.where.id.in.length };
      }),
      create: jest.fn(async (args: any) => ({ id: 'held-new', ...args.data })),
    },
    survey: {
      findMany: jest.fn(async () => surveys),
    },
    surveyResponse: {
      createMany: jest.fn(async (args: any) => {
        log('response.createMany');
        return { count: args.data.length };
      }),
    },
    surveyAnswer: {
      createMany: jest.fn(async (args: any) => {
        log('answer.createMany');
        return { count: args.data.length };
      }),
    },
    cqcSurveyCapture: {
      updateMany: jest.fn(async () => {
        log('capture.markForRecapture');
        return { count: 0 };
      }),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown, _options?: unknown) => {
      current = [];
      try {
        return await cb(prisma);
      } finally {
        transactions.push(current);
        current = null;
      }
    }),
  };
  /** Every response written, with its answers (as one create would have had them). */
  const written = () => {
    const answers = prisma.surveyAnswer.createMany.mock.calls.flatMap((c: any[]) => c[0].data);
    return prisma.surveyResponse.createMany.mock.calls
      .flatMap((c: any[]) => c[0].data)
      .map((r: any) => ({ ...r, answers: answers.filter((a: any) => a.responseId === r.id) }));
  };
  const writtenOrder = () => written().map((r: any) => r.answers[0].textValue as string);
  return { prisma, transactions, written, writtenOrder };
}

describe('pending unlinked responses', () => {
  describe('holding', () => {
    it('keeps the answers, the branch and the day — nothing about the recipient, person, token or IP', async () => {
      const { prisma } = store([]);
      const answers = toPendingAnswers([
        {
          questionId: 'q1',
          booleanValue: null,
          textValue: null,
          numberValue: new Prisma.Decimal(4),
          selectedOptions: ['Good'],
          otherText: null,
          comment: null,
        },
        { questionId: 'q2', booleanValue: true, textValue: null, numberValue: null, selectedOptions: Prisma.JsonNull, otherText: null, comment: 'Fine' },
      ]);
      await holdUnlinkedResponse(prisma, {
        surveyId: 's1',
        isAnonymous: true,
        channel: 'ONLINE',
        day,
        payload: { locationId: null, respondentRelation: null, answers },
      });
      const data = prisma.surveyPendingResponse.create.mock.calls[0][0].data;
      expect(Object.keys(data).sort()).toEqual(['channel', 'createdAt', 'isAnonymous', 'payload', 'surveyId']);
      expect(Object.keys(data.payload).sort()).toEqual(['answers', 'locationId', 'respondentRelation']);
      expect(JSON.stringify(data)).not.toMatch(/recipient|employee|serviceUser|token|ip|userAgent|submittedBy|recordedBy/i);
      expect(data.createdAt).toBe(day);
      expect(data.payload.answers).toEqual([
        { questionId: 'q1', booleanValue: null, textValue: null, numberValue: '4', selectedOptions: ['Good'], otherText: null, comment: null },
        { questionId: 'q2', booleanValue: true, textValue: null, numberValue: null, selectedOptions: null, otherText: null, comment: 'Fine' },
      ]);
    });
  });

  describe('when they are written', () => {
    const now = new Date('2026-11-05T10:00:00.000Z');
    const open = { status: 'ACTIVE' as const, closesAt: null, deletedAt: null };

    it(`waits for a batch of ${PENDING_BATCH_SIZE} plus ${PENDING_RESERVE} kept back while the survey is open`, () => {
      expect(pendingFlushDue(open, PENDING_BATCH_SIZE, now)).toBe(false);
      expect(pendingFlushDue(open, PENDING_BATCH_SIZE + PENDING_RESERVE - 1, now)).toBe(false);
      expect(pendingFlushDue(open, PENDING_BATCH_SIZE + PENDING_RESERVE, now)).toBe(true);
      expect(pendingFlushDue(open, 0, now, true)).toBe(false);
    });

    it('writes everything once closed, past its end, deleted, or when forced', () => {
      expect(pendingFlushDue({ ...open, status: 'CLOSED' }, 1, now)).toBe(true);
      expect(pendingFlushDue({ ...open, closesAt: new Date('2026-11-05T09:00:00.000Z') }, 1, now)).toBe(true);
      expect(pendingFlushDue({ ...open, closesAt: new Date('2026-11-06T09:00:00.000Z') }, 1, now)).toBe(false);
      expect(pendingFlushDue({ ...open, deletedAt: now }, 1, now)).toBe(true);
      expect(pendingFlushDue(open, 1, now, true)).toBe(true);
    });

    it('the job leaves a small batch on an open survey alone and writes a closed one', async () => {
      const rows = [
        ...[1, 2, 3].map((n) => waitingRow(n, 'open-survey')),
        ...[4, 5].map((n) => waitingRow(n, 'closed-period')),
      ];
      const { prisma, written } = store(rows, [
        { id: 'open-survey', ...open },
        { id: 'closed-period', ...open, status: 'CLOSED' },
      ]);
      const result = await flushPendingResponses(prisma, { now });
      expect(result).toEqual({ surveys: 1, written: 2 });
      expect(written().every((r: any) => r.surveyId === 'closed-period')).toBe(true);
    });

    it('an open survey keeps a random few back, so the batch written at the close is never a small one', async () => {
      const rows = Array.from({ length: PENDING_BATCH_SIZE + PENDING_RESERVE + 2 }, (_, i) => waitingRow(i + 1));
      const { prisma, written } = store(rows, [{ id: 's1', ...open }]);
      const result = await flushPendingResponses(prisma, { now });
      expect(result).toEqual({ surveys: 1, written: rows.length - PENDING_RESERVE });
      // Only the written ones are taken out of the store; the rest stay held.
      const claimed: string[] = prisma.surveyPendingResponse.deleteMany.mock.calls[0][0].where.id.in;
      expect(claimed).toHaveLength(rows.length - PENDING_RESERVE);
      expect(written()).toHaveLength(rows.length - PENDING_RESERVE);
      // Which ones stay is random, not simply the latest.
      const keptSets = new Set<string>();
      for (let i = 0; i < 12; i += 1) {
        const run = store(rows, [{ id: 's1', ...open }]);
        await flushPendingResponses(run.prisma, { now });
        const taken = new Set(run.prisma.surveyPendingResponse.deleteMany.mock.calls[0][0].where.id.in);
        keptSets.add(rows.filter((r) => !taken.has(r.id)).map((r) => r.id).join(','));
      }
      expect(keptSets.size).toBeGreaterThan(1);
    });

    it('a closed survey writes every one, however few', async () => {
      const { prisma } = store([waitingRow(1), waitingRow(2)], [{ id: 's1', ...open, status: 'CLOSED' }]);
      expect(await flushPendingResponses(prisma, { now })).toEqual({ surveys: 1, written: 2 });
    });
  });

  describe('writing', () => {
    it('writes a batch in one transaction that also removes it from the store, as unlinked responses with the day only', async () => {
      const { prisma, transactions, written } = store([1, 2, 3, 4, 5].map((n) => waitingRow(n)), [
        { id: 's1', status: 'CLOSED', closesAt: null, deletedAt: null },
      ]);
      // Written out on the day they were given (later days: see "dates").
      await flushPendingResponses(prisma, { now: new Date('2026-11-04T15:00:00.000Z'), timeZone: 'Europe/London' });
      expect(transactions).toEqual([
        ['pending.findMany', 'pending.deleteMany', 'response.createMany', 'answer.createMany', 'capture.markForRecapture'],
      ]);
      expect(written()).toHaveLength(5);
      // A long enough transaction for a large survey closing (not Prisma's 5-second default).
      expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({ timeout: expect.any(Number) });
      expect(prisma.$transaction.mock.calls[0][1].timeout).toBeGreaterThanOrEqual(60_000);
      const data = written()[0];
      expect(data).toMatchObject({
        surveyId: 's1',
        recipientId: null,
        jobTitleId: null,
        submittedById: null,
        respondentName: null,
        locationId: 'loc-leeds',
        submittedAt: day,
        createdAt: day,
        updatedAt: day,
      });
      expect(data.answers[0]).toMatchObject({ responseId: data.id, createdAt: day, updatedAt: day, selectedOptions: ['Good'] });
      expect(data.answers[0].numberValue).toEqual(new Prisma.Decimal(4));
      // Random ids, all different.
      expect(new Set(written().map((r: any) => r.id)).size).toBe(5);
    });

    it('answers given without a name never get a branch or who answered, even if held with one', async () => {
      const row = waitingRow(1, 's1', { isAnonymous: true });
      (row.payload as any).respondentRelation = 'FAMILY_MEMBER';
      const { prisma, written } = store([row]);
      await flushPendingResponses(prisma, { force: true });
      expect(written()[0]).toMatchObject({
        isAnonymous: true,
        locationId: null,
        respondentRelation: null,
      });
    });

    it('the written order is not the order people answered in', async () => {
      const submitted = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => waitingRow(n));
      const inSubmissionOrder = submitted.map((r) => r.payload.answers[0]!.textValue);

      // A fixed random source shows the shuffle is applied…
      const fixed = store(submitted);
      await flushPendingResponses(fixed.prisma, { force: true, random: () => 0 });
      expect(fixed.writtenOrder()).not.toEqual(inSubmissionOrder);
      expect([...fixed.writtenOrder()].sort()).toEqual([...inSubmissionOrder].sort());

      // …and the real (cryptographic) source gives different orders from run to run.
      const orders = new Set<string>();
      for (let i = 0; i < 12; i += 1) {
        const run = store(submitted);
        await flushPendingResponses(run.prisma, { force: true });
        orders.add(run.writtenOrder().join('|'));
      }
      expect(orders.size).toBeGreaterThan(1);
      expect([...orders].some((o) => o !== inSubmissionOrder.join('|'))).toBe(true);
    });

    it('a batch another run is already writing is left to it (nothing written twice)', async () => {
      const { prisma } = store([1, 2, 3].map((n) => waitingRow(n)));
      prisma.surveyPendingResponse.deleteMany.mockResolvedValue({ count: 0 });
      const result = await flushPendingResponses(prisma, { force: true });
      expect(result).toEqual({ surveys: 0, written: 0 });
    });

    it('a real failure is passed on (the rows stay held for the next run), without quoting the answers', async () => {
      const { prisma } = store([waitingRow(1)]);
      // Errors can quote the data they were given; that must not reach the logs or CQC capture details.
      prisma.surveyResponse.createMany.mockRejectedValue(new Error('Invalid value in {"textValue":"answer 1"}'));
      const err: any = await flushPendingResponses(prisma, { force: true }).catch((e) => e);
      expect(err.message).toMatch(/Waiting answers for survey s1 could not be written/);
      expect(err.message).not.toMatch(/answer 1/);
    });

    it("one survey's failure does not hold back the others' answers", async () => {
      const rows = [waitingRow(1, 'broken'), waitingRow(2, 'fine')];
      const { prisma, written } = store(rows);
      prisma.surveyResponse.createMany.mockImplementation(async (args: any) => {
        if (args.data[0].surveyId === 'broken') throw new Error('Transaction already closed: timeout');
        return { count: args.data.length };
      });
      await expect(flushPendingResponses(prisma, { force: true })).rejects.toThrow(/survey broken could not be written/);
      expect(written().map((r: any) => r.surveyId)).toEqual(['broken', 'fine']);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('nothing to do for an empty list of surveys', async () => {
      const { prisma } = store([waitingRow(1)]);
      expect(await flushPendingResponses(prisma, { surveyIds: [] })).toEqual({ surveys: 0, written: 0 });
      expect(prisma.surveyPendingResponse.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('reserve (final decision: 5)', () => {
    const now = new Date('2026-11-05T10:00:00.000Z');
    const open = { id: 's1', status: 'ACTIVE' as const, closesAt: null, deletedAt: null };
    const rows = (n: number) => Array.from({ length: n }, (_, i) => waitingRow(i + 1));

    it('keeps 5 back, so an open survey writes a batch only once 10 are waiting', async () => {
      expect(PENDING_RESERVE).toBe(5);
      expect(PENDING_BATCH_SIZE).toBe(5);
      expect(pendingFlushDue(open, 9, now)).toBe(false);
      expect(pendingFlushDue(open, 10, now)).toBe(true);

      const nine = store(rows(9), [open]);
      expect(await flushPendingResponses(nine.prisma, { now })).toEqual({ surveys: 0, written: 0 });
      expect(nine.prisma.surveyPendingResponse.deleteMany).not.toHaveBeenCalled();

      const ten = store(rows(10), [open]);
      expect(await flushPendingResponses(ten.prisma, { now })).toEqual({ surveys: 1, written: 5 });
      expect(ten.prisma.surveyPendingResponse.deleteMany.mock.calls[0][0].where.id.in).toHaveLength(5);
    });

    it('writes all of them at the close, however few', async () => {
      const closed = store(rows(3), [{ ...open, status: 'CLOSED' }]);
      expect(await flushPendingResponses(closed.prisma, { now })).toEqual({ surveys: 1, written: 3 });
      const forced = store(rows(7), [open]);
      expect(await flushPendingResponses(forced.prisma, { now, force: true })).toEqual({ surveys: 1, written: 7 });
    });
  });

  describe('dates: the day they are written out, not the day they were given', () => {
    // Given on 4 November; written out on 9 November.
    const given = new Date('2026-11-04T00:00:00.000Z');
    const writtenOn = new Date('2026-11-09T00:00:00.000Z');

    it('the response and its answers take the flush (or close) day', async () => {
      const recorded = waitingRow(2, 's1', { createdAt: given });
      (recorded.payload as any).recorded = {
        contactedAt: given.toISOString(),
        contactNotes: 'Called back',
        consentGiven: true,
      };
      const { prisma, written } = store([waitingRow(1, 's1', { createdAt: given }), recorded]);
      await flushPendingResponses(prisma, {
        force: true,
        now: new Date('2026-11-09T16:45:00.000Z'),
        timeZone: 'Europe/London',
      });
      for (const r of written()) {
        expect(r).toMatchObject({ submittedAt: writtenOn, createdAt: writtenOn, updatedAt: writtenOn });
        for (const a of r.answers) expect(a).toMatchObject({ createdAt: writtenOn, updatedAt: writtenOn });
        expect(JSON.stringify(r)).not.toContain('2026-11-04');
      }
      // A recording's call day would date it too: the written-out day, like the response.
      const withNotes = written().find((r: any) => r.contactNotes === 'Called back');
      expect(withNotes).toMatchObject({ contactedAt: writtenOn, consentGiven: true });
    });

    it('the day is the organisation’s operational day (late evening in summer is the next day in London)', async () => {
      const { prisma, written } = store([waitingRow(1)]);
      await flushPendingResponses(prisma, {
        force: true,
        now: new Date('2026-07-01T23:30:00.000Z'),
        timeZone: 'Europe/London',
      });
      // 00:30 on 2 July in London = 23:00 UTC on 1 July.
      expect(written()[0].submittedAt).toEqual(new Date('2026-07-01T23:00:00.000Z'));
      expect(writtenOutDay(new Date('2026-07-01T23:30:00.000Z'), 'Europe/London')).toEqual(
        new Date('2026-07-01T23:00:00.000Z'),
      );
    });

    it('the written-out day across clock changes and time zones', () => {
      const cases: Array<[string, string, string]> = [
        // London: clocks go forward 29 Mar (01:00 UTC) and back 25 Oct 2026.
        // The day of each change starts in the old offset.
        ['2026-03-29T22:30:00.000Z', 'Europe/London', '2026-03-29T00:00:00.000Z'],
        ['2026-03-29T23:30:00.000Z', 'Europe/London', '2026-03-29T23:00:00.000Z'],
        ['2026-10-25T00:30:00.000Z', 'Europe/London', '2026-10-24T23:00:00.000Z'],
        ['2026-10-25T23:30:00.000Z', 'Europe/London', '2026-10-24T23:00:00.000Z'],
        // New York, the night the clocks go back (1 Nov 2026): still 31 October locally.
        ['2026-11-01T03:30:00.000Z', 'America/New_York', '2026-10-31T04:00:00.000Z'],
        ['2026-11-01T12:00:00.000Z', 'America/New_York', '2026-11-01T04:00:00.000Z'],
        // Ahead of UTC: already the next day.
        ['2026-11-05T20:00:00.000Z', 'Pacific/Auckland', '2026-11-05T11:00:00.000Z'],
        ['2026-11-05T20:00:00.000Z', 'Asia/Kolkata', '2026-11-05T18:30:00.000Z'],
      ];
      for (const [now, tz, start] of cases) {
        expect([now, tz, writtenOutDay(new Date(now), tz).toISOString()]).toEqual([now, tz, start]);
      }
      // No time zone given: the operational default (London).
      expect(writtenOutDay(new Date('2026-07-01T23:30:00.000Z'))).toEqual(new Date('2026-07-01T23:00:00.000Z'));
    });
  });

  describe('late answers for results already kept as CQC evidence', () => {
    it('mark the survey’s capture to be taken again, in the same transaction as the write', async () => {
      const { prisma, transactions } = store([waitingRow(1, 'period-1')], [
        { id: 'period-1', status: 'CLOSED', closesAt: null, deletedAt: null },
      ]);
      await flushPendingResponses(prisma, { now: new Date('2026-11-09T10:00:00.000Z') });
      expect(prisma.cqcSurveyCapture.updateMany).toHaveBeenCalledWith({
        where: { surveyId: 'period-1' },
        data: { surveyUpdatedAt: CQC_RECAPTURE_MARK },
      });
      // One transaction: the answers and the mark are written together (or neither is).
      expect(transactions).toEqual([
        ['pending.findMany', 'pending.deleteMany', 'response.createMany', 'answer.createMany', 'capture.markForRecapture'],
      ]);
      // Older than any survey's updatedAt, so the capture sweep sees it as out of date.
      expect(CQC_RECAPTURE_MARK.getTime()).toBe(0);
    });

    it('nothing is marked when nothing is written', async () => {
      const open = { id: 's1', status: 'ACTIVE', closesAt: null, deletedAt: null };
      const few = store([waitingRow(1), waitingRow(2)], [open]);
      await flushPendingResponses(few.prisma, { now: new Date('2026-11-09T10:00:00.000Z') });
      expect(few.prisma.cqcSurveyCapture.updateMany).not.toHaveBeenCalled();

      const taken = store([waitingRow(1)]);
      taken.prisma.surveyPendingResponse.deleteMany.mockResolvedValue({ count: 0 });
      await flushPendingResponses(taken.prisma, { force: true });
      expect(taken.prisma.cqcSurveyCapture.updateMany).not.toHaveBeenCalled();
    });

    it('a failed mark rolls the batch back (it stays held), and the error does not quote answers', async () => {
      const { prisma } = store([waitingRow(1)]);
      prisma.cqcSurveyCapture.updateMany.mockRejectedValue(new Error('answer 1 could not be saved'));
      const err: any = await flushPendingResponses(prisma, { force: true }).catch((e) => e);
      expect(err).toBeInstanceOf(PendingFlushFailed);
      expect(err.message).not.toMatch(/answer 1/);
    });
  });

  it('errorKind names the failure without its message', () => {
    const known = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on recipient r1', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(errorKind(known)).toBe('P2002');
    expect(errorKind(new TypeError('emp-1 not found'))).toBe('TypeError');
    expect(errorKind('boom')).toBe('unknown error');
  });

  it('shuffled keeps every item', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect([...shuffled(items)].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled([], () => 0)).toEqual([]);
  });
});

describe('the submit claim', () => {
  it('lapses 15-30 minutes later, on a quarter-hour boundary shared by everyone who claimed in that quarter hour', () => {
    const a = new Date('2026-11-04T10:00:01.000Z');
    const b = new Date('2026-11-04T10:14:59.999Z');
    expect(submitClaimExpiry(a)).toEqual(new Date('2026-11-04T10:30:00.000Z'));
    expect(submitClaimExpiry(b)).toEqual(submitClaimExpiry(a));
    for (const now of [a, b, new Date('2026-11-04T10:15:00.000Z')]) {
      const wait = submitClaimExpiry(now).getTime() - now.getTime();
      expect(wait).toBeGreaterThanOrEqual(SUBMIT_CLAIM_STEP_MS);
      expect(wait).toBeLessThanOrEqual(2 * SUBMIT_CLAIM_STEP_MS);
      expect(submitClaimExpiry(now).getTime() % SUBMIT_CLAIM_STEP_MS).toBe(0);
    }
  });

  it('is one conditional update: not Completed, and not claimed (or the claim has lapsed); the day only as updatedAt', async () => {
    const now = new Date('2026-11-04T10:05:00.000Z');
    const db: any = { surveyRecipient: { updateMany: jest.fn(async () => ({ count: 1 })) } };
    const token = await claimRecipient(db, 'r1', { now, updatedAt: day });
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.surveyRecipient.updateMany).toHaveBeenCalledTimes(1);
    expect(db.surveyRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', ...claimableWhere(now) },
      data: { submitClaim: token, submitClaimExpiresAt: new Date('2026-11-04T10:30:00.000Z'), updatedAt: day },
    });
    expect(claimableWhere(now)).toEqual({
      status: { not: 'COMPLETED' },
      OR: [{ submitClaim: null }, { submitClaimExpiresAt: null }, { submitClaimExpiresAt: { lte: now } }],
    });
    db.surveyRecipient.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimRecipient(db, 'r1', { now, updatedAt: day })).toBeNull();
  });
});
