import { JobFailedWithSummaryError } from '../jobs/job-run.types';
import { BadRequestException, Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { VisitPlanBulkScheduleService } from './visit-plan-bulk-schedule.service';
import type { JobRunner } from '../jobs/job-runner.service';
import { VisitPlanRollingRotaJob } from './visit-plan-rolling-rota.job';

type Settings = {
  domAutoExtendRotaEnabled: boolean;
  domRotaHorizonDays: number;
  domRotaHorizonMode: string;
  domAutoExtendRotaRunHour: number;
};

function totals(created: number, skipped = 0) {
  return {
    processed: 1,
    succeeded: 1,
    failed: 0,
    skipped: 0,
    visitsCreated: created,
    visitsSkipped: skipped,
    visitsWithPatternWarnings: 0,
    visitsWithRotaConflicts: 0,
    patternWarnings: [],
    rotaConflictWarnings: [],
  };
}

function make(
  settings: Partial<Settings> = {},
  opts: { cronMode?: 'internal' | 'external'; timeZone?: string } = {},
) {
  const full: Settings = {
    domAutoExtendRotaEnabled: true,
    domRotaHorizonDays: 28,
    domRotaHorizonMode: 'FIXED_DAYS',
    domAutoExtendRotaRunHour: 2,
    ...settings,
  };
  const prisma = {
    organisationGeneralSettings: {
      findFirst: jest.fn().mockResolvedValue(full),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'sys' }) },
  };
  const bulkGenerate = jest.fn(
    async (_u: string, dto: { fromDate: string; toDate: string }) => ({
      message: 'ok',
      data: {
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        backfillDays: 0,
        totals: totals(2, 5),
        results: [
          {
            serviceUserId: 's1',
            planId: 'p1',
            serviceUserLabel: 'X',
            status: 'success' as const,
          },
        ],
      },
    }),
  );
  const orgSettings = {
    getOperationalTimezone: jest
      .fn()
      .mockResolvedValue(opts.timeZone ?? 'Europe/London'),
  };
  const runner = {
    cronMode: opts.cronMode ?? 'internal',
    run: jest.fn(
      async (_n: string, _o: unknown, work: () => Promise<unknown>) => work(),
    ),
  };
  const job = new VisitPlanRollingRotaJob(
    prisma as unknown as PrismaService,
    { bulkGenerate } as unknown as VisitPlanBulkScheduleService,
    orgSettings as unknown as OrganisationGeneralSettingsService,
    runner as unknown as JobRunner,
  );
  return { job, bulkGenerate, runner, prisma };
}

