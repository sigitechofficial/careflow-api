import { JobFailedWithSummaryError } from './job-run.types';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  JobRunner,
  STALE_RUNNING_MS,
  formatJobRunLogLine,
  isExternalCronMode,
  runCronTick,
} from './job-runner.service';
import type { JobHandlerRegistry } from './job-handler.registry';
import { jobSkipped, jobSuccess } from './job-run.types';

type Row = {
  id: string;
  jobName: string;
  periodKey: string;
  source: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  summary: unknown;
  error: string | null;
  triggeredById: string | null;
  attempt: number;
};

const tick = () => new Promise<void>((r) => setImmediate(r));

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}

function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown> = {},
): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Record<string, unknown>[]).some((c) => matches(row, c)))
        return false;
      continue;
    }
    const v = row[key];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      if (cmp(v, cond) !== 0) return false;
      continue;
    }
    for (const [op, x] of Object.entries(cond as Record<string, unknown>)) {
      if (op === 'not' && cmp(v, x) === 0) return false;
      if (op === 'lt' && !(cmp(v, x) < 0)) return false;
      if (op === 'gte' && !(cmp(v, x) >= 0)) return false;
      if (op === 'in' && !(x as unknown[]).some((y) => cmp(v, y) === 0))
        return false;
    }
  }
  return true;
}

/** In-memory JobRun table with the (jobName, periodKey) unique constraint. */
function fakeStore() {
  const rows: Row[] = [];
  let seq = 0;
  const jobRun = {
    create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
      await tick();
      if (
        rows.some(
          (r) => r.jobName === data.jobName && r.periodKey === data.periodKey,
        )
      ) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: 'test',
          },
        );
      }
      seq += 1;
      const row: Row = {
        id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
        jobName: data.jobName!,
        periodKey: data.periodKey!,
        source: data.source!,
        status: data.status ?? 'running',
        startedAt: data.startedAt ?? new Date(),
        finishedAt: null,
        durationMs: null,
        summary: null,
        error: null,
        triggeredById: data.triggeredById ?? null,
        attempt: 1,
      };
      rows.push(row);
      return { id: row.id };
    }),
    findUnique: jest.fn(
      async ({
        where,
      }: {
        where: {
          id?: string;
          jobName_periodKey?: { jobName: string; periodKey: string };
        };
      }) => {
        if (where.id) return rows.find((r) => r.id === where.id) ?? null;
        const k = where.jobName_periodKey!;
        return (
          rows.find(
            (r) => r.jobName === k.jobName && r.periodKey === k.periodKey,
          ) ?? null
        );
      },
    ),
    findFirst: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        const found = rows
          .filter((r) => matches(r, where))
          .sort((a, b) => cmp(a.startedAt, b.startedAt));
        return found[0] ?? null;
      },
    ),
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, where)),
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Row>;
      }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Row>;
      }) => {
        await tick();
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    ),
    deleteMany: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        const keep = rows.filter((r) => !matches(r, where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      },
    ),
  };
  return { rows, prisma: { jobRun } as unknown as PrismaService, jobRun };
}

function makeRunner(
  opts: {
    cronMode?: string;
    timeZone?: string;
    handlers?: Record<string, () => Promise<unknown>>;
  } = {},
) {
  const store = fakeStore();
  const config = {
    get: (key: string) =>
      key === 'jobs.cronMode' ? (opts.cronMode ?? 'internal') : undefined,
  } as unknown as ConfigService;
  const orgSettings = {
    getOperationalTimezone: jest
      .fn()
      .mockResolvedValue(opts.timeZone ?? 'Europe/London'),
  } as unknown as OrganisationGeneralSettingsService;
  const registry = {
    get: (name: string) => opts.handlers?.[name],
  } as unknown as JobHandlerRegistry;
  const runner = new JobRunner(store.prisma, config, orgSettings, registry);
  return { runner, ...store, orgSettings };
}

