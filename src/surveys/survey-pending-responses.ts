import { randomInt, randomUUID } from 'crypto';
import {
  Prisma,
  SurveyResponseChannel,
  SurveyRespondentRelation,
  SurveyStatus,
  type PrismaClient,
} from '@prisma/client';
import { MIN_ANONYMOUS_GROUP_SIZE } from './survey-breakdown.util';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  dayKeyInTimeZone,
  startOfOperationalDayUtc,
} from '../common/utils/operational-day.util';

/**
 * Answers not linked to anyone — every answer to an anonymous survey given by someone it was sent
 * to, and "Answer without my name" on named surveys — are not written as a SurveyResponse in the
 * submit. The submit first claims the person (see claimRecipient: a second, racing submit is refused
 * there, before anything is held), then puts the answers here (SurveyPendingResponse) in their own
 * transaction, then marks the person's survey Completed in another — so a crash in between can at
 * worst let the person answer twice (once the claim lapses), never lose an answer. The survey job
 * later writes them as responses:
 *  - in batches of at least PENDING_BATCH_SIZE for a survey (or period), in a shuffled order, all in
 *    one transaction — so a response never shares a transaction id (xmin), a place in the table or a
 *    time with the Completed update it came with, and within a batch the order is not the order
 *    people answered in. While it is open, a random PENDING_RESERVE are kept back from each batch,
 *    so the batch written at the close is never a small one;
 *  - or all of them once the survey / period has closed (or passed its end), before its results are
 *    final and before CQC evidence is captured.
 * The pending row holds no recipient, person, token or IP address, and only the day it was given.
 * The response (and its answers) is dated the day it is written out, not the day it was given, so
 * its date cannot be matched to the day someone's survey turned Completed. A survey (or period)
 * whose results are already kept as CQC evidence is marked to be captured again when late answers
 * are written to it.
 * While held, a response is counted ("Responses", "answered without a name") but none of its
 * answers are shown or counted anywhere; the person's own-answers view never has them.
 */

/** A batch is written once a survey (or period) has at least this many waiting. */
export const PENDING_BATCH_SIZE = MIN_ANONYMOUS_GROUP_SIZE;

/**
 * While a survey is open, this many (chosen at random) are always kept back from a batch, so the
 * last batch — written when it closes — is never a small one that could only have come from the
 * few people who answered since the batch before. An open survey's batch is therefore written once
 * PENDING_BATCH_SIZE + PENDING_RESERVE (10) are waiting (and is at least PENDING_BATCH_SIZE); once
 * it has closed, all are written.
 */
export const PENDING_RESERVE = 5;

/**
 * CqcSurveyCapture.surveyUpdatedAt when a capture is out of date because late answers were written
 * after it: older than any survey's updatedAt, so the sweep captures it again (however long ago the
 * survey closed).
 */
export const CQC_RECAPTURE_MARK = new Date(0);

/**
 * One batch is one transaction: generous, so a large survey closing is not rolled back by Prisma's
 * 5-second default (which would leave its answers held, and retried, every minute).
 */
const FLUSH_TRANSACTION = { timeout: 120_000, maxWait: 10_000 };

type Db = Prisma.TransactionClient | PrismaClient;

/** One answer as it is held (JSON-safe: the number as a string). */
export type PendingAnswer = {
  questionId: string;
  booleanValue: boolean | null;
  textValue: string | null;
  numberValue: string | null;
  selectedOptions: string[] | null;
  otherText: string | null;
  comment: string | null;
  /** CareFlow-list questions: the chosen entries' codes. */
  lookupCodes?: string[] | null;
};