describe('VisitPlanRollingRotaJob', () => {
  beforeEach(() =>
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
  );
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('generates the whole FIXED_DAYS window (today..today+horizon) readyOnly', async () => {
    const { job, bulkGenerate } = make({ domRotaHorizonDays: 28 });
    const outcome = await job.runCatchUp(new Date('2026-10-02T02:00:00Z'));
    expect(bulkGenerate).toHaveBeenCalledTimes(1);
    expect(bulkGenerate).toHaveBeenCalledWith(
      'sys',
      { fromDate: '2026-10-02', toDate: '2026-10-30', readyOnly: true },
      undefined,
      // nightly catch-up must never bring back visits the office deleted; it runs as the rolling rota
      // (Settings → Dom Rules can skip plans over the weekly hours only when run by hand)
      { restoreDeletedJobs: false, source: 'rolling' },
    );
    expect(outcome).toMatchObject({
      status: 'success',
      summary: {
        fromDate: '2026-10-02',
        toDate: '2026-10-30',
        chunks: 1,
        visitsCreated: 2,
        visitsSkipped: 5,
        plans: { processed: 1, succeeded: 1, failed: 0, skipped: 0 },
      },
    });
  });

  it('chunks long windows into ≤31-day bulk generations and sums the totals', async () => {
    const { job, bulkGenerate } = make({ domRotaHorizonDays: 90 });
    const outcome = await job.runCatchUp(new Date('2026-10-02T02:00:00Z'));
    expect(
      bulkGenerate.mock.calls.map((c) => [c[1].fromDate, c[1].toDate]),
    ).toEqual([
      ['2026-10-02', '2026-11-01'],
      ['2026-11-02', '2026-12-02'],
      ['2026-12-03', '2026-12-31'],
    ]);
    expect(outcome.summary).toMatchObject({
      chunks: 3,
      visitsCreated: 6,
      visitsSkipped: 15,
      plans: { processed: 1 },
    });
  });

  it('uses CALENDAR_MONTH and the org-local today', async () => {
    const { job, bulkGenerate } = make(
      { domRotaHorizonMode: 'CALENDAR_MONTH', domRotaHorizonDays: 28 },
      { timeZone: 'Asia/Karachi' },
    );
    // 21:30 UTC on 2 Oct = 3 Oct in Karachi
    await job.runCatchUp(new Date('2026-10-02T21:30:00Z'));
    expect(bulkGenerate.mock.calls[0][1]).toMatchObject({
      fromDate: '2026-10-03',
    });
    expect(
      bulkGenerate.mock.calls[bulkGenerate.mock.calls.length - 1][1],
    ).toMatchObject({ toDate: '2026-10-31' });
  });

  it('records "no active visit plans" as skipped', async () => {
    const { job, bulkGenerate } = make();
    bulkGenerate.mockRejectedValueOnce(
      new BadRequestException('No active visit plans match the selected scope'),
    );
    await expect(
      job.runCatchUp(new Date('2026-10-02T02:00:00Z')),
    ).resolves.toMatchObject({
      status: 'skipped',
      summary: { reason: 'No active visit plans' },
    });
  });

  it('skips when auto-extend is off', async () => {
    const { job, bulkGenerate } = make({ domAutoExtendRotaEnabled: false });
    await expect(job.runCatchUp()).resolves.toMatchObject({
      status: 'skipped',
    });
    expect(bulkGenerate).not.toHaveBeenCalled();
  });

  it('propagates unexpected errors (JobRunner records the failure)', async () => {
    const { job, bulkGenerate } = make();
    bulkGenerate.mockRejectedValueOnce(new Error('db gone'));
    await expect(job.runCatchUp()).rejects.toThrow('db gone');
  });

  it('is idempotent at the job level: re-running requests the same window', async () => {
    const { job, bulkGenerate } = make();
    const at = new Date('2026-10-02T02:00:00Z');
    await job.runCatchUp(at);
    await job.runCatchUp(at);
    expect(bulkGenerate.mock.calls[0][1]).toEqual(
      bulkGenerate.mock.calls[1][1],
    );
  });

  describe('internal @Cron tick', () => {
    it('runs once a day at the configured org hour through JobRunner', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-02T01:00:00Z') }); // 02:00 BST
      const { job, runner, bulkGenerate } = make({
        domAutoExtendRotaRunHour: 2,
      });
      await job.handleRollingRotaExtension();
      expect(runner.run).toHaveBeenCalledWith(
        'rolling-rota',
        { source: 'internal' },
        expect.any(Function),
      );
      expect(bulkGenerate).toHaveBeenCalled();
    });

    it('does nothing at other hours', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-02T05:00:00Z') });
      const { job, runner } = make({ domAutoExtendRotaRunHour: 2 });
      await job.handleRollingRotaExtension();
      expect(runner.run).not.toHaveBeenCalled();
    });

    it('does nothing in CRON_MODE=external', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-02T01:00:00Z') });
      const { job, runner, prisma } = make(
        { domAutoExtendRotaRunHour: 2 },
        { cronMode: 'external' },
      );
      await job.handleRollingRotaExtension();
      expect(runner.run).not.toHaveBeenCalled();
      expect(
        prisma.organisationGeneralSettings.findFirst,
      ).not.toHaveBeenCalled();
    });
  });
  it('marks the run FAILED (keeping the summary) when any visit plan failed', async () => {
    const { job, bulkGenerate } = make({ domRotaHorizonDays: 28 });
    bulkGenerate.mockResolvedValueOnce({
      message: 'ok',
      data: {
        fromDate: '2026-10-02',
        toDate: '2026-10-30',
        backfillDays: 0,
        totals: totals(3, 0),
        results: [
          { serviceUserId: 's1', planId: 'p1', serviceUserLabel: 'A', status: 'success' as const },
          {
            serviceUserId: 's2',
            planId: 'p2',
            serviceUserLabel: 'B',
            status: 'failed' as const,
            error: 'boom',
          },
        ],
      },
    } as never);
    const err = await job
      .runCatchUp(new Date('2026-10-02T02:00:00Z'))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailedWithSummaryError);
    expect((err as JobFailedWithSummaryError).message).toMatch(/1 visit plan/);
    expect((err as JobFailedWithSummaryError).summary).toMatchObject({
      visitsCreated: 3,
      plans: { failed: 1 },
    });
  });
});
