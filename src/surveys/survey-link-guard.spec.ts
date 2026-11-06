import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALREADY_SENT,
  FORM_EXPIRED,
  FORM_INVALID,
  LINK_BUSY,
  LINK_LIMIT,
  LINK_WINDOW_MS,
  MAX_RAISED_LINK_LIMIT,
  SurveyLinkGuard,
  TOO_QUICK,
  linkLimitFor,
} from './survey-link-guard';

const config = (secret = 'test-secret') => ({ get: () => secret }) as any;

/** The two tables as the database keeps them (shared by every "server" built on the same store). */
function store() {
  const tokens = new Map<string, Date>();
  const rates = new Map<string, { linkHash: string; minute: Date; answers: number }>();
  const db: any = {
    tokens,
    rates,
    surveyLinkFormToken: {
      create: jest.fn(async ({ data }: any) => {
        if (tokens.has(data.nonce)) throw new Prisma.PrismaClientKnownRequestError('taken', { code: 'P2002', clientVersion: 'test' });
        tokens.set(data.nonce, data.expiresAt);
        return data;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        for (const [n, exp] of tokens) if (where.nonce === n || (where.expiresAt && exp < where.expiresAt.lt)) tokens.delete(n);
        return { count: 0 };
      }),
    },
    surveyLinkRate: {
      aggregate: jest.fn(async ({ where }: any) => ({
        _sum: {
          answers: [...rates.values()]
            .filter((r) => r.linkHash === where.linkHash && r.minute >= where.minute.gte)
            .reduce((n, r) => n + r.answers, 0),
        },
      })),
      upsert: jest.fn(async ({ where, create }: any) => {
        const k = `${where.linkHash_minute.linkHash}|${where.linkHash_minute.minute.toISOString()}`;
        const row = rates.get(k);
        if (row) row.answers += 1;
        else rates.set(k, { ...create });
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return db;
}

describe('SurveyLinkGuard (spam protection on shared links, kept in the database)', () => {
  const t0 = Date.UTC(2026, 10, 6, 10, 0, 0);
  const at = (ms: number) => ({ now: ms });

  it('accepts a form sent through the same link a few seconds after it was opened, once', async () => {
    const g = new SurveyLinkGuard(store(), config());
    const formToken = g.issue('link-a', t0);
    expect(await g.check('link-a', { formToken }, at(t0 + 5_000))).toBe('accept');
    await expect(g.check('link-a', { formToken }, at(t0 + 6_000))).rejects.toThrow(ALREADY_SENT);
  });

  it('several API servers share the used tokens and the per-link count', async () => {
    const db = store();
    const a = new SurveyLinkGuard(db, config());
    const b = new SurveyLinkGuard(db, config());
    const formToken = a.issue('link-a', t0);
    expect(await a.check('link-a', { formToken }, at(t0 + 5_000))).toBe('accept');
    // The same form sent to the other server is refused.
    await expect(b.check('link-a', { formToken }, at(t0 + 5_500))).rejects.toThrow(ALREADY_SENT);
    // The limit counts answers through both.
    for (let i = 1; i < LINK_LIMIT; i += 1) await (i % 2 ? b : a).check('link-a', { formToken: a.issue('link-a', t0) }, at(t0 + 6_000 + i));
    await expect(b.check('link-a', { formToken: b.issue('link-a', t0) }, at(t0 + 7_000))).rejects.toThrow(LINK_BUSY);
  });

  it('refuses answers sent too quickly, an old form, another link’s form or a made-up token', async () => {
    const g = new SurveyLinkGuard(store(), config());
    const formToken = g.issue('link-a', t0);
    await expect(g.check('link-a', { formToken }, at(t0 + 500))).rejects.toThrow(TOO_QUICK);
    await expect(g.check('link-a', { formToken }, at(t0 + 25 * 60 * 60_000))).rejects.toThrow(FORM_EXPIRED);
    await expect(g.check('link-b', { formToken }, at(t0 + 5_000))).rejects.toThrow(FORM_INVALID);
    await expect(g.check('link-a', { formToken: 'v1.abc.def.ghi' }, at(t0 + 5_000))).rejects.toThrow(FORM_INVALID);
    await expect(g.check('link-a', {}, at(t0 + 5_000))).rejects.toThrow(FORM_INVALID);
    // Signed with another server's secret.
    const other = new SurveyLinkGuard(store(), config('another-secret')).issue('link-a', t0);
    await expect(g.check('link-a', { formToken: other }, at(t0 + 5_000))).rejects.toThrow(FORM_INVALID);
  });

  it('a form survives a restart (the key comes from the app secret)', async () => {
    const db = store();
    const formToken = new SurveyLinkGuard(db, config()).issue('link-a', t0);
    expect(await new SurveyLinkGuard(db, config()).check('link-a', { formToken }, at(t0 + 5_000))).toBe('accept');
  });

  it('the hidden field filled: thrown away quietly, touching nothing', async () => {
    const db = store();
    const g = new SurveyLinkGuard(db, config());
    expect(await g.check('link-a', { website: 'https://spam.example', formToken: 'anything' }, at(t0))).toBe('discard');
    expect(db.surveyLinkFormToken.create).not.toHaveBeenCalled();
  });

  it('a form refused for its answers, or because the link was busy, can be sent again', async () => {
    const g = new SurveyLinkGuard(store(), config());
    const formToken = g.issue('link-a', t0);
    await g.check('link-a', { formToken }, at(t0 + 5_000));
    await g.release(formToken);
    expect(await g.check('link-a', { formToken }, at(t0 + 9_000))).toBe('accept');

    const busy = new SurveyLinkGuard(store(), config());
    for (let i = 0; i < LINK_LIMIT; i += 1) await busy.check('busy', { formToken: busy.issue('busy', t0) }, at(t0 + 5_000 + i));
    const waiting = busy.issue('busy', t0);
    await expect(busy.check('busy', { formToken: waiting }, at(t0 + 6_000))).rejects.toThrow(LINK_BUSY);
    expect(await busy.check('busy', { formToken: waiting }, at(t0 + 5_000 + LINK_WINDOW_MS + 60_000))).toBe('accept');
  });

  it('limits answers through one link (other links are not affected), and lets them through again later', async () => {
    const g = new SurveyLinkGuard(store(), config());
    for (let i = 0; i < LINK_LIMIT; i += 1) await g.check('busy', { formToken: g.issue('busy', t0) }, at(t0 + 5_000 + i));
    const refused = await g.check('busy', { formToken: g.issue('busy', t0) }, at(t0 + 6_000 + LINK_LIMIT)).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(429);
    expect((refused as HttpException).message).toBe(LINK_BUSY);
    expect(await g.check('quiet', { formToken: g.issue('quiet', t0) }, at(t0 + 6_000))).toBe('accept');
    const later = t0 + 5_000 + LINK_WINDOW_MS + 60_000;
    expect(await g.check('busy', { formToken: g.issue('busy', later - 5_000) }, at(later))).toBe('accept');
  });

  it('a raised limit for a planned sitting lets more through, only until it ends, and never past the cap', async () => {
    const g = new SurveyLinkGuard(store(), config());
    const sitting = linkLimitFor({ sharedLinkLimit: 300, sharedLinkLimitUntil: new Date(t0 + 60 * 60_000) }, t0);
    expect(sitting).toBe(300);
    for (let i = 0; i < 100; i += 1) await g.check('meeting', { formToken: g.issue('meeting', t0) }, { now: t0 + 5_000 + i, limit: sitting });
    expect(linkLimitFor({ sharedLinkLimit: 300, sharedLinkLimitUntil: new Date(t0 - 1) }, t0)).toBe(LINK_LIMIT);
    expect(linkLimitFor({ sharedLinkLimit: 99_999, sharedLinkLimitUntil: new Date(t0 + 1_000) }, t0)).toBe(MAX_RAISED_LINK_LIMIT);
    expect(linkLimitFor(null, t0)).toBe(LINK_LIMIT);
  });

  it('never lets junk posts (forged tokens, the hidden field) use up a link’s allowance', async () => {
    const g = new SurveyLinkGuard(store(), config());
    for (let i = 0; i < LINK_LIMIT * 2; i += 1) {
      await expect(g.check('target', { formToken: 'v1.x.y.forged' }, at(t0 + 5_000 + i))).rejects.toThrow();
      expect(await g.check('target', { formToken: null, website: 'spam' }, at(t0 + 5_000 + i))).toBe('discard');
    }
    expect(await g.check('target', { formToken: g.issue('target', t0) }, at(t0 + 6_000))).toBe('accept');
  });

  it('keeps nothing about the sender: a token’s random part and expiry; a hash of the link, the minute and a count', async () => {
    const db = store();
    const g = new SurveyLinkGuard(db, config());
    const formToken = g.issue('link-a', t0);
    await g.check('link-a', { formToken }, at(t0 + 5_000));
    expect([...db.tokens.keys()]).toEqual([formToken.split('.')[2]]);
    const [rate] = [...db.rates.values()];
    expect(Object.keys(rate).sort()).toEqual(['answers', 'linkHash', 'minute']);
    expect(rate.linkHash).not.toContain('link-a');
    expect(rate.minute.getTime() % 60_000).toBe(0);
  });

  it('keeps a used token’s expiry to the day, never the second the form was opened', async () => {
    const db = store();
    const g = new SurveyLinkGuard(db, config());
    const opened = t0 + 13 * 60_000 + 27_000;
    await g.check('link-a', { formToken: g.issue('link-a', opened) }, at(opened + 5_000));
    const [expiresAt] = [...db.tokens.values()];
    expect(expiresAt.getTime() % (24 * 60 * 60_000)).toBe(0);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(opened + 24 * 60 * 60_000);
  });

  it('a full link is refused before queueing for its lock; no free connection in time is "busy", not a server error', async () => {
    const db = store();
    const g = new SurveyLinkGuard(db, config());
    for (let i = 0; i < LINK_LIMIT; i += 1) await g.check('busy', { formToken: g.issue('busy', t0) }, at(t0 + 5_000 + i));
    db.$transaction.mockClear();
    const late = g.issue('busy', t0);
    await expect(g.check('busy', { formToken: late }, at(t0 + 6_000))).rejects.toThrow(LINK_BUSY);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.tokens.has(late.split('.')[2])).toBe(false);

    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unable to start a transaction in the given time.', { code: 'P2028', clientVersion: 'test' }));
    const queued = g.issue('quiet', t0);
    const refused = await g.check('quiet', { formToken: queued }, at(t0 + 6_000)).catch((e: unknown) => e);
    expect((refused as HttpException).getStatus()).toBe(429);
    // Released: the same form can be sent again.
    expect(await g.check('quiet', { formToken: queued }, at(t0 + 7_000))).toBe('accept');
  });

  it('the sweep clears old counts and expired tokens even when nobody is answering', async () => {
    const db = store();
    const g = new SurveyLinkGuard(db, config());
    g.sweep();
    g.sweep();
    expect(db.surveyLinkRate.deleteMany).toHaveBeenCalledTimes(2);
    expect(db.surveyLinkFormToken.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('clears expired tokens and old counts now and then', async () => {
    const db = store();
    const g = new SurveyLinkGuard(db, config());
    await g.check('link-a', { formToken: g.issue('link-a', t0) }, at(t0 + 5_000));
    expect(db.surveyLinkFormToken.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: new Date(t0 + 5_000) } } });
    expect(db.surveyLinkRate.deleteMany).toHaveBeenCalledTimes(1);
    await g.check('link-a', { formToken: g.issue('link-a', t0) }, at(t0 + 6_000));
    expect(db.surveyLinkRate.deleteMany).toHaveBeenCalledTimes(1);
  });
});