/** Everything the response needs, and nothing about who gave it. */
export type PendingResponsePayload = {
  /** Anonymous surveys only: the branch, for closed-survey breakdowns (never a job title). */
  locationId: string | null;
  /** Anonymous service-user surveys: self / family member / representative. Never set without a name. */
  respondentRelation: SurveyRespondentRelation | null;
  /**
   * Staff-recorded (anonymous survey, recorded for a named person): the day of the call / collection,
   * their notes and phone consent. Never the number called or who recorded it.
   */
  recorded?: { contactedAt: string | null; contactNotes: string | null; consentGiven: boolean | null } | null;
  /** Given through a staff / service-user survey's shared link (counted as such, never shown per response). */
  viaSharedLink?: boolean;
  /** Anonymous surveys only: the branch link it came through (it says no more than the branch). */
  shareLinkId?: string | null;
  answers: PendingAnswer[];
};

/** The answer rows as mapAnswersForCreate builds them (Decimal / JsonNull) → JSON-safe. */
export function toPendingAnswers(
  rows: Array<{
    questionId: string;
    booleanValue: boolean | null;
    textValue: string | null;
    numberValue: Prisma.Decimal | null;
    selectedOptions: unknown;
    otherText: string | null;
    comment: string | null;
    lookupCodes?: unknown;
  }>,
): PendingAnswer[] {
  return rows.map((a) => ({
    questionId: a.questionId,
    booleanValue: a.booleanValue ?? null,
    textValue: a.textValue ?? null,
    numberValue: a.numberValue == null ? null : a.numberValue.toString(),
    selectedOptions: Array.isArray(a.selectedOptions)
      ? a.selectedOptions.filter((v): v is string => typeof v === 'string')
      : null,
    otherText: a.otherText ?? null,
    comment: a.comment ?? null,
    // CareFlow-list questions only (other answers keep no such field).
    ...(Array.isArray(a.lookupCodes) && a.lookupCodes.length
      ? { lookupCodes: a.lookupCodes.filter((v): v is string => typeof v === 'string') }
      : {}),
  }));
}

/**
 * Hold an unlinked response. Never call this in the transaction that marks the person's survey
 * Completed — the point is that the two are not written together.
 */
