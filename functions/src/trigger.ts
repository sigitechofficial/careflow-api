/**
 * Calls the Careflow API to run one scheduled job:
 *
 *   POST ${JOBS_API_BASE_URL}/internal/jobs/<name>
 *   x-jobs-trigger-secret: ${JOBS_TRIGGER_SECRET}
 *
 * - 200 s timeout per attempt (AbortController). A timed-out attempt is NOT retried: the API may
 *   still be running the job, and a retry would only see `already-ran` and hide the problem.
 * - One retry after 5 s on a network error or HTTP 5xx (gateway blips during revision roll-outs),
 *   but only if the retry still fits inside the overall budget (host.json functionTimeout is 5 min).
 * - 4xx (bad secret, endpoint disabled, unknown job) fails immediately - retrying cannot help.
 * - `outcome: 'already-ran'` is success (another trigger already ran this period - exactly-once),
 *   except when it is our own retry finding the run our first attempt started and that run failed.
 * - Every outcome is logged in one line; any failure throws so the invocation is recorded as
 *   failed in Application Insights (and the function-failure alert fires).
 *
 * The secret is never logged.
 */

export const TRIGGER_SECRET_HEADER = 'x-jobs-trigger-secret';
export const DEFAULT_TIMEOUT_MS = 200_000;
export const DEFAULT_RETRY_DELAY_MS = 5_000;
/** Stay comfortably under host.json functionTimeout (00:05:00). */
export const DEFAULT_TOTAL_BUDGET_MS = 280_000;
/** Don't bother retrying if less than this would be left for the second attempt. */
const MIN_RETRY_ATTEMPT_MS = 15_000;

/** What the API returns (scheduled-jobs contract). Fields are optional so we tolerate drift. */
export interface JobTriggerResponse {
  name?: string;
  outcome?: 'ran' | 'already-ran' | 'failed' | string;
  runId?: string | null;
  status?: string | null;
  durationMs?: number | null;
  summary?: unknown;
  error?: string | null;
}

export interface JobTriggerResult {
  name: string;
  outcome: 'ran' | 'already-ran';
  runId: string | null;
  status: string | null;
  /** Job duration as reported by the API. */
  durationMs: number | null;
  /** Wall-clock time of the whole trigger (both attempts, incl. retry delay). */
  elapsedMs: number;
  attempts: number;
}

/** Subset of the Functions InvocationContext we use (easy to fake in tests). */
export interface JobLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface TriggerOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryDelayMs?: number;
  totalBudgetMs?: number;
}

export class JobTriggerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'JobTriggerError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readConfig(env: Record<string, string | undefined>): { url: (name: string) => string; secret: string } {
  const base = env.JOBS_API_BASE_URL?.trim();
  const secret = env.JOBS_TRIGGER_SECRET?.trim();
  const missing = [!base && 'JOBS_API_BASE_URL', !secret && 'JOBS_TRIGGER_SECRET'].filter(Boolean);
  // A Key Vault reference that could not be resolved is left as the literal "@Microsoft.KeyVault(...)".
  if (secret?.startsWith('@Microsoft.KeyVault(')) missing.push('JOBS_TRIGGER_SECRET (Key Vault reference not resolved - check id-careflow-func has Key Vault Secrets User)');
  if (missing.length) throw new JobTriggerError(`missing app setting(s): ${missing.join(', ')}`, false);
  let parsed: URL;
  try {
    parsed = new URL(base!);
  } catch {
    throw new JobTriggerError('JOBS_API_BASE_URL is not a valid URL', false);
  }
  const root = parsed.toString().replace(/\/+$/, '');
  return { url: (name) => `${root}/internal/jobs/${encodeURIComponent(name)}`, secret: secret! };
}

function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 300 ? `${oneLine.slice(0, 300)}…` : oneLine;
}

