import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  JOB_CATALOGUE,
  getJobDefinition,
  isDailyJob,
  manualPeriodKey,
  type JobDefinition,
} from './job-catalogue';
import { JobRunner } from './job-runner.service';
import type { JobRunResult, JobRunStatus } from './job-run.types';
import { MANUAL_RUN_WAIT_MS, MANUAL_RUN_WINDOW_MS } from './jobs.constants';
import {
  nextDailyHourInTimeZone,
  nextUtcCronOccurrence,
} from './job-schedule.util';
import {
  computeJobHealth,
  successRatePercent,
  type JobHealth,
} from './system-jobs-health.util';

const DAY_MS = 86_400_000;
const DEFAULT_ROTA_RUN_HOUR = 12;

type JobRunRow = {
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

export type JobRunView = {
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
  /** Display name of the user who pressed "Run now"; null for scheduled runs. */
  triggeredBy: string | null;
  /** 1, or more when a failed/stale run of the same period was retried. */
  attempt: number;
};

export type SystemJobView = {
  name: string;
  label: string;
  description: string;
  trigger: JobDefinition['trigger'];
  schedule: { cron: string; human: string };
  expectedIntervalMinutes: number;
  lastRun: JobRunView | null;
  lastSuccessAt: Date | null;
  nextExpectedAt: Date | null;
  health: JobHealth;
  runs24h: number;
  failures24h: number;
  /** % of finished runs in the last 24 h that did not fail (1 dp); null when none finished. */
  successRate24h: number | null;
};

const RUN_SELECT = {
  id: true,
  jobName: true,
  periodKey: true,
  source: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  summary: true,
  error: true,
  triggeredById: true,
  attempt: true,
} as const;

@Injectable()
export class SystemJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: JobRunner,
    private readonly auditLogs: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async list(now = new Date()) {
    await this.runner.failStaleRuns(undefined, now);
    const since = new Date(now.getTime() - DAY_MS);

    const [counts, perJob] = await Promise.all([
      this.prisma.jobRun.groupBy({
        by: ['jobName', 'status'],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
      }),
      Promise.all(
        JOB_CATALOGUE.map(async (def) => {
          const [lastRun, lastFinished, lastSuccess] = await Promise.all([
            this.prisma.jobRun.findFirst({
              where: { jobName: def.name },
              orderBy: { startedAt: 'desc' },
              select: RUN_SELECT,
            }),
            this.prisma.jobRun.findFirst({
              where: { jobName: def.name, status: { not: 'running' } },
              orderBy: { startedAt: 'desc' },
              select: { status: true },
            }),
            this.prisma.jobRun.findFirst({
              where: {
                jobName: def.name,
                status: { in: ['success', 'skipped'] },
              },
              orderBy: { startedAt: 'desc' },
              select: { startedAt: true, finishedAt: true },
            }),
          ]);
          return { def, lastRun, lastFinished, lastSuccess };
        }),
      ),
    ]);

    const names = await this.userNames(
      perJob.map((j) => j.lastRun?.triggeredById),
    );
    const rotaNext = await this.rollingRotaInternalNext(now);

    const items: SystemJobView[] = perJob.map(
      ({ def, lastRun, lastFinished, lastSuccess }) => {
        const byStatus = (status: JobRunStatus) =>
          counts.find((c) => c.jobName === def.name && c.status === status)
            ?._count._all ?? 0;
        const runs24h = counts
          .filter((c) => c.jobName === def.name)
          .reduce((sum, c) => sum + c._count._all, 0);
        const failures24h = byStatus('failed');
        const finished24h = runs24h - byStatus('running');
        const lastSuccessAt = lastSuccess
          ? (lastSuccess.finishedAt ?? lastSuccess.startedAt)
          : null;
        return {
          name: def.name,
          label: def.label,
          description: def.description,
          trigger: def.trigger,
          schedule: def.schedule,
          expectedIntervalMinutes: def.expectedIntervalMinutes,
          lastRun: lastRun ? this.toView(lastRun, names) : null,
          lastSuccessAt,
          nextExpectedAt:
            def.name === 'rolling-rota' && rotaNext !== undefined
              ? rotaNext
              : nextUtcCronOccurrence(def.schedule.cron, now),
          health: computeJobHealth({
            lastRun,
            lastFinishedStatus: lastFinished?.status ?? null,
            lastSuccessAt,
            expectedIntervalMinutes: def.expectedIntervalMinutes,
            daily: isDailyJob(def),
            now,
          }),
          runs24h,
          failures24h,
          successRate24h: successRatePercent(finished24h, failures24h),
        };
      },
    );

    return { cronMode: this.runner.cronMode, serverTime: now, items };
  }

  async runs(name: string, limit = 50, status?: string) {
    const def = this.requireJob(name);
    const rows = await this.prisma.jobRun.findMany({
      where: { jobName: def.name, ...(status ? { status } : {}) },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: RUN_SELECT,
    });
    const names = await this.userNames(rows.map((r) => r.triggeredById));
    return { items: rows.map((r) => this.toView(r, names)) };
  }

  /**
   * Admin "Run now": source `manual`, period `manual:<ISO minute>`, max 1 per job per minute.
   * Waits up to MANUAL_RUN_WAIT_MS; a longer run (e.g. rolling rota) is returned as `running`
   * and keeps going in the background — poll the runs endpoint.
   */
  async runNow(
    name: string,
    userId: string,
    meta: RequestAuditMeta,
  ): Promise<JobRunView> {
    const def = this.requireJob(name);
    const now = new Date();

    const recent = await this.prisma.jobRun.findFirst({
      where: {
        jobName: def.name,
        source: 'manual',
        startedAt: { gte: new Date(now.getTime() - MANUAL_RUN_WINDOW_MS) },
      },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    if (recent) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (recent.startedAt.getTime() + MANUAL_RUN_WINDOW_MS - now.getTime()) /
            1000,
        ),
      );
      throw this.tooManyRuns(retryAfter);
    }

    let startedRunId: string | null = null;
    let markStarted: (id: string) => void = () => undefined;
    const started = new Promise<string>((resolve) => {
      markStarted = resolve;
    });
    const runPromise: Promise<JobRunResult | null> = this.runner
      .runByName(def.name, {
        source: 'manual',
        periodKey: manualPeriodKey(now),
        triggeredById: userId,
        onStarted: (id) => {
          startedRunId = id;
          markStarted(id);
        },
      })
      .catch(() => null);

    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      runPromise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), MANUAL_RUN_WAIT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (finished !== 'timeout') {
      if (finished?.outcome === 'already-ran') throw this.tooManyRuns(60);
      if (!finished?.runId) {
        throw new InternalServerErrorException(
          finished?.error ?? 'Could not start the job',
        );
      }
    }
    const runId =
      (finished !== 'timeout' ? finished?.runId : null) ??
      startedRunId ??
      (await started);

    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.SYSTEM_JOBS,
      action: 'system_job_manual_run',
      recordType: 'JobRun',
      recordId: runId,
      description: `Ran scheduled job "${def.label}" manually`,
      metadata: { jobName: def.name },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const row = await this.prisma.jobRun.findUnique({
      where: { id: runId },
      select: RUN_SELECT,
    });
    if (!row) throw new InternalServerErrorException('Run record not found');
    const names = await this.userNames([row.triggeredById]);
    return this.toView(row, names);
  }

  private requireJob(name: string): JobDefinition {
    const def = getJobDefinition(name);
    if (!def) throw new NotFoundException(`Unknown job ${name}`);
    return def;
  }

  private tooManyRuns(retryAfterSeconds: number) {
    return new HttpException(
      `Run now is limited to once per minute per job. Try again in ${retryAfterSeconds} seconds.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * In CRON_MODE=internal the rolling rota runs at the organisation's run hour (hourly UTC
   * tick, org-local hour); returns undefined in external mode (catalogue cron applies).
   */
  private async rollingRotaInternalNext(
    now: Date,
  ): Promise<Date | null | undefined> {
    if (this.runner.cronMode !== 'internal') return undefined;
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: {
        domAutoExtendRotaEnabled: true,
        domAutoExtendRotaRunHour: true,
      },
    });
    if (settings && !settings.domAutoExtendRotaEnabled) return null;
    const raw = settings?.domAutoExtendRotaRunHour ?? DEFAULT_ROTA_RUN_HOUR;
    const hour = Number.isFinite(raw)
      ? Math.min(23, Math.max(0, Math.round(raw)))
      : DEFAULT_ROTA_RUN_HOUR;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    return nextDailyHourInTimeZone(hour, timeZone, now);
  }

  private async userNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
      ]),
    );
  }

  private toView(row: JobRunRow, names: Map<string, string>): JobRunView {
    return {
      id: row.id,
      jobName: row.jobName,
      periodKey: row.periodKey,
      source: row.source,
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs,
      summary: row.summary ?? null,
      error: row.error,
      triggeredBy: row.triggeredById
        ? (names.get(row.triggeredById) ?? null)
        : null,
      attempt: row.attempt,
    };
  }
}