export async function holdUnlinkedResponse(
  db: Db,
  input: {
    surveyId: string;
    /** SurveyResponse.isAnonymous of the response it becomes (true = answered without a name). */
    isAnonymous: boolean;
    channel: SurveyResponseChannel;
    /** The day only (start of the operational day). */
    day: Date;
    payload: PendingResponsePayload;
  },
): Promise<{ id: string }> {
  return db.surveyPendingResponse.create({
    data: {
      surveyId: input.surveyId,
      isAnonymous: input.isAnonymous,
      channel: input.channel,
      createdAt: input.day,
      payload: input.payload as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

/**
 * Claiming the person before their unlinked answer is held. Two submits for the same person can
 * otherwise both be held (and a flush can write the second before it is noticed). The order is:
 *  1. claim — one conditional update: not Completed and not already claimed (or the claim has
 *     lapsed). A second submit that fails it is refused before anything is held;
 *  2. hold the answer, in its own transaction (never with the claim or the Completed mark);
 *  3. mark Completed, only while the claim is still ours, clearing it.
 * The claim is a random token with no time in it, and an expiry rounded UP to a quarter hour and
 * then a quarter hour more (so 15–30 minutes): shared by everyone who claimed in the same quarter
 * hour, and cleared again (with the token) a moment later when the survey is marked Completed — it
 * never dates an answer more closely than its quarter hour, and the held row keeps only the day.
 * A claim left by a crash before the hold lapses then, and the person can answer. One left by a crash
 * after the hold lapses too (nothing ties it to the held answer, so the two cases cannot be told
 * apart without linking the person to their answer): until then a retry is refused; after it, a
 * second answer is accepted — at worst a second answer, never a lost one.
 */
export const SUBMIT_CLAIM_STEP_MS = 15 * 60_000;

/** When a claim taken at `now` lapses: the next quarter-hour boundary after `now`, plus a quarter hour. */
export function submitClaimExpiry(now: Date): Date {
  const step = SUBMIT_CLAIM_STEP_MS;
  return new Date(Math.floor(now.getTime() / step) * step + 2 * step);
}

/** Recipients a submit may claim: not Completed, and not claimed by a submit still in progress. */
export function claimableWhere(now: Date): Prisma.SurveyRecipientWhereInput {
  return {
    status: { not: 'COMPLETED' },
    OR: [{ submitClaim: null }, { submitClaimExpiresAt: null }, { submitClaimExpiresAt: { lte: now } }],
  };
}

/** Clears the claim (with the Completed mark, or when giving it up). */
export const CLEARED_CLAIM = { submitClaim: null, submitClaimExpiresAt: null } as const;

/**
 * Claim one recipient for a submit. Returns the claim token, or null when the person has already
 * answered or another submit holds the claim. `updatedAt` is the day only (the claim must not date
 * the answer either).
 */
export async function claimRecipient(
  db: Db,
  recipientId: string,
  opts: { now: Date; updatedAt: Date },
): Promise<string | null> {
  const token = randomUUID();
  const claimed = await db.surveyRecipient.updateMany({
    where: { id: recipientId, ...claimableWhere(opts.now) },
    data: { submitClaim: token, submitClaimExpiresAt: submitClaimExpiry(opts.now), updatedAt: opts.updatedAt },
  });
  return claimed.count === 1 ? token : null;
}

/** Give a claim back (the answer could not be held): the person can answer again at once. */
export async function releaseClaim(db: Db, recipientId: string, token: string, updatedAt: Date) {
  return db.surveyRecipient.updateMany({
    where: { id: recipientId, submitClaim: token },
    data: { ...CLEARED_CLAIM, updatedAt },
  });
}

/** Mark the claimed recipient Completed, only while the claim is still this submit's. */
export async function completeClaimed(db: Db, recipientId: string, token: string, updatedAt: Date) {
  return db.surveyRecipient.updateMany({
    where: { id: recipientId, submitClaim: token, status: { not: 'COMPLETED' } },
    data: { status: 'COMPLETED', ...CLEARED_CLAIM, updatedAt },
  });
}

/** Waiting responses per survey, grouped like the response tallies (counts only). */
export async function pendingResponseGroups(db: Db, surveyIds: string[]) {
  if (!surveyIds.length) return [];
  return db.surveyPendingResponse.groupBy({
    by: ['surveyId', 'isAnonymous', 'channel'],
    where: { surveyId: { in: surveyIds } },
    _count: { _all: true },
  });
}

/** How many responses are waiting for one survey (or each of several). */
export async function pendingResponseCount(db: Db, surveyIds: string | string[]): Promise<number> {
  const ids = Array.isArray(surveyIds) ? surveyIds : [surveyIds];
  if (!ids.length) return 0;
  return db.surveyPendingResponse.count({ where: { surveyId: { in: ids } } });
}

/**
 * What kind of failure an error is, without its message: a Prisma error's message (and a validation
 * error's) can quote the data it was given — answer text, ids — so only the code / name is logged.
 */
export function errorKind(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code;
  if (e instanceof Error) return e.name;
  return 'unknown error';
}

/** Start of the operational day `now` falls on (the only time an unlinked response keeps). */
export function writtenOutDay(now: Date, timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE): Date {
  return startOfOperationalDayUtc(dayKeyInTimeZone(now, timeZone), timeZone);
}

/** Fisher–Yates with a cryptographic random source (the written order must not be guessable). */
export function shuffled<T>(items: readonly T[], random: (max: number) => number = randomInt): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function readPayload(value: Prisma.JsonValue): PendingResponsePayload {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return {
    locationId: typeof v.locationId === 'string' ? v.locationId : null,
    respondentRelation: (typeof v.respondentRelation === 'string' ? v.respondentRelation : null) as SurveyRespondentRelation | null,
    recorded:
      v.recorded && typeof v.recorded === 'object' && !Array.isArray(v.recorded)
        ? (v.recorded as PendingResponsePayload['recorded'])
        : null,
    viaSharedLink: v.viaSharedLink === true,
    shareLinkId: typeof v.shareLinkId === 'string' ? v.shareLinkId : null,
    answers: Array.isArray(v.answers) ? (v.answers as PendingAnswer[]) : [],
  };
}

/** Answers waiting in the store that came through a shared link (counts only, per survey). */
export async function pendingSharedLinkCount(db: Db, surveyIds: string[]): Promise<number> {
  if (!surveyIds.length) return 0;
  return db.surveyPendingResponse.count({
    where: { surveyId: { in: surveyIds }, payload: { path: ['viaSharedLink'], equals: true } },
  });
}

type FlushSurvey = { status: SurveyStatus; closesAt: Date | null; deletedAt: Date | null };

/** Closed, past its end or deleted (or forced): every waiting response is written, however few. */
function writesAll(survey: FlushSurvey | undefined, now: Date, force: boolean): boolean {
  if (force || !survey) return true;
  if (survey.status === SurveyStatus.CLOSED || survey.deletedAt) return true;
  return Boolean(survey.closesAt && survey.closesAt.getTime() <= now.getTime());
}

/** Whether a survey's waiting responses are written now. */
export function pendingFlushDue(
  survey: FlushSurvey | undefined,
  waiting: number,
  now: Date,
  force = false,
): boolean {
  if (waiting <= 0) return false;
  if (writesAll(survey, now, force)) return true;
  return waiting >= PENDING_BATCH_SIZE + PENDING_RESERVE;
}

export type FlushResult = { surveys: number; written: number };

/**
 * Write waiting responses: for each survey (or period) that is due (see pendingFlushDue), its
 * waiting responses (all once closed; all but a random PENDING_RESERVE while open) in a shuffled
 * order, in one transaction that also deletes them from the store. Each is dated the operational
 * day it is written out (`now` in `timeZone`), not the day it was given. If the survey's results
 * are already kept as CQC evidence, the same transaction marks them to be captured again.
 * `force` writes whatever is waiting for `surveyIds` (closing, CQC capture). A batch another run is
 * writing at the same moment is left to it (nothing is written twice). A failed batch stays held;
 * the others are still written and the first failure is then passed on.
 */
export async function flushPendingResponses(
  prisma: PrismaClient,
  opts: {
    now?: Date;
    surveyIds?: string[];
    force?: boolean;
    random?: (max: number) => number;
    /** The organisation's operational time zone (for the written-out day); Europe/London if not given. */
    timeZone?: string;
  } = {},
): Promise<FlushResult> {
  const now = opts.now ?? new Date();
  // Dated the day they are written out: the day given (kept on the held row) would match the day
  // the person's survey turned Completed.
  const day = writtenOutDay(now, opts.timeZone);
  if (opts.surveyIds && !opts.surveyIds.length) return { surveys: 0, written: 0 };
  const groups = await prisma.surveyPendingResponse.groupBy({
    by: ['surveyId'],
    ...(opts.surveyIds ? { where: { surveyId: { in: opts.surveyIds } } } : {}),
    _count: { _all: true },
  });
  const waiting = groups.filter((g) => g._count._all > 0);
  if (!waiting.length) return { surveys: 0, written: 0 };
  const surveys = await prisma.survey.findMany({
    where: { id: { in: waiting.map((g) => g.surveyId) } },
    select: { id: true, status: true, closesAt: true, deletedAt: true },
  });
  const surveyById = new Map(surveys.map((s) => [s.id, s]));
  const due = waiting.filter((g) => pendingFlushDue(surveyById.get(g.surveyId), g._count._all, now, opts.force));

  const result: FlushResult = { surveys: 0, written: 0 };
  // One survey's failure (e.g. a timeout on a very large batch) must not hold back every other
  // survey's answers: each batch is tried, and the first failure is passed on afterwards.
  let failure: unknown = null;
  for (const g of due) {
    const all = writesAll(surveyById.get(g.surveyId), now, Boolean(opts.force));
    const written = await prisma
      .$transaction(async (tx) => {
        const rows = await tx.surveyPendingResponse.findMany({ where: { surveyId: g.surveyId } });
        const order = shuffled(rows, opts.random);
        // Open survey: a random PENDING_RESERVE stay held for the next batch (or the close).
        const batch = all ? order : order.slice(0, Math.max(0, order.length - PENDING_RESERVE));
        if (!batch.length || (!all && batch.length < PENDING_BATCH_SIZE)) return 0;
        // Claim them first: a second writer racing on the same rows waits here, then finds them gone.
        const claimed = await tx.surveyPendingResponse.deleteMany({ where: { id: { in: batch.map((r) => r.id) } } });
        if (claimed.count !== batch.length) throw new PendingBatchTaken();
        // Written in the shuffled order, two statements for the whole batch (fast enough for a
        // large survey closing); the response ids are random, so they say nothing about the order.
        const responses: Prisma.SurveyResponseCreateManyInput[] = [];
        const answers: Prisma.SurveyAnswerCreateManyInput[] = [];
        for (const row of batch) {
          const payload = readPayload(row.payload);
          const id = randomUUID();
          responses.push({
            id,
            surveyId: row.surveyId,
            recipientId: null,
            locationId: row.isAnonymous ? null : payload.locationId,
            jobTitleId: null,
            submittedById: null,
            respondentRelation: row.isAnonymous ? null : payload.respondentRelation,
            respondentName: null,
            channel: row.channel,
            isAnonymous: row.isAnonymous,
            viaSharedLink: payload.viaSharedLink === true,
            shareLinkId: row.isAnonymous ? null : (payload.shareLinkId ?? null),
            ...(payload.recorded
              ? {
                  // The written-out day too (never shown for these: it would date the call).
                  contactedAt: payload.recorded.contactedAt ? day : null,
                  contactNotes: payload.recorded.contactNotes ?? null,
                  consentGiven: payload.recorded.consentGiven ?? null,
                }
              : {}),
            submittedAt: day,
            createdAt: day,
            updatedAt: day,
          });
          for (const a of payload.answers) {
            answers.push({
              responseId: id,
              questionId: a.questionId,
              booleanValue: a.booleanValue,
              textValue: a.textValue,
              numberValue: a.numberValue == null ? null : new Prisma.Decimal(a.numberValue),
              selectedOptions: a.selectedOptions == null ? Prisma.JsonNull : a.selectedOptions,
              otherText: a.otherText,
              comment: a.comment,
              lookupCodes: Array.isArray(a.lookupCodes) && a.lookupCodes.length ? a.lookupCodes : Prisma.JsonNull,
              createdAt: day,
              updatedAt: day,
            });
          }
        }
        await tx.surveyResponse.createMany({ data: responses });
        if (answers.length) await tx.surveyAnswer.createMany({ data: answers });
        // Late answers for results already kept as CQC evidence: capture them again (the capture
        // updates its evidence in place by sourceKey). A capture running now records over the mark.
        await tx.cqcSurveyCapture.updateMany({
          where: { surveyId: g.surveyId },
          data: { surveyUpdatedAt: CQC_RECAPTURE_MARK },
        });
        return batch.length;
      }, FLUSH_TRANSACTION)
      .catch((e: unknown) => {
        if (e instanceof PendingBatchTaken) return 0;
        failure ??= new PendingFlushFailed(g.surveyId, e);
        return 0;
      });
    if (written > 0) {
      result.surveys += 1;
      result.written += written;
    }
  }
  if (failure) throw failure;
  return result;
}

class PendingBatchTaken extends Error {
  constructor() {
    super('Pending survey responses are being written by another run');
  }
}

/**
 * A batch could not be written. The message names the survey and the kind of failure only: the
 * underlying error can quote the data it was given (a validation error lists the arguments, a
 * Decimal error the value), and this message is logged and kept as a CQC capture's detail.
 */
export class PendingFlushFailed extends Error {
  constructor(
    readonly surveyId: string,
    readonly cause: unknown,
  ) {
    super(
      `Waiting answers for survey ${surveyId} could not be written (${errorKind(cause)}); they stay held and are tried again.`,
    );
  }
}