describe('JobRunner', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs the work once and records success with the summary', async () => {
    const { runner, rows } = makeRunner();
    const work = jest.fn().mockResolvedValue(jobSuccess({ alerted: 2 }));
    const res = await runner.run(
      'late-visit-alert',
      { source: 'function', periodKey: 'p1' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      outcome: 'ran',
      status: 'success',
      summary: { alerted: 2 },
      periodKey: 'p1',
    });
    expect(rows[0]).toMatchObject({
      status: 'success',
      source: 'function',
      summary: { alerted: 2 },
      error: null,
    });
    expect(rows[0].finishedAt).toBeInstanceOf(Date);
    expect(typeof rows[0].durationMs).toBe('number');
  });

  it('runs exactly once when two triggers race for the same period', async () => {
    const { runner, rows } = makeRunner();
    const work = jest.fn(async () => {
      await tick();
      return jobSuccess({});
    });
    const at = '2026-10-02T10:05Z';
    const [a, b] = await Promise.all([
      runner.run(
        'late-visit-alert',
        { source: 'internal', periodKey: at },
        work,
      ),
      runner.run(
        'late-visit-alert',
        { source: 'function', periodKey: at },
        work,
      ),
    ]);
    expect(work).toHaveBeenCalledTimes(1);
    expect([a.outcome, b.outcome].sort()).toEqual(['already-ran', 'ran']);
    expect(rows).toHaveLength(1);
    const already = a.outcome === 'already-ran' ? a : b;
    expect(already.runId).toBe(rows[0].id);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^job=late-visit-alert status=already-ran source=\S+ runId=\S+ durationMs=0 periodKey=2026-10-02T10:05Z$/,
      ),
    );
  });

  it('derives the scheduled period key when none is given', async () => {
    jest.useFakeTimers({
      now: new Date('2026-10-02T10:07:31Z'),
      doNotFake: ['setImmediate', 'nextTick'],
    });
    try {
      const { runner, rows } = makeRunner();
      await runner.run('late-visit-alert', { source: 'internal' }, async () =>
        jobSuccess(),
      );
      const second = await runner.run(
        'late-visit-alert',
        { source: 'function' },
        async () => jobSuccess(),
      );
      expect(rows[0].periodKey).toBe('2026-10-02T10:05Z');
      expect(second.outcome).toBe('already-ran');
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the organisation-local date for the rolling rota', async () => {
    jest.useFakeTimers({
      now: new Date('2026-10-02T21:30:00Z'),
      doNotFake: ['setImmediate', 'nextTick'],
    });
    try {
      const { runner, rows } = makeRunner({ timeZone: 'Asia/Karachi' });
      await runner.run('rolling-rota', { source: 'container-job' }, async () =>
        jobSuccess(),
      );
      expect(rows[0].periodKey).toBe('2026-10-03');
    } finally {
      jest.useRealTimers();
    }
  });

  it('records skipped outcomes', async () => {
    const { runner, rows } = makeRunner();
    const res = await runner.run(
      'employee-payout-auto',
      { source: 'internal', periodKey: 'h' },
      async () => jobSkipped('Not the payout hour'),
    );
    expect(res).toMatchObject({ outcome: 'ran', status: 'skipped' });
    expect(rows[0]).toMatchObject({
      status: 'skipped',
      summary: { reason: 'Not the payout hour' },
    });
  });

  it('records failures without rethrowing and logs one error line', async () => {
    const { runner, rows } = makeRunner();
    const res = await runner.run(
      'survey-distribution',
      { source: 'internal', periodKey: 'p' },
      async () => {
        throw new Error('boom\nsecond line');
      },
    );
    expect(res).toMatchObject({
      outcome: 'failed',
      status: 'failed',
      error: 'boom\nsecond line',
    });
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error: 'boom\nsecond line',
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(
      /^job=survey-distribution status=failed source=internal runId=\S+ durationMs=\d+ periodKey=p error=boom second line$/,
    );
  });

  it('keeps the summary when the job fails with JobFailedWithSummaryError', async () => {
    const { runner, rows } = makeRunner();
    const res = await runner.run(
      'rolling-rota',
      { source: 'container-job', periodKey: 'd' },
      async () => {
        throw new JobFailedWithSummaryError('1 visit plan(s) failed to generate', {
          visitsCreated: 3,
          plans: { failed: 1 },
        });
      },
    );
    expect(res).toMatchObject({ outcome: 'failed', status: 'failed' });
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error: '1 visit plan(s) failed to generate',
      summary: { visitsCreated: 3, plans: { failed: 1 } },
    });
  });

  it('does not run work when the start row cannot be written (non-unique error)', async () => {
    const { runner, jobRun } = makeRunner();
    jobRun.create.mockRejectedValueOnce(new Error('db down'));
    const work = jest.fn();
    const res = await runner.run(
      'survey-distribution',
      { source: 'internal', periodKey: 'p' },
      work,
    );
    expect(work).not.toHaveBeenCalled();
    expect(res).toMatchObject({ outcome: 'failed', runId: null });
    expect(errorSpy.mock.calls[0][0]).toMatch(
      /status=failed .*runId=- .*error=Could not record job start: db down/,
    );
  });

  it('marks stale running rows failed and logs a stale warning', async () => {
    const { runner, rows } = makeRunner();
    rows.push({
      id: 'stale-1',
      jobName: 'rolling-rota',
      periodKey: '2026-10-01',
      source: 'container-job',
      status: 'running',
      startedAt: new Date(Date.now() - STALE_RUNNING_MS - 60_000),
      finishedAt: null,
      durationMs: null,
      summary: null,
      error: null,
      triggeredById: null,
      attempt: 1,
    });
    const work = jest.fn().mockResolvedValue(jobSuccess());
    await runner.run(
      'rolling-rota',
      { source: 'container-job', periodKey: '2026-10-02' },
      work,
    );
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/^stale/),
    });
    expect(work).toHaveBeenCalledTimes(1); // stale run no longer blocks
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^job=rolling-rota status=stale source=container-job runId=stale-1 durationMs=\d+ periodKey=2026-10-01$/,
      ),
    );
  });

  it('skips (records) a run while another non-stale run of the same job is in progress', async () => {
    const { runner, rows } = makeRunner();
    let release!: () => void;
    const slow = jest.fn(
      () =>
        new Promise<ReturnType<typeof jobSuccess>>((resolve) => {
          release = () => resolve(jobSuccess({ visitsCreated: 3 }));
        }),
    );
    const first = runner.run(
      'rolling-rota',
      { source: 'container-job', periodKey: '2026-10-02' },
      slow,
    );
    while (!release) await tick();
    const fast = jest.fn().mockResolvedValue(jobSuccess());
    const second = await runner.run(
      'rolling-rota',
      { source: 'manual', periodKey: 'manual:x' },
      fast,
    );
    expect(fast).not.toHaveBeenCalled();
    expect(second).toMatchObject({ outcome: 'ran', status: 'skipped' });
    expect(second.summary).toMatchObject({
      reason: 'Previous run still in progress',
      runningPeriodKey: '2026-10-02',
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 'success' });
    expect(rows.map((r) => r.status)).toEqual(['success', 'skipped']);
  });

  it('applies retention: 7 days for minute jobs, 90 days for daily jobs', async () => {
    const { runner, rows } = makeRunner();
    const now = new Date('2026-10-02T12:00:00Z');
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const mk = (
      id: string,
      jobName: string,
      startedAt: Date,
      status = 'success',
    ): Row => ({
      id,
      jobName,
      periodKey: id,
      source: 'internal',
      status,
      startedAt,
      finishedAt: startedAt,
      durationMs: 1,
      summary: null,
      error: null,
      triggeredById: null,
      attempt: 1,
    });
    rows.push(
      mk('m-old', 'late-visit-alert', daysAgo(8)),
      mk('m-new', 'late-visit-alert', daysAgo(6)),
      mk('d-mid', 'rolling-rota', daysAgo(30)),
      mk('d-old', 'rolling-rota', daysAgo(91)),
    );
    const removed = await runner.applyRetention(now);
    expect(removed).toBe(2);
    expect(rows.map((r) => r.id)).toEqual(['m-new', 'd-mid']);
  });

  it('runs retention at most once per hour per process after runs', async () => {
    const { runner, jobRun } = makeRunner();
    await runner.run(
      'survey-distribution',
      { source: 'internal', periodKey: 'a' },
      async () => jobSuccess(),
    );
    await runner.run(
      'survey-distribution',
      { source: 'internal', periodKey: 'b' },
      async () => jobSuccess(),
    );
    expect(jobRun.deleteMany).toHaveBeenCalledTimes(2); // one pass = one deleteMany per retention group
  });

  it('runByName uses the registered handler and fails clearly without one', async () => {
    const handler = jest.fn().mockResolvedValue(jobSuccess({ sent: 1 }));
    const { runner } = makeRunner({
      handlers: { 'care-plan-review-reminders': handler },
    });
    const ok = await runner.runByName('care-plan-review-reminders', {
      source: 'container-job',
      periodKey: 'd',
    });
    expect(ok).toMatchObject({ outcome: 'ran', summary: { sent: 1 } });
    const missing = await runner.runByName('learning-maintenance', {
      source: 'container-job',
      periodKey: 'd',
    });
    expect(missing).toMatchObject({
      outcome: 'failed',
      error: 'No handler registered for job learning-maintenance',
    });
  });

  it('notifies onStarted with the run id before the work runs', async () => {
    const { runner } = makeRunner();
    const seen: string[] = [];
    const res = await runner.run(
      'survey-distribution',
      {
        source: 'manual',
        periodKey: 'manual:1',
        onStarted: (id) => seen.push(id),
      },
      async () => {
        expect(seen).toHaveLength(1);
        return jobSuccess();
      },
    );
    expect(seen).toEqual([res.runId]);
  });
});

