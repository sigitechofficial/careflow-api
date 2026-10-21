export const SYSTEM_JOBS_READ = 'system_jobs.read';
export const SYSTEM_JOBS_MANAGE = 'system_jobs.manage';

/** Header carrying the shared secret for POST /internal/jobs/:name. */
export const JOBS_TRIGGER_SECRET_HEADER = 'x-jobs-trigger-secret';

/** Admin "Run now": at most one manual run per job per this window. */
export const MANUAL_RUN_WINDOW_MS = 60_000;

/** Admin "Run now" waits this long for the run to finish before returning it as `running`. */
export const MANUAL_RUN_WAIT_MS = 25_000;
