import { exitCodeFor, parseRunJobArgs } from './run-job.args';
import { buildJobsConfig, parseCronMode } from '../config/jobs.config';
import { validateEnv } from '../config/env.validation';

describe('run-job CLI args', () => {
  it('parses a job name and optional period key', () => {
    expect(parseRunJobArgs(['rolling-rota'])).toEqual({
      name: 'rolling-rota',
      periodKey: undefined,
    });
    expect(
      parseRunJobArgs(['learning-maintenance', '--period-key=2026-10-02']),
    ).toEqual({
      name: 'learning-maintenance',
      periodKey: '2026-10-02',
    });
  });

  it('rejects missing/unknown names and bad period keys', () => {
    expect(parseRunJobArgs([])).toEqual({ error: 'Missing job name' });
    expect(parseRunJobArgs(['nope'])).toEqual({ error: 'Unknown job "nope"' });
    expect(
      parseRunJobArgs(['rolling-rota', '--period-key=a b']),
    ).toHaveProperty('error');
  });

  it('exits 0 on success/already-ran and 1 on failure', () => {
    expect(exitCodeFor('ran')).toBe(0);
    expect(exitCodeFor('already-ran')).toBe(0);
    expect(exitCodeFor('failed')).toBe(1);
  });
});

describe('jobs config', () => {
  it('defaults CRON_MODE to internal', () => {
    expect(parseCronMode(undefined)).toBe('internal');
    expect(parseCronMode('EXTERNAL')).toBe('external');
    expect(
      buildJobsConfig({ JOBS_TRIGGER_SECRET: ' s ' } as NodeJS.ProcessEnv),
    ).toEqual({
      cronMode: 'internal',
      triggerSecret: 's',
    });
  });

  const env = {
    DATABASE_URL: 'postgres://x',
    JWT_ACCESS_TOKEN_SECRET: 'a',
    JWT_REFRESH_TOKEN_SECRET: 'b',
  };

  it('validates CRON_MODE and JOBS_TRIGGER_SECRET', () => {
    expect(() =>
      validateEnv({
        ...env,
        CRON_MODE: 'external',
        JOBS_TRIGGER_SECRET: 'x'.repeat(48),
      }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ ...env, JOBS_TRIGGER_SECRET: '' }),
    ).not.toThrow();
    expect(() => validateEnv({ ...env, CRON_MODE: 'sometimes' })).toThrow(
      /CRON_MODE/,
    );
    expect(() => validateEnv({ ...env, JOBS_TRIGGER_SECRET: 'short' })).toThrow(
      /JOBS_TRIGGER_SECRET/,
    );
  });
});
