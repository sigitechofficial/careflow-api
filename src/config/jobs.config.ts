import { registerAs } from '@nestjs/config';

/**
 * Scheduled jobs (src/jobs).
 * - CRON_MODE=internal (default): the in-process @Cron handlers run (cPanel / single API replica).
 * - CRON_MODE=external: @Cron handlers return immediately; Azure Functions call
 *   POST /internal/jobs/:name and Container Apps Jobs run `node dist/src/jobs/run-job.js <name>`.
 * - JOBS_TRIGGER_SECRET: shared secret for POST /internal/jobs/:name (header
 *   x-jobs-trigger-secret). Unset = endpoint disabled (503).
 */
export type CronMode = 'internal' | 'external';

export const CRON_MODES: readonly CronMode[] = ['internal', 'external'];

export type JobsConfig = {
  cronMode: CronMode;
  triggerSecret: string;
};

export function parseCronMode(value: string | undefined | null): CronMode {
  return (value ?? '').trim().toLowerCase() === 'external'
    ? 'external'
    : 'internal';
}

export function buildJobsConfig(
  env: NodeJS.ProcessEnv = process.env,
): JobsConfig {
  return {
    cronMode: parseCronMode(env.CRON_MODE),
    triggerSecret: (env.JOBS_TRIGGER_SECRET ?? '').trim(),
  };
}

export const jobsConfig = registerAs('jobs', () => buildJobsConfig());
