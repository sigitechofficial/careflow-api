import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Spam protection for shared survey links (public surveys, and staff / service-user surveys with the
 * shared link on), storing nothing about the person sending:
 *  - a hidden "leave this empty" field (honeypot): a form that fills it is accepted and thrown away;
 *  - a signed form token given with the form: answers sent sooner than MIN_FILL_MS after the form was
 *    opened, with a token for another link, an old or a reused token are refused;
 *  - a limit on answers through each link: LINK_LIMIT in LINK_WINDOW_MS, or the survey's raised limit
 *    for a planned sitting (Survey.sharedLinkLimit until sharedLinkLimitUntil).
 * The used tokens and the per-link counts are kept in the database (SurveyLinkFormToken,
 * SurveyLinkRate), so every API server shares them: a used token's random part and expiry; a hash of
 * the link, the minute and a count. Never an IP address, device or anything about who answered.
 * A used token's expiry is kept to the day only (not the second the form was opened), and old counts
 * are cleared every few minutes (sweep, on every server) as well as during checks, so a count never
 * outlives its window by much and cannot be matched to an anonymous answer's time later.
 * People's own links are not covered: each can be answered only once anyway.
 */
export const MIN_FILL_MS = 2_000;
export const FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60_000;
export const LINK_LIMIT = 60;
export const LINK_WINDOW_MS = 10 * 60_000;
/** A raised limit for a planned sitting: at most this many answers per window, for at most this long. */
export const MAX_RAISED_LINK_LIMIT = 1_000;
export const MAX_RAISED_LINK_DAYS = 7;
const MINUTE_MS = 60_000;
const CLEANUP_EVERY_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type LinkGuardVerdict = 'accept' | 'discard';

export const TOO_QUICK = 'Please take a moment to check your answers, then press Submit again.';
export const FORM_EXPIRED = 'This page has been open for a long time. Please reload it and answer again.';
export const FORM_INVALID = 'This form could not be checked. Please reload the page and answer again.';
export const ALREADY_SENT = 'These answers have already been sent. Thank you.';
export const LINK_BUSY = 'A lot of answers are arriving through this link just now. Please try again in a few minutes.';

/** The per-link limit in force: a raised one while its sitting lasts, else the standard one. */
export function linkLimitFor(survey: { sharedLinkLimit: number | null; sharedLinkLimitUntil: Date | null } | null, now: number = Date.now()): number {
  if (survey?.sharedLinkLimit && survey.sharedLinkLimitUntil && survey.sharedLinkLimitUntil.getTime() > now) {
    return Math.min(Math.max(survey.sharedLinkLimit, LINK_LIMIT), MAX_RAISED_LINK_LIMIT);
  }
  return LINK_LIMIT;
}

