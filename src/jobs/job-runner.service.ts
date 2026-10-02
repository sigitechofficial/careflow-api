import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { parseCronMode, type CronMode } from '../config/jobs.config';
import {
  JOB_CATALOGUE,
  getJobDefinition,
  periodKeyFor,
  type JobDefinition,
  type JobName,
} from './job-catalogue';
import { JobHandlerRegistry } from './job-handler.registry';
import type {
  JobOutcome,
  JobRunOptions,
  JobRunResult,
  JobRunStatus,
  JobSource,
  JobSummary,
  JobWork,
} from './job-run.types';

/** A `running` row older than this is treated as abandoned (process died) and marked failed. */
export const STALE_RUNNING_MS = 60 * 60_000;
/** Retention pass runs at most this often per process. */
export const RETENTION_INTERVAL_MS = 60 * 60_000;
const MAX_ERROR_LENGTH = 4_000;
const MAX_SUMMARY_JSON_LENGTH = 20_000;

/** One-line, log-safe error text (first 200 chars, newlines stripped). */
export function logSafeError(error: string): string {
  return error.replace(/[\r\n]+/g, ' ').slice(0, 200);
}

export function formatJobRunLogLine(p: {
  name: string;
  status: string;
  source: string;
  runId: string | null;
  durationMs: number;
  periodKey: string;
  error?: string | null;
}): string {
  const base =
    `job=${p.name} status=${p.status} source=${p.source} runId=${p.runId ?? '-'} ` +
    `durationMs=${Math.max(0, Math.round(p.durationMs))} periodKey=${p.periodKey}`;
  return p.error ? `${base} error=${logSafeError(p.error)}` : base;
}

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message || err.name : String(err);
  return (raw || 'Unknown error').slice(0, MAX_ERROR_LENGTH);
}