describe('JobRunner retries of failed/stale periods', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const fail = async () => {
    throw new Error('first attempt failed');
  };

  it('re-runs a failed period (attempt 2) and reports the real outcome', async () => {
    const { runner, rows } = makeRunner();
    const first = await runner.run(
      'late-visit-alert',
      { source: 'internal', periodKey: 'p' },
      fail,
    );
    expect(first.outcome).toBe('failed');
    const work = jest.fn().mockResolvedValue(jobSuccess({ alerted: 1 }));
    const retry = await runner.run(
      'late-visit-alert',
      { source: 'function', periodKey: 'p' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(retry).toMatchObject({
      outcome: 'ran',
      status: 'success',
      runId: first.runId,
      summary: { alerted: 1 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'success',
      source: 'function',
      attempt: 2,
      error: null,
    });
  });

  it('a failed retry stays failed and can be retried again (attempt 3)', async () => {
    const { runner, rows } = makeRunner();
    await runner.run(
      'rolling-rota',
      { source: 'container-job', periodKey: 'd' },
      fail,
    );
    await expect(
      runner.run(
        'rolling-rota',
        { source: 'container-job', periodKey: 'd' },
        fail,
      ),
    ).resolves.toMatchObject({ outcome: 'failed' });
    await runner.run(
      'rolling-rota',
      { source: 'container-job', periodKey: 'd' },
      async () => jobSuccess(),
    );
    expect(rows[0]).toMatchObject({ status: 'success', attempt: 3 });
  });

  it('only one of two concurrent retries wins the claim', async () => {
    const { runner, rows } = makeRunner();
    await runner.run(
      'late-visit-alert',
      { source: 'internal', periodKey: 'p' },
      fail,
    );
    const work = jest.fn(async () => {
      await tick();
      return jobSuccess();
    });
    const [a, b] = await Promise.all([
      runner.run(
        'late-visit-alert',
        { source: 'internal', periodKey: 'p' },
        work,
      ),
      runner.run(
        'late-visit-alert',
        { source: 'function', periodKey: 'p' },
        work,
      ),
    ]);
    expect(work).toHaveBeenCalledTimes(1);
    expect([a.outcome, b.outcome].sort()).toEqual(['already-ran', 'ran']);
    expect(rows[0]).toMatchObject({ status: 'success', attempt: 2 });
  });

  it('success, skipped and fresh running rows still block with already-ran', async () => {
    const { runner } = makeRunner();
    await runner.run(
      'late-visit-alert',
      { source: 'internal', periodKey: 'ok' },
      async () => jobSuccess(),
    );
    await runner.run(
      'late-visit-alert',
      { source: 'internal', periodKey: 'sk' },
      async () => jobSkipped('off'),
    );
    const work = jest.fn().mockResolvedValue(jobSuccess());
    await expect(
      runner.run(
        'late-visit-alert',
        { source: 'function', periodKey: 'ok' },
        work,
      ),
    ).resolves.toMatchObject({ outcome: 'already-ran', status: 'success' });
    await expect(
      runner.run(
        'late-visit-alert',
        { source: 'function', periodKey: 'sk' },
        work,
      ),
    ).resolves.toMatchObject({ outcome: 'already-ran', status: 'skipped' });

    let release!: () => void;
    const slow = runner.run(
      'rolling-rota',
      { source: 'container-job', periodKey: 'd' },
      () =>
        new Promise((resolve) => {
          release = () => resolve(jobSuccess());
        }),
    );
    while (!release) await tick();
    await expect(
      runner.run('rolling-rota', { source: 'manual', periodKey: 'd' }, work),
    ).resolves.toMatchObject({ outcome: 'already-ran', status: 'running' });
    release();
    await slow;
    expect(work).not.toHaveBeenCalled();
  });

  it('re-runs a stale running period', async () => {
    const { runner, rows } = makeRunner();
    rows.push({
      id: 'stale-2',
      jobName: 'learning-maintenance',
      periodKey: '2026-10-02',
      source: 'container-job',
      status: 'running',
      startedAt: new Date(Date.now() - STALE_RUNNING_MS - 1_000),
      finishedAt: null,
      durationMs: null,
      summary: null,
      error: null,
      triggeredById: null,
      attempt: 1,
    });
    const work = jest.fn().mockResolvedValue(jobSuccess());
    const res = await runner.run(
      'learning-maintenance',
      { source: 'container-job', periodKey: '2026-10-02' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ outcome: 'ran', runId: 'stale-2' });
    expect(rows[0]).toMatchObject({ status: 'success', attempt: 2 });
  });
});

describe('cut-over: internal @Cron tick and external trigger share the period key', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const cases: Array<[string, string, number]> = [
    ['survey-distribution', '2026-10-02T10:07:00.000Z', 3_000],
    ['visit-start-reminder', '2026-10-02T10:08:00.000Z', 8_000],
    ['late-visit-alert', '2026-10-02T10:05:00.000Z', 20_000],
    ['ecm-missed-visit', '2026-10-02T10:05:00.000Z', 20_000],
    ['ecm-missing-checkout', '2026-10-02T10:15:00.000Z', 45_000],
    ['platform-costs-sync', '2026-10-02T10:05:00.000Z', 30_000],
    ['employee-payout-auto', '2026-10-02T10:00:00.000Z', 30_000],
    ['visit-plan-scheduled-end', '2026-10-02T00:30:00.000Z', 60_000],
    ['learning-maintenance', '2026-10-02T02:30:00.000Z', 60_000],
    ['care-plan-review-reminders', '2026-10-02T06:00:00.000Z', 60_000],
    ['rolling-rota', '2026-10-02T02:00:00.000Z', 60_000],
  ];

  it.each(cases)(
    '%s: internal tick at %s and an external call %d ms later run once',
    async (name, tickAt, delayMs) => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const tickTime = new Date(tickAt);
      for (const skewMs of [0, -2_000]) {
        // internal tick fires a few ms after the scheduled time
        jest.useFakeTimers({
          now: new Date(tickTime.getTime() + 15),
          doNotFake: ['setImmediate', 'nextTick'],
        });
        const { runner, rows } = makeRunner({ timeZone: 'Europe/London' });
        const work = jest.fn().mockResolvedValue(jobSuccess());
        const internal = await runner.run(
          name as never,
          { source: 'internal' },
          work,
        );
        // the external trigger arrives late (cold start) or slightly early (clock skew)
        jest.setSystemTime(
          new Date(tickTime.getTime() + (skewMs < 0 ? skewMs : delayMs)),
        );
        const external = await runner.run(
          name as never,
          { source: name === 'rolling-rota' ? 'container-job' : 'function' },
          work,
        );
        expect(internal.outcome).toBe('ran');
        expect(external.outcome).toBe('already-ran');
        expect(external.periodKey).toBe(internal.periodKey);
        expect(work).toHaveBeenCalledTimes(1);
        expect(rows).toHaveLength(1);
        jest.useRealTimers();
      }
    },
  );
});