@Injectable()
export class SurveyLinkGuard {
  private readonly logger = new Logger(SurveyLinkGuard.name);
  private readonly key: Buffer;
  private lastCleanup = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() config?: ConfigService,
  ) {
    const secret = config?.get<string>('JWT_ACCESS_TOKEN_SECRET');
    // A key of its own, derived from the app's secret (so forms keep working after a restart and on
    // every server); a random one when no secret is set (development).
    this.key = secret
      ? createHash('sha256').update(`careflow-survey-form-token:${secret}`).digest()
      : randomBytes(32);
  }

  /** The token given with a shared link's form. */
  issue(linkToken: string, now: number = Date.now()): string {
    const issued = Math.floor(now / 1000).toString(36);
    const nonce = randomBytes(9).toString('base64url');
    return `v1.${issued}.${nonce}.${this.sign(linkToken, issued, nonce)}`;
  }

  /**
   * Check answers sent through a shared link. 'discard' = the hidden field was filled: say thank you
   * and keep nothing. Throws when the answers are refused. `limit`: the per-link limit in force
   * (linkLimitFor).
   */
  async check(
    linkToken: string,
    input: { formToken?: string | null; website?: string | null },
    opts: { limit?: number; now?: number } = {},
  ): Promise<LinkGuardVerdict> {
    const now = opts.now ?? Date.now();
    // The hidden field first, and the link's limit only once the form token is proven genuine and
    // unused: junk posts (bots, forged, missing or replayed tokens) must never use up a link's
    // allowance and lock real people out of a survey.
    if (typeof input.website === 'string' && input.website.trim() !== '') return 'discard';
    const parts = (input.formToken ?? '').split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new BadRequestException(FORM_INVALID);
    const [, issued, nonce, sig] = parts;
    const expected = this.sign(linkToken, issued, nonce);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BadRequestException(FORM_INVALID);
    const issuedAt = parseInt(issued, 36) * 1000;
    if (!Number.isFinite(issuedAt)) throw new BadRequestException(FORM_INVALID);
    // Given in whole seconds (rounded down), so someone who took MIN_FILL_MS or longer always passes.
    if (now - issuedAt < MIN_FILL_MS) throw new BadRequestException(TOO_QUICK);
    if (now - issuedAt > FORM_TOKEN_MAX_AGE_MS) throw new BadRequestException(FORM_EXPIRED);
    this.cleanup(now);
    // Claim the token (atomic on every server): a second use finds it taken.
    try {
      // Rounded up to the next whole day (UTC): still kept for as long as the form works, but the
      // second the form was opened is not kept.
      const expiresAt = new Date(Math.ceil((issuedAt + FORM_TOKEN_MAX_AGE_MS) / DAY_MS) * DAY_MS);
      await this.prisma.surveyLinkFormToken.create({ data: { nonce, expiresAt } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException(ALREADY_SENT);
      throw e;
    }
    try {
      await this.count(linkToken, opts.limit ?? LINK_LIMIT, now);
    } catch (e) {
      // Too busy: the same form may be sent again in a few minutes.
      await this.release(input.formToken);
      throw e;
    }
    return 'accept';
  }

  /** The submit failed after the check (e.g. a missing answer): the same form may be sent again. */
  async release(formToken: string | null | undefined): Promise<void> {
    const nonce = (formToken ?? '').split('.')[2];
    if (nonce) await this.prisma.surveyLinkFormToken.deleteMany({ where: { nonce } });
  }

  private sign(linkToken: string, issued: string, nonce: string): string {
    return createHmac('sha256', this.key).update(`${linkToken}.${issued}.${nonce}`).digest('base64url');
  }

  /** The link's hash (the link itself is not kept a second time). */
  private linkHash(linkToken: string): string {
    return createHmac('sha256', this.key).update(`link:${linkToken}`).digest('base64url');
  }

  /**
   * Count one answer through the link, or refuse when the window is full. One transaction holding a
   * lock for the link, so servers answering at the same moment never let more through than the limit.
   */
  private async count(linkToken: string, limit: number, now: number) {
    const linkHash = this.linkHash(linkToken);
    const minute = new Date(Math.floor(now / MINUTE_MS) * MINUTE_MS);
    const since = new Date(minute.getTime() - LINK_WINDOW_MS + MINUTE_MS);
    const busy = () => new HttpException(LINK_BUSY, HttpStatus.TOO_MANY_REQUESTS);
    // A link already full is refused without queueing for its lock, so a flood of posts with
    // genuine tokens cannot hold the database connections other requests need.
    const seen = await this.prisma.surveyLinkRate.aggregate({ where: { linkHash, minute: { gte: since } }, _sum: { answers: true } });
    if ((seen._sum.answers ?? 0) >= limit) throw busy();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${linkHash}))`;
        const recent = await tx.surveyLinkRate.aggregate({ where: { linkHash, minute: { gte: since } }, _sum: { answers: true } });
        if ((recent._sum.answers ?? 0) >= limit) throw busy();
        await tx.surveyLinkRate.upsert({
          where: { linkHash_minute: { linkHash, minute } },
          create: { linkHash, minute, answers: 1 },
          update: { answers: { increment: 1 } },
        });
        // A planned sitting's burst queues here briefly; past this it is "busy, try again".
      }, { maxWait: 5_000, timeout: 10_000 });
    } catch (e) {
      // No connection free in time (a burst through one link): "busy, try again", not a server error.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028') throw busy();
      throw e;
    }
  }

  /** Every few minutes on each server, also when nobody is answering. */
  @Cron('*/5 * * * *', { name: 'survey-link-guard-sweep' })
  sweep(): void {
    // Housekeeping that is safe on every server at once (deletes of expired rows), so it runs whatever
    // CRON_MODE is: counts must not stay behind after their window.
    this.lastCleanup = 0;
    this.cleanup(Date.now());
  }

  /** Clear expired tokens and old counts (in the background, at most every CLEANUP_EVERY_MS per server). */
  private cleanup(now: number) {
    if (now - this.lastCleanup < CLEANUP_EVERY_MS) return;
    this.lastCleanup = now;
    void Promise.all([
      this.prisma.surveyLinkFormToken.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
      this.prisma.surveyLinkRate.deleteMany({ where: { minute: { lt: new Date(now - LINK_WINDOW_MS - MINUTE_MS) } } }),
    ]).catch((e: unknown) => this.logger.warn(`Clearing old shared-link records failed: ${(e as Error).message}`));
  }
}