/** JSON-safe, size-capped copy of a job summary. */
export function sanitiseSummary(
  summary: JobSummary | undefined | null,
): JobSummary {
  if (!summary) return {};
  try {
    const json = JSON.stringify(summary);
    if (json.length > MAX_SUMMARY_JSON_LENGTH) {
      return { truncated: true, preview: json.slice(0, 2_000) };
    }
    return JSON.parse(json) as JobSummary;
  } catch {
    return { unserialisable: true };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Runs catalogue jobs with exactly-once semantics per (jobName, periodKey):
 * inserts a `running` JobRun row first — a unique conflict means another trigger
 * (in-process @Cron, Azure Function, Container Apps Job) already took the period and the
 * work is not run, unless that earlier run failed (or went stale), in which case this call
 * atomically claims it and retries (attempt + 1). Failures are recorded on the row and never
 * rethrown to the scheduler.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger('JobRunner');
  private lastRetentionAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
    @Optional()
    private readonly orgSettings?: OrganisationGeneralSettingsService,
    @Optional() private readonly handlers?: JobHandlerRegistry,
  ) {}

  get cronMode(): CronMode {
    const fromConfig = this.config?.get<CronMode>('jobs.cronMode');
    return fromConfig ?? parseCronMode(process.env.CRON_MODE);
  }

  /** Run the job's registered @JobHandler method. */
  async runByName(
    name: JobName,
    options: JobRunOptions,
  ): Promise<JobRunResult> {
    const work = this.handlers?.get(name);
    if (!work) {
      return this.run(name, options, () =>
        Promise.reject(new Error(`No handler registered for job ${name}`)),
      );
    }
    return this.run(name, options, work);
  }

  async run(
    name: JobName,
    options: JobRunOptions,
    work: JobWork,
  ): Promise<JobRunResult> {
    const def = getJobDefinition(name);
    const source: JobSource = options.source;
    const startedAt = new Date();
    let periodKey = options.periodKey ?? '';

    if (!def) {
      const error = `Unknown job ${name}`;
      this.logger.error(
        formatJobRunLogLine({
          name,
          status: 'failed',
          source,
          runId: null,
          durationMs: 0,
          periodKey: periodKey || '-',
          error,
        }),
      );
      return this.result(name, 'failed', null, periodKey, null, 0, null, error);
    }

    let runId: string;
    try {
      if (!periodKey) periodKey = await this.scheduledPeriodKey(def, startedAt);
      await this.failStaleRuns(name, startedAt);
      const row = await this.prisma.jobRun.create({
        data: {
          jobName: name,
          periodKey,
          source,
          status: 'running',
          startedAt,
          triggeredById: options.triggeredById ?? null,
        },
        select: { id: true },
      });
      runId = row.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const retryId = await this.claimRetry(
          name,
          periodKey,
          source,
          startedAt,
          options.triggeredById ?? null,
        ).catch(() => null);
        if (!retryId) return this.alreadyRan(name, source, periodKey);
        runId = retryId;
      } else {
        const error = `Could not record job start: ${errorMessage(err)}`;
        this.logger.error(
          formatJobRunLogLine({
            name,
            status: 'failed',
            source,
            runId: null,
            durationMs: Date.now() - startedAt.getTime(),
            periodKey: periodKey || '-',
            error,
          }),
        );
        return this.result(
          name,
          'failed',
          null,
          periodKey,
          null,
          Date.now() - startedAt.getTime(),
          null,
          error,
        );
      }
    }

    options.onStarted?.(runId);

    let status: JobRunStatus;
    let summary: JobSummary | null = null;
    let error: string | null = null;
    try {
      const overlapping = await this.findOverlappingRun(name, runId, startedAt);
      const outcome: JobOutcome = overlapping
        ? {
            status: 'skipped',
            summary: {
              reason: 'Previous run still in progress',
              runningRunId: overlapping.id,
              runningPeriodKey: overlapping.periodKey,
            },
          }
        : await work();
      status = outcome?.status === 'skipped' ? 'skipped' : 'success';
      summary = sanitiseSummary(outcome?.summary);
    } catch (err) {
      status = 'failed';
      error = errorMessage(err);
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    try {
      await this.prisma.jobRun.update({
        where: { id: runId },
        data: {
          status,
          finishedAt,
          durationMs,
          summary: (summary ?? undefined) as Prisma.InputJsonValue | undefined,
          error,
        },
      });
    } catch (err) {
      this.logger.error(
        `job=${name} runId=${runId} could not record finish: ${logSafeError(errorMessage(err))}`,
      );
    }

    const line = formatJobRunLogLine({
      name,
      status,
      source,
      runId,
      durationMs,
      periodKey,
      error,
    });
    if (status === 'failed') this.logger.error(line);
    else this.logger.log(line);

    await this.maybeApplyRetention(finishedAt);

    return this.result(
      name,
      status === 'failed' ? 'failed' : 'ran',
      runId,
      periodKey,
      status,
      durationMs,
      summary,
      error,
    );
  }

  /**
   * The period already has a row: re-run it only when that row failed (or is a stale
   * `running` row). The claim is a guarded update on (id, attempt, status), so of two
   * concurrent retries exactly one wins; success/skipped/fresh running rows stay blocking.
   * Returns the claimed run id, or null when the period is taken.
   */
  private async claimRetry(
    name: JobName,
    periodKey: string,
    source: JobSource,
    now: Date,
    triggeredById: string | null,
  ): Promise<string | null> {
    const existing = await this.prisma.jobRun.findUnique({
      where: { jobName_periodKey: { jobName: name, periodKey } },
      select: { id: true, status: true, startedAt: true, attempt: true },
    });
    if (!existing) return null;
    const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS);
    const retryable =
      existing.status === 'failed' ||
      (existing.status === 'running' &&
        existing.startedAt.getTime() < staleBefore.getTime());
    if (!retryable) return null;
    const claimed = await this.prisma.jobRun.updateMany({
      where: {
        id: existing.id,
        attempt: existing.attempt,
        OR: [
          { status: 'failed' },
          { status: 'running', startedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: 'running',
        source,
        startedAt: now,
        finishedAt: null,
        durationMs: null,
        summary: Prisma.DbNull,
        error: null,
        triggeredById,
        attempt: existing.attempt + 1,
      },
    });
    if (claimed.count !== 1) return null;
    this.logger.log(
      `Retrying ${existing.status === 'failed' ? 'failed' : 'stale'} run of ${name} for ${periodKey} ` +
        `(runId ${existing.id}, attempt ${existing.attempt + 1}, source ${source})`,
    );
    return existing.id;
  }

  /** Scheduled period key for `now` (org-local date for org-date jobs). */
  async scheduledPeriodKey(def: JobDefinition, now: Date): Promise<string> {
    if (def.period.kind !== 'org-date') return periodKeyFor(def, now);
    const timeZone = this.orgSettings
      ? await this.orgSettings.getOperationalTimezone()
      : undefined;
    return periodKeyFor(def, now, timeZone);
  }

  /** Marks `running` rows older than STALE_RUNNING_MS as failed (optionally for one job). */
  async failStaleRuns(name?: JobName, now = new Date()): Promise<number> {
    const stale = await this.prisma.jobRun.findMany({
      where: {
        ...(name ? { jobName: name } : {}),
        status: 'running',
        startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) },
      },
      select: {
        id: true,
        jobName: true,
        periodKey: true,
        source: true,
        startedAt: true,
      },
    });
    let marked = 0;
    for (const row of stale) {
      const durationMs = now.getTime() - row.startedAt.getTime();
      const res = await this.prisma.jobRun.updateMany({
        where: { id: row.id, status: 'running' },
        data: {
          status: 'failed',
          finishedAt: now,
          durationMs,
          error: `stale: no finish recorded within ${STALE_RUNNING_MS / 60_000} minutes (process stopped?)`,
        },
      });
      if (res.count === 0) continue;
      marked += 1;
      this.logger.warn(
        formatJobRunLogLine({
          name: row.jobName,
          status: 'stale',
          source: row.source,
          runId: row.id,
          durationMs,
          periodKey: row.periodKey,
        }),
      );
    }
    return marked;
  }

  /**
   * Deletes old JobRun rows: minute/hour jobs after 7 days, daily jobs after 90 days.
   * Returns the number of rows removed.
   */
  async applyRetention(now = new Date()): Promise<number> {
    const byDays = new Map<number, JobName[]>();
    for (const def of JOB_CATALOGUE) {
      byDays.set(def.retentionDays, [
        ...(byDays.get(def.retentionDays) ?? []),
        def.name,
      ]);
    }
    let removed = 0;
    for (const [days, names] of byDays) {
      const res = await this.prisma.jobRun.deleteMany({
        where: {
          jobName: { in: names },
          startedAt: { lt: new Date(now.getTime() - days * 86_400_000) },
          status: { not: 'running' },
        },
      });
      removed += res.count;
    }
    return removed;
  }

  private async maybeApplyRetention(now: Date): Promise<void> {
    if (now.getTime() - this.lastRetentionAt < RETENTION_INTERVAL_MS) return;
    this.lastRetentionAt = now.getTime();
    try {
      const removed = await this.applyRetention(now);
      if (removed > 0)
        this.logger.log(`JobRun retention: removed ${removed} old run(s)`);
    } catch (err) {
      this.logger.warn(
        `JobRun retention failed: ${logSafeError(errorMessage(err))}`,
      );
    }
  }

  /**
   * Another non-stale run of the same job that started before this one (ties broken by id),
   * so exactly one of two concurrent runs for different periods does the work.
   */
  private findOverlappingRun(name: JobName, runId: string, startedAt: Date) {
    return this.prisma.jobRun.findFirst({
      where: {
        jobName: name,
        status: 'running',
        id: { not: runId },
        startedAt: { gte: new Date(startedAt.getTime() - STALE_RUNNING_MS) },
        OR: [
          { startedAt: { lt: startedAt } },
          { startedAt, id: { lt: runId } },
        ],
      },
      orderBy: { startedAt: 'asc' },
      select: { id: true, periodKey: true },
    });
  }

  private async alreadyRan(
    name: JobName,
    source: JobSource,
    periodKey: string,
  ): Promise<JobRunResult> {
    const existing = await this.prisma.jobRun
      .findUnique({
        where: { jobName_periodKey: { jobName: name, periodKey } },
        select: { id: true, status: true, summary: true, error: true },
      })
      .catch(() => null);
    this.logger.log(
      formatJobRunLogLine({
        name,
        status: 'already-ran',
        source,
        runId: existing?.id ?? null,
        durationMs: 0,
        periodKey,
      }),
    );
    return this.result(
      name,
      'already-ran',
      existing?.id ?? null,
      periodKey,
      (existing?.status as JobRunStatus | undefined) ?? null,
      0,
      (existing?.summary as JobSummary | null | undefined) ?? null,
      existing?.error ?? null,
    );
  }

  private result(
    name: JobName,
    outcome: JobRunResult['outcome'],
    runId: string | null,
    periodKey: string,
    status: JobRunStatus | null,
    durationMs: number,
    summary: JobSummary | null,
    error: string | null,
  ): JobRunResult {
    return {
      name,
      outcome,
      runId,
      periodKey,
      status,
      durationMs,
      summary,
      error,
    };
  }
}

/** True when scheduling is external (Azure); in-process @Cron handlers must do nothing. */
export function isExternalCronMode(runner?: JobRunner): boolean {
  return (
    (runner ? runner.cronMode : parseCronMode(process.env.CRON_MODE)) ===
    'external'
  );
}

/**
 * Body of an in-process @Cron handler: no-op when CRON_MODE=external, otherwise runs the
 * job through JobRunner with source `internal` (the period key dedupes against Azure triggers).
 * Without a JobRunner (isolated unit tests) the work runs directly.
 */
export async function runCronTick(
  runner: JobRunner | undefined,
  name: JobName,
  work: JobWork,
): Promise<void> {
  if (isExternalCronMode(runner)) return;
  if (runner) {
    await runner.run(name, { source: 'internal' }, work);
    return;
  }
  await work();
}
