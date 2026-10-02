import { strict as assert } from 'node:assert';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { JobLogger, triggerJob } from '../src/trigger';

// Same helper, real global fetch against a real local HTTP server (checks the AbortController path).
const silent: JobLogger = { log() {}, warn() {}, error() {} };

describe('triggerJob over real HTTP', () => {
  let server: Server;
  let base = '';
  const seen: { url?: string; secret?: string | string[] }[] = [];

  before(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      seen.push({ url: req.url, secret: req.headers['x-jobs-trigger-secret'] });
      if (req.url === '/internal/jobs/slow-job') return; // never answers
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'survey-distribution', outcome: 'ran', runId: 'r1', status: 'success', durationMs: 3 }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  it('succeeds', async () => {
    const r = await triggerJob('survey-distribution', silent, { env: { JOBS_API_BASE_URL: base, JOBS_TRIGGER_SECRET: 'abc' } });
    assert.equal(r.outcome, 'ran');
    assert.deepEqual(seen.at(-1), { url: '/internal/jobs/survey-distribution', secret: 'abc' });
  });

  it('times out', async () => {
    await assert.rejects(
      triggerJob('slow-job', silent, { env: { JOBS_API_BASE_URL: base, JOBS_TRIGGER_SECRET: 'abc' }, timeoutMs: 150 }),
      /timed out after 150 ms/,
    );
  });
});
