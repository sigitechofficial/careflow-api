import 'reflect-metadata';
import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { JobsTriggerController } from './jobs-trigger.controller';
import { JobsTriggerSecretGuard, secretsMatch } from './jobs-trigger.guard';
import type { JobRunner } from './job-runner.service';

function guardFor(secret: string | undefined) {
  const config = {
    get: (k: string) => (k === 'jobs.triggerSecret' ? secret : undefined),
  } as unknown as ConfigService;
  return new JobsTriggerSecretGuard(config);
}

function ctxWith(
  headers: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('JobsTriggerSecretGuard', () => {
  it('answers 503 when JOBS_TRIGGER_SECRET is not set', () => {
    expect(() =>
      guardFor(undefined).canActivate(
        ctxWith({ 'x-jobs-trigger-secret': 'anything' }),
      ),
    ).toThrow(ServiceUnavailableException);
    expect(() => guardFor('  ').canActivate(ctxWith({}))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('answers 401 for a missing or wrong header', () => {
    const guard = guardFor('local-test-secret');
    expect(() => guard.canActivate(ctxWith({}))).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(ctxWith({ 'x-jobs-trigger-secret': 'wrong' })),
    ).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(
        ctxWith({ 'x-jobs-trigger-secret': 'local-test-secreT' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('allows the right secret', () => {
    expect(
      guardFor('local-test-secret').canActivate(
        ctxWith({ 'x-jobs-trigger-secret': 'local-test-secret' }),
      ),
    ).toBe(true);
  });

  it('compares in constant time over equal-length digests', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abcd')).toBe(false);
    expect(secretsMatch('', 'abc')).toBe(false);
  });
});

describe('JobsTriggerController', () => {
  const result = {
    name: 'late-visit-alert',
    outcome: 'ran',
    runId: 'r1',
    periodKey: '2026-10-02T10:05Z',
    status: 'success',
    durationMs: 12,
    summary: { alerted: 1 },
    error: null,
  };

  function make() {
    const runner = {
      runByName: jest.fn().mockResolvedValue(result),
    } as unknown as JobRunner & {
      runByName: jest.Mock;
    };
    return { runner, controller: new JobsTriggerController(runner) };
  }

  it('is public (no JWT), guarded by the shared secret and not throttled', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, JobsTriggerController)).toBe(
      true,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, JobsTriggerController)).toEqual(
      [JobsTriggerSecretGuard],
    );
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', JobsTriggerController),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        'swagger/apiExcludeController',
        JobsTriggerController,
      ),
    ).toEqual([true]);
  });

  it('runs function jobs with source function and returns the contract shape', async () => {
    const { runner, controller } = make();
    const res = await controller.trigger('late-visit-alert', {
      periodKey: undefined,
    });
    expect(runner.runByName).toHaveBeenCalledWith('late-visit-alert', {
      source: 'function',
      periodKey: undefined,
    });
    expect(res).toMatchObject({
      success: true,
      name: 'late-visit-alert',
      outcome: 'ran',
      runId: 'r1',
      status: 'success',
      durationMs: 12,
      summary: { alerted: 1 },
    });
  });

  it('passes an explicit period key through', async () => {
    const { runner, controller } = make();
    await controller.trigger('survey-distribution', {
      periodKey: '2026-10-02T10:05Z',
    });
    expect(runner.runByName).toHaveBeenCalledWith('survey-distribution', {
      source: 'function',
      periodKey: '2026-10-02T10:05Z',
    });
  });

  it('reports failed runs with HTTP 200 and success=false', async () => {
    const { runner, controller } = make();
    runner.runByName.mockResolvedValueOnce({
      ...result,
      outcome: 'failed',
      status: 'failed',
      error: 'boom',
    });
    await expect(controller.trigger('late-visit-alert')).resolves.toMatchObject(
      {
        success: false,
        outcome: 'failed',
        error: 'boom',
      },
    );
  });

  it('404s unknown jobs and 400s container-only jobs', async () => {
    const { runner, controller } = make();
    await expect(controller.trigger('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.trigger('rolling-rota')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.trigger('learning-maintenance'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runner.runByName).not.toHaveBeenCalled();
  });
});
