import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import {
  PlatformCostsSyncService,
  manualSyncRetryAfterSeconds,
} from './platform-costs-sync.service';
import { isMonthlyReportHour } from './platform-costs.jobs';

describe('manual sync rate limit', () => {
  const now = new Date('2026-10-01T10:00:00Z');

  it('allows when there is no previous manual run', () => {
    expect(manualSyncRetryAfterSeconds(null, now)).toBe(0);
  });

  it('blocks within 5 minutes and reports the remaining seconds', () => {
    expect(
      manualSyncRetryAfterSeconds(new Date('2026-10-01T09:58:00Z'), now),
    ).toBe(180);
    expect(
      manualSyncRetryAfterSeconds(new Date('2026-10-01T09:59:59.500Z'), now),
    ).toBe(300);
  });

  it('allows again after 5 minutes', () => {
    expect(
      manualSyncRetryAfterSeconds(new Date('2026-10-01T09:55:00Z'), now),
    ).toBe(0);
  });

  function makeService(opts: { enabled: boolean; lastManual: Date | null }) {
    const prisma = {
      azureSyncRun: {
        findFirst: jest.fn(async () =>
          opts.lastManual ? { startedAt: opts.lastManual } : null,
        ),
        create: jest.fn(async () => ({ id: 'run-1' })),
        update: jest.fn(async () => ({})),
      },
    };
    const azure = { enabled: opts.enabled, settings: { scope: '' } };
    const svc = new PlatformCostsSyncService(
      prisma as never,
      azure as never,
      { lastSuccess: jest.fn() } as never,
      { detectAndNotify: jest.fn() } as never,
    );
    // Don't actually run the background pipeline in unit tests.
    jest
      .spyOn(svc, 'runCostsPipeline')
      .mockResolvedValue({ runId: 'run-1', status: 'success' });
    jest.spyOn(svc, 'run').mockResolvedValue({ runId: 'x', status: 'success' });
    return { svc, prisma };
  }

  it('rejects with 429 when a manual run started in the last 5 minutes (persisted check)', async () => {
    const { svc, prisma } = makeService({
      enabled: true,
      lastManual: new Date(Date.now() - 60_000),
    });
    const err = await svc.triggerManualSync('user-1').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(String(err.message)).toMatch(/once every 5 minutes/);
    expect(prisma.azureSyncRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trigger: 'manual' } }),
    );
    expect(prisma.azureSyncRun.create).not.toHaveBeenCalled();
  });

  it('creates a manual costs run and returns it as running', async () => {
    const { svc, prisma } = makeService({
      enabled: true,
      lastManual: new Date(Date.now() - 6 * 60_000),
    });
    await expect(svc.triggerManualSync('user-1')).resolves.toEqual({
      runId: 'run-1',
      status: 'running',
    });
    expect(prisma.azureSyncRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'costs',
          trigger: 'manual',
          triggeredById: 'user-1',
        }),
      }),
    );
  });

  it('refuses while a manual sync is still in flight', async () => {
    const { svc } = makeService({ enabled: true, lastManual: null });
    let release!: () => void;
    (svc.runCostsPipeline as jest.Mock).mockImplementation(
      () =>
        new Promise(
          (r) => (release = () => r({ runId: 'run-1', status: 'success' })),
        ),
    );
    await svc.triggerManualSync('user-1');
    const err = await svc.triggerManualSync('user-1').catch((e) => e);
    expect(err.getStatus()).toBe(429);
    release();
  });

  it('returns 409 when the feature is disabled', async () => {
    const { svc } = makeService({ enabled: false, lastManual: null });
    await expect(svc.triggerManualSync('user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('records failures on the sync run instead of throwing', async () => {
    const prisma = {
      azureSyncRun: {
        create: jest.fn(async () => ({ id: 'run-9' })),
        update: jest.fn(async () => ({})),
      },
    };
    const svc = new PlatformCostsSyncService(
      prisma as never,
      { enabled: false, settings: {} } as never,
      {} as never,
      {} as never,
    );
    const res = await svc.run('prices', 'schedule');
    expect(res).toMatchObject({ runId: 'run-9', status: 'failed' });
    expect(prisma.azureSyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-9' },
        data: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('disabled'),
        }),
      }),
    );
  });
});

describe('monthly report schedule', () => {
  it('fires at 08:00 Europe/London on the 1st (BST and GMT)', () => {
    expect(
      isMonthlyReportHour(new Date('2026-10-01T07:30:00Z'), 'Europe/London'),
    ).toBe(true); // 08:30 BST
    expect(
      isMonthlyReportHour(new Date('2026-12-01T08:10:00Z'), 'Europe/London'),
    ).toBe(true); // 08:10 GMT
    expect(
      isMonthlyReportHour(new Date('2026-10-01T08:30:00Z'), 'Europe/London'),
    ).toBe(false); // 09:30 BST
    expect(
      isMonthlyReportHour(new Date('2026-10-02T07:30:00Z'), 'Europe/London'),
    ).toBe(false);
  });
});
