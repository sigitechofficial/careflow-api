import 'reflect-metadata';
import {
  ExecutionContext,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { SystemJobsController } from './system-jobs.controller';
import { SystemJobsService } from './system-jobs.service';
import type { JobRunner } from './job-runner.service';
import { JOB_NAMES } from './job-catalogue';

function user(permissions: string[], roles: string[] = ['Admin']): RequestUser {
  return { id: 'u1', email: 'u@test', roles, permissions, accountKind: 'user' };
}

function canActivate(handlerName: string, u: RequestUser): boolean {
  const guard = new PermissionsGuard(new Reflector());
  const handler = (
    SystemJobsController.prototype as unknown as Record<string, () => void>
  )[handlerName];
  const ctx = {
    getHandler: () => handler,
    getClass: () => SystemJobsController,
    switchToHttp: () => ({ getRequest: () => ({ user: u }) }),
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

describe('SystemJobsController permissions', () => {
  it('is protected by JWT + permissions guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SystemJobsController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it('read endpoints need system_jobs.read or .manage', () => {
    for (const h of ['list', 'runs']) {
      expect(canActivate(h, user(['system_jobs.read']))).toBe(true);
      expect(canActivate(h, user(['system_jobs.manage']))).toBe(true);
      expect(() => canActivate(h, user(['platform_costs.read']))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('run now needs system_jobs.manage', () => {
    expect(canActivate('runNow', user(['system_jobs.manage']))).toBe(true);
    expect(() => canActivate('runNow', user(['system_jobs.read']))).toThrow(
      ForbiddenException,
    );
  });

  it('Super Admin passes everything', () => {
    expect(canActivate('runNow', user([], ['Super Admin']))).toBe(true);
  });
});

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
  attempt?: number;
};

function makeService(
  opts: {
    rows?: Row[];
    cronMode?: 'internal' | 'external';
    runResult?: unknown;
  } = {},
) {
  const rows = opts.rows ?? [];
  const sortDesc = (list: Row[]) =>
    [...list].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const prisma = {
    jobRun: {
      groupBy: jest.fn(
        async ({ where }: { where: { startedAt: { gte: Date } } }) => {
          const map = new Map<
            string,
            { jobName: string; status: string; _count: { _all: number } }
          >();
          for (const r of rows.filter(
            (x) => x.startedAt >= where.startedAt.gte,
          )) {
            const k = `${r.jobName}|${r.status}`;
            const e = map.get(k) ?? {
              jobName: r.jobName,
              status: r.status,
              _count: { _all: 0 },
            };
            e._count._all += 1;
            map.set(k, e);
          }
          return [...map.values()];
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            jobName: string;
            status?: unknown;
            source?: string;
            startedAt?: { gte: Date };
          };
        }) => {
          let list = rows.filter((r) => r.jobName === where.jobName);
          const st = where.status as
            | { not?: string; in?: string[] }
            | undefined;
          if (st?.not) list = list.filter((r) => r.status !== st.not);
          if (st?.in) list = list.filter((r) => st.in!.includes(r.status));
          if (where.source)
            list = list.filter((r) => r.source === where.source);
          if (where.startedAt)
            list = list.filter((r) => r.startedAt >= where.startedAt!.gte);
          return sortDesc(list)[0] ?? null;
        },
      ),
      findMany: jest.fn(
        async ({
          where,
          take,
        }: {
          where: { jobName: string; status?: string };
          take: number;
        }) =>
          sortDesc(
            rows.filter(
              (r) =>
                r.jobName === where.jobName &&
                (!where.status || r.status === where.status),
            ),
          ).slice(0, take),
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((r) => r.id === where.id) ?? null,
      ),
    },
    user: {
      findMany: jest.fn(async () => [
        { id: 'u1', firstName: 'Ada', lastName: 'Admin', email: 'ada@test' },
      ]),
    },
    organisationGeneralSettings: {
      findFirst: jest.fn(async () => ({
        domAutoExtendRotaEnabled: true,
        domAutoExtendRotaRunHour: 12,
      })),
    },
  };
  const runner = {
    cronMode: opts.cronMode ?? 'external',
    failStaleRuns: jest.fn().mockResolvedValue(0),
    runByName: jest.fn(
      async (
        _name: string,
        o: {
          onStarted?: (id: string) => void;
          periodKey: string;
          triggeredById: string;
        },
      ) => {
        const row: Row = {
          id: 'run-manual',
          jobName: _name,
          periodKey: o.periodKey,
          source: 'manual',
          status: 'success',
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 5,
          summary: { ok: true },
          error: null,
          triggeredById: o.triggeredById,
          attempt: 1,
        };
        if (opts.runResult) return opts.runResult;
        rows.push(row);
        o.onStarted?.(row.id);
        return {
          name: _name,
          outcome: 'ran',
          runId: row.id,
          periodKey: o.periodKey,
          status: 'success',
          durationMs: 5,
          summary: { ok: true },
          error: null,
        };
      },
    ),
  };
  const audit = { logAudit: jest.fn().mockResolvedValue(undefined) };
  const orgSettings = {
    getOperationalTimezone: jest.fn().mockResolvedValue('Europe/London'),
  };
  const service = new SystemJobsService(
    prisma as unknown as PrismaService,
    runner as unknown as JobRunner,
    audit as unknown as AuditLogsService,
    orgSettings as unknown as OrganisationGeneralSettingsService,
  );
  return { service, prisma, runner, audit, rows };
}

const now = new Date('2026-10-02T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const run = (
  p: Partial<Row> & { jobName: string; status: string; startedAt: Date },
): Row => ({
  id: `${p.jobName}-${p.startedAt.toISOString()}`,
  periodKey: p.startedAt.toISOString(),
  source: 'function',
  finishedAt: p.status === 'running' ? null : p.startedAt,
  durationMs: p.status === 'running' ? null : 10,
  summary: null,
  error: null,
  triggeredById: null,
  ...p,
});

describe('SystemJobsService.list', () => {
  it('returns all 11 jobs with health, 24h stats and next expected run', async () => {
    const { service, runner } = makeService({
      rows: [
        run({
          jobName: 'late-visit-alert',
          status: 'success',
          startedAt: minutesAgo(3),
        }),
        run({
          jobName: 'late-visit-alert',
          status: 'failed',
          startedAt: minutesAgo(8),
          error: 'x',
        }),
        run({
          jobName: 'survey-distribution',
          status: 'failed',
          startedAt: minutesAgo(1),
        }),
        run({
          jobName: 'ecm-missed-visit',
          status: 'success',
          startedAt: minutesAgo(60),
        }),
        run({
          jobName: 'rolling-rota',
          status: 'running',
          startedAt: minutesAgo(2),
          source: 'manual',
          triggeredById: 'u1',
        }),
      ],
    });
    const res = await service.list(now);
    expect(runner.failStaleRuns).toHaveBeenCalled();
    expect(res.cronMode).toBe('external');
    expect(res.serverTime).toBe(now);
    expect(res.items.map((i) => i.name)).toEqual([...JOB_NAMES]);
    const byName = Object.fromEntries(res.items.map((i) => [i.name, i]));
    expect(byName['late-visit-alert']).toMatchObject({
      health: 'ok',
      runs24h: 2,
      failures24h: 1,
      successRate24h: 50,
      lastSuccessAt: minutesAgo(3),
      trigger: 'function',
      schedule: { cron: '*/5 * * * *', human: 'Every 5 minutes' },
      expectedIntervalMinutes: 5,
    });
    expect(byName['late-visit-alert'].nextExpectedAt?.toISOString()).toBe(
      '2026-10-02T12:05:00.000Z',
    );
    expect(byName['survey-distribution'].health).toBe('failing');
    expect(byName['ecm-missed-visit'].health).toBe('late');
    expect(byName['rolling-rota'].health).toBe('running');
    expect(byName['rolling-rota'].lastRun).toMatchObject({
      source: 'manual',
      triggeredBy: 'Ada Admin',
    });
    expect(byName['learning-maintenance']).toMatchObject({
      health: 'never-run',
      lastRun: null,
      successRate24h: null,
    });
    expect(byName['rolling-rota'].nextExpectedAt?.toISOString()).toBe(
      '2026-10-03T02:00:00.000Z',
    );
  });

  it('uses the org run hour for the rolling rota in internal mode', async () => {
    const { service } = makeService({ cronMode: 'internal' });
    const res = await service.list(now);
    const rota = res.items.find((i) => i.name === 'rolling-rota')!;
    expect(res.cronMode).toBe('internal');
    // 12:00 Europe/London (BST) = 11:00 UTC → next is tomorrow
    expect(rota.nextExpectedAt?.toISOString()).toBe('2026-10-03T11:00:00.000Z');
  });
});

describe('SystemJobsService.runs', () => {
  it('lists runs newest first with status filter and limit', async () => {
    const { service, prisma } = makeService({
      rows: [
        run({
          jobName: 'late-visit-alert',
          status: 'success',
          startedAt: minutesAgo(3),
        }),
        run({
          jobName: 'late-visit-alert',
          status: 'failed',
          startedAt: minutesAgo(8),
        }),
      ],
    });
    const all = await service.runs('late-visit-alert', 50);
    expect(all.items.map((r) => r.status)).toEqual(['success', 'failed']);
    const failed = await service.runs('late-visit-alert', 50, 'failed');
    expect(failed.items).toHaveLength(1);
    await service.runs('late-visit-alert', 5000);
    expect(prisma.jobRun.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 200 }),
    );
    await expect(service.runs('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SystemJobsService.runNow', () => {
  const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  it('runs with source manual and a manual:<minute> key, audit-logged', async () => {
    const { service, runner, audit } = makeService();
    const res = await service.runNow('rolling-rota', 'u1', meta);
    const opts = runner.runByName.mock.calls[0][1];
    expect(runner.runByName.mock.calls[0][0]).toBe('rolling-rota');
    expect(opts).toMatchObject({ source: 'manual', triggeredById: 'u1' });
    expect(opts.periodKey).toMatch(/^manual:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);
    expect(res).toMatchObject({
      id: 'run-manual',
      source: 'manual',
      status: 'success',
      triggeredBy: 'Ada Admin',
    });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'SYSTEM_JOBS',
        action: 'system_job_manual_run',
        recordId: 'run-manual',
        userId: 'u1',
      }),
    );
  });

  it('limits manual runs to one per job per minute (429)', async () => {
    const { service, runner } = makeService({
      rows: [
        run({
          jobName: 'late-visit-alert',
          status: 'success',
          startedAt: new Date(Date.now() - 20_000),
          source: 'manual',
        }),
      ],
    });
    await expect(
      service.runNow('late-visit-alert', 'u1', meta),
    ).rejects.toMatchObject({ status: 429 });
    expect(runner.runByName).not.toHaveBeenCalled();
    // another job is not affected
    await expect(
      service.runNow('survey-distribution', 'u1', meta),
    ).resolves.toMatchObject({ status: 'success' });
  });

  it('turns a same-minute race (already-ran) into 429', async () => {
    const { service } = makeService({
      runResult: {
        name: 'late-visit-alert',
        outcome: 'already-ran',
        runId: 'x',
        periodKey: 'manual:x',
        status: 'success',
        durationMs: 0,
        summary: null,
        error: null,
      },
    });
    const err = await service
      .runNow('late-visit-alert', 'u1', meta)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('404s unknown jobs', async () => {
    const { service } = makeService();
    await expect(service.runNow('nope', 'u1', meta)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
