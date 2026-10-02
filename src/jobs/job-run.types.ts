import type { JobName } from './job-catalogue';

export const JOB_SOURCES = [
  'internal',
  'function',
  'container-job',
  'manual',
] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const JOB_RUN_STATUSES = [
  'running',
  'success',
  'failed',
  'skipped',
] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export type JobSummary = Record<string, unknown>;

/** What a job body returns: `skipped` = nothing to do / gated off (still a healthy run). */
export type JobOutcome = {
  status: 'success' | 'skipped';
  summary: JobSummary;
};

export type JobWork = () => Promise<JobOutcome>;

export function jobSuccess(summary: JobSummary = {}): JobOutcome {
  return { status: 'success', summary };
}

export function jobSkipped(
  reason: string,
  summary: JobSummary = {},
): JobOutcome {
  return { status: 'skipped', summary: { reason, ...summary } };
}

export type JobRunOptions = {
  source: JobSource;
  /** Explicit period key; default = the catalogue's scheduled period for `now`. */
  periodKey?: string;
  triggeredById?: string | null;
  /** Called once the run row exists (before the work starts). */
  onStarted?: (runId: string) => void;
};

export type JobRunResult = {
  name: JobName;
  /** `ran` = this call executed the job (status success|skipped); `already-ran` = period taken. */
  outcome: 'ran' | 'already-ran' | 'failed';
  runId: string | null;
  periodKey: string;
  status: JobRunStatus | null;
  durationMs: number;
  summary: JobSummary | null;
  error: string | null;
};
