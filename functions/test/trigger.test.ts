import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { DEFAULT_TIMEOUT_MS, JobLogger, TRIGGER_SECRET_HEADER, triggerJob } from '../src/trigger';
import { FUNCTION_JOBS } from '../src/jobs';

const ENV = { JOBS_API_BASE_URL: 'https://api.example.test/', JOBS_TRIGGER_SECRET: 's3cret-value-for-tests' };

function recorder(): JobLogger & { lines: { level: string; text: string }[] } {
  const lines: { level: string; text: string }[] = [];
  const push = (level: string) => (...args: unknown[]) => lines.push({ level, text: args.map(String).join(' ') });
  return { lines, log: push('info'), warn: push('warn'), error: push('error') };
}

type Step = { status: number; body?: unknown } | Error | 'hang';

/** Fake fetch that plays the given steps in order and records the calls. */
function fakeFetch(steps: Step[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const step = steps.shift();
    if (!step) throw new Error('unexpected extra fetch call');
    if (step === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      });
    }
    if (step instanceof Error) throw step;
    const text = typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {});
    return new Response(text, { status: step.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const noSleep = { sleeps: [] as number[], fn: async function (this: void, ms: number) { noSleep.sleeps.push(ms); } };

function opts(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  noSleep.sleeps = [];
  return { env: ENV, fetch: fetchImpl, sleep: noSleep.fn, ...extra };
}

describe('triggerJob', () => {
  it('posts to /internal/jobs/<name> with the secret header and returns the run on success', async () => {
    const f = fakeFetch([{ status: 200, body: { name: 'late-visit-alert', outcome: 'ran', runId: 'run-1', status: 'success', durationMs: 1234 } }]);
    const log = recorder();
    const result = await triggerJob('late-visit-alert', log, opts(f.impl));

    assert.equal(result.outcome, 'ran');
    assert.equal(result.runId, 'run-1');
    assert.equal(result.durationMs, 1234);
    assert.equal(result.attempts, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, 'https://api.example.test/internal/jobs/late-visit-alert');
    assert.equal(f.calls[0].init.method, 'POST');
    assert.equal((f.calls[0].init.headers as Record<string, string>)[TRIGGER_SECRET_HEADER], ENV.JOBS_TRIGGER_SECRET);
    assert.match(log.lines[0].text, /^\[jobs\] job=late-visit-alert outcome=ran status=success runId=run-1 durationMs=1234 /);
    assert.ok(log.lines.every((l) => !l.text.includes(ENV.JOBS_TRIGGER_SECRET)), 'secret must never be logged');
  });

  it('treats already-ran as success', async () => {
    const f = fakeFetch([{ status: 200, body: { outcome: 'already-ran', runId: 'run-0', status: 'success', durationMs: null } }]);
    const log = recorder();
    const result = await triggerJob('survey-distribution', log, opts(f.impl));
    assert.equal(result.outcome, 'already-ran');
    assert.equal(log.lines.filter((l) => l.level === 'error').length, 0);
  });

  it('throws on 401 without retrying', async () => {
    const f = fakeFetch([{ status: 401, body: { message: 'Unauthorized' } }]);
    const log = recorder();
    await assert.rejects(triggerJob('ecm-missed-visit', log, opts(f.impl)), /HTTP 401/);
    assert.equal(f.calls.length, 1);
    assert.equal(noSleep.sleeps.length, 0);
    assert.match(log.lines.at(-1)!.text, /outcome=failed/);
    assert.equal(log.lines.at(-1)!.level, 'error');
  });

  it('retries once after 5 s on a 5xx, then succeeds', async () => {
    const f = fakeFetch([{ status: 502, body: 'Bad Gateway' }, { status: 200, body: { outcome: 'ran', runId: 'run-2', status: 'success', durationMs: 50 } }]);
    const log = recorder();
    const result = await triggerJob('visit-start-reminder', log, opts(f.impl));
    assert.equal(result.outcome, 'ran');
    assert.equal(result.attempts, 2);
    assert.deepEqual(noSleep.sleeps, [5000]);
    assert.ok(log.lines.some((l) => l.level === 'warn' && /outcome=retrying/.test(l.text)));
  });

  it('retries once on a network error, then throws if it fails again', async () => {
    const f = fakeFetch([new TypeError('fetch failed'), { status: 503, body: 'down' }]);
    await assert.rejects(triggerJob('platform-costs-sync', recorder(), opts(f.impl)), /HTTP 503/);
    assert.equal(f.calls.length, 2);
  });

  it('throws on timeout and does not retry (the API may still be running the job)', async () => {
    const f = fakeFetch(['hang']);
    await assert.rejects(triggerJob('ecm-missing-checkout', recorder(), opts(f.impl, { timeoutMs: 30 })), /timed out after 30 ms/);
    assert.equal(f.calls.length, 1);
  });

  it('throws when an app setting is missing (and makes no request)', async () => {
    const f = fakeFetch([]);
    await assert.rejects(
      triggerJob('employee-payout-auto', recorder(), { ...opts(f.impl), env: { JOBS_API_BASE_URL: 'https://api.example.test' } }),
      /missing app setting\(s\): JOBS_TRIGGER_SECRET/,
    );
    await assert.rejects(triggerJob('employee-payout-auto', recorder(), { ...opts(f.impl), env: {} }), /JOBS_API_BASE_URL, JOBS_TRIGGER_SECRET/);
    await assert.rejects(
      triggerJob('employee-payout-auto', recorder(), {
        ...opts(f.impl),
        env: { ...ENV, JOBS_TRIGGER_SECRET: '@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/x/)' },
      }),
      /Key Vault reference not resolved/,
    );
    assert.equal(f.calls.length, 0);
  });

  it('throws when the API ran the job and it failed', async () => {
    const f = fakeFetch([{ status: 200, body: { outcome: 'failed', runId: 'run-3', status: 'failed', error: 'boom' } }]);
    await assert.rejects(triggerJob('late-visit-alert', recorder(), opts(f.impl)), /job failed \(runId=run-3\): boom/);
    assert.equal(f.calls.length, 1);
  });

  it('fails when a retry finds our own failed run as already-ran', async () => {
    const f = fakeFetch([{ status: 504, body: 'gateway timeout' }, { status: 200, body: { outcome: 'already-ran', runId: 'run-4', status: 'failed' } }]);
    await assert.rejects(triggerJob('late-visit-alert', recorder(), opts(f.impl)), /already-ran\/failed/);
  });

  it('skips the retry when it would not fit in the overall time budget', async () => {
    let t = 0;
    const f = fakeFetch([{ status: 500, body: 'x' }]);
    const fetchAdvancing = (async (u: string, i: RequestInit) => {
      t += 270_000; // first attempt took 270 s
      return f.impl(u, i);
    }) as typeof fetch;
    await assert.rejects(triggerJob('late-visit-alert', recorder(), opts(fetchAdvancing, { now: () => t })), /HTTP 500/);
    assert.equal(f.calls.length, 1);
  });

  it('uses a 200 s per-attempt timeout by default', () => {
    assert.equal(DEFAULT_TIMEOUT_MS, 200_000);
  });
});

describe('job catalogue', () => {
  it('has the 7 function jobs with 6-field NCRONTAB schedules', () => {
    assert.deepEqual(
      FUNCTION_JOBS.map((j) => [j.name, j.schedule]),
      [
        ['survey-distribution', '0 * * * * *'],
        ['visit-start-reminder', '0 */2 * * * *'],
        ['late-visit-alert', '0 */5 * * * *'],
        ['ecm-missed-visit', '0 */5 * * * *'],
        ['ecm-missing-checkout', '0 */15 * * * *'],
        ['platform-costs-sync', '0 5 * * * *'],
        ['employee-payout-auto', '0 0 * * * *'],
      ],
    );
  });
});