async function attempt(
  name: string,
  url: string,
  secret: string,
  timeoutMs: number,
  doFetch: typeof fetch,
): Promise<JobTriggerResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          [TRIGGER_SECRET_HEADER]: secret,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'careflow-jobs-functions',
        },
        body: '{}',
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new JobTriggerError(`timed out after ${timeoutMs} ms (the API may still be running the job)`, false);
      }
      const cause = (err as { cause?: { code?: string } })?.cause?.code;
      throw new JobTriggerError(`network error: ${(err as Error)?.message ?? String(err)}${cause ? ` (${cause})` : ''}`, true);
    }

    const text = await res.text().catch(() => '');
    if (res.status >= 500) throw new JobTriggerError(`HTTP ${res.status}: ${snippet(text)}`, true, res.status);
    if (res.status === 401 || res.status === 403) {
      throw new JobTriggerError(`HTTP ${res.status}: trigger secret rejected (JOBS_TRIGGER_SECRET differs between API and Function App?)`, false, res.status);
    }
    if (res.status === 404 || res.status === 503) {
      throw new JobTriggerError(`HTTP ${res.status}: endpoint disabled or unknown job '${name}' (is JOBS_TRIGGER_SECRET set on the API?)`, false, res.status);
    }
    if (!res.ok) throw new JobTriggerError(`HTTP ${res.status}: ${snippet(text)}`, false, res.status);

    try {
      return JSON.parse(text) as JobTriggerResponse;
    } catch {
      throw new JobTriggerError(`HTTP ${res.status} but body is not JSON: ${snippet(text)}`, false, res.status);
    }
  } catch (err) {
    // A timeout can also surface while reading the body.
    if (controller.signal.aborted && !(err instanceof JobTriggerError)) {
      throw new JobTriggerError(`timed out after ${timeoutMs} ms (the API may still be running the job)`, false);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function line(fields: Record<string, unknown>): string {
  return (
    '[jobs] ' +
    Object.entries(fields)
      .map(([k, v]) => `${k}=${v === undefined || v === null || v === '' ? '-' : String(v)}`)
      .join(' ')
  );
}

export async function triggerJob(name: string, logger: JobLogger, options: TriggerOptions = {}): Promise<JobTriggerResult> {
  const env = options.env ?? process.env;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;

  const started = now();
  let attempts = 0;
  const fail = (err: unknown, run: { runId?: string | null; status?: string | null; durationMs?: number | null } = {}): never => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      line({ job: name, outcome: 'failed', status: run.status, runId: run.runId, durationMs: run.durationMs, elapsedMs: now() - started, attempts, error: message }),
    );
    throw err instanceof Error ? err : new Error(message);
  };

  let config: ReturnType<typeof readConfig>;
  try {
    config = readConfig(env);
  } catch (err) {
    return fail(err);
  }

  let body: JobTriggerResponse | undefined;
  let attemptTimeout = timeoutMs;
  for (;;) {
    attempts++;
    try {
      body = await attempt(name, config.url(name), config.secret, attemptTimeout, doFetch);
      break;
    } catch (err) {
      const retryable = err instanceof JobTriggerError && err.retryable;
      const remaining = totalBudgetMs - (now() - started) - retryDelayMs;
      if (!retryable || attempts >= 2 || remaining < MIN_RETRY_ATTEMPT_MS) return fail(err);
      logger.warn(line({ job: name, outcome: 'retrying', attempt: attempts, retryInMs: retryDelayMs, error: (err as Error).message }));
      await sleep(retryDelayMs);
      attemptTimeout = Math.min(timeoutMs, remaining);
    }
  }

  const outcome = body.outcome;
  const status = body.status ?? null;
  const runId = body.runId ?? null;
  const durationMs = typeof body.durationMs === 'number' ? body.durationMs : null;

  if (outcome === 'failed' || (outcome === 'ran' && status === 'failed')) {
    return fail(new JobTriggerError(`job failed (runId=${runId ?? '-'}): ${snippet(body.error ?? 'see JobRun error in the admin System jobs screen')}`, false), { runId, status, durationMs });
  }
  if (outcome === 'already-ran' && attempts > 1 && status === 'failed') {
    // Our first attempt got a 5xx/network error but the API had already started (and failed) this period's run.
    return fail(new JobTriggerError(`job failed (runId=${runId ?? '-'}) - found by retry as already-ran/failed`, false), { runId, status, durationMs });
  }
  if (outcome !== 'ran' && outcome !== 'already-ran') {
    return fail(new JobTriggerError(`unexpected response outcome '${String(outcome)}'`, false), { runId, status, durationMs });
  }

  const result: JobTriggerResult = { name, outcome, runId, status, durationMs, elapsedMs: now() - started, attempts };
  logger.log(line({ job: name, outcome, status, runId, durationMs, elapsedMs: result.elapsedMs, attempts }));
  return result;
}