describe('formatJobRunLogLine', () => {
  it('matches the alerting format', () => {
    expect(
      formatJobRunLogLine({
        name: 'rolling-rota',
        status: 'success',
        source: 'container-job',
        runId: 'r1',
        durationMs: 12.4,
        periodKey: '2026-10-02',
      }),
    ).toBe(
      'job=rolling-rota status=success source=container-job runId=r1 durationMs=12 periodKey=2026-10-02',
    );
    expect(
      formatJobRunLogLine({
        name: 'x',
        status: 'failed',
        source: 'function',
        runId: null,
        durationMs: 0,
        periodKey: 'p',
        error: `a\r\nb${'z'.repeat(300)}`,
      }),
    ).toMatch(
      /^job=x status=failed source=function runId=- durationMs=0 periodKey=p error=a bz{197}$/,
    );
  });
});

describe('CRON_MODE gating (runCronTick)', () => {
  const original = process.env.CRON_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_MODE;
    else process.env.CRON_MODE = original;
    jest.restoreAllMocks();
  });

  it('does nothing in external mode', async () => {
    const { runner } = makeRunner({ cronMode: 'external' });
    const spy = jest.spyOn(runner, 'run');
    const work = jest.fn();
    await runCronTick(runner, 'late-visit-alert', work);
    expect(spy).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(isExternalCronMode(runner)).toBe(true);
  });

  it('runs through JobRunner with source internal in internal mode', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { runner, rows } = makeRunner({ cronMode: 'internal' });
    const work = jest.fn().mockResolvedValue(jobSuccess());
    await runCronTick(runner, 'late-visit-alert', work);
    expect(work).toHaveBeenCalledTimes(1);
    expect(rows[0].source).toBe('internal');
  });

  it('falls back to process.env without a runner (isolated unit tests)', async () => {
    const work = jest.fn().mockResolvedValue(jobSuccess());
    process.env.CRON_MODE = 'external';
    await runCronTick(undefined, 'late-visit-alert', work);
    expect(work).not.toHaveBeenCalled();
    delete process.env.CRON_MODE;
    await runCronTick(undefined, 'late-visit-alert', work);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
