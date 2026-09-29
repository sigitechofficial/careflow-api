import { ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  const makeController = (reachable: boolean) =>
    new HealthController({
      isDatabaseReachable: () => Promise.resolve(reachable),
    } as HealthService);

  it('live always reports ok', () => {
    expect(makeController(false).live()).toEqual({ status: 'ok' });
  });

  it('ready reports ok when the database answers', async () => {
    await expect(makeController(true).ready()).resolves.toEqual({
      status: 'ok',
    });
  });

  it('ready fails with 503 and no internal detail when the database does not answer', async () => {
    const err = await makeController(false)
      .ready()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getStatus()).toBe(503);
    expect((err as ServiceUnavailableException).message).toBe('unavailable');
  });

  it('has no auth guards (the platform probes anonymously) and skips rate limiting', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, HealthController),
    ).toBeUndefined();
    const skipKeys = Reflect.getMetadataKeys(HealthController).filter((k) =>
      String(k).includes('SKIP'),
    );
    expect(skipKeys.length).toBeGreaterThan(0);
    expect(
      skipKeys.some((k) => Reflect.getMetadata(k, HealthController) === true),
    ).toBe(true);
  });
});

describe('HealthService.isDatabaseReachable', () => {
  const makeService = (queryRaw: () => Promise<unknown>) =>
    new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);

  it('is true when SELECT 1 succeeds', async () => {
    await expect(
      makeService(() =>
        Promise.resolve([{ '?column?': 1 }]),
      ).isDatabaseReachable(),
    ).resolves.toBe(true);
  });

  it('is false when the query fails', async () => {
    await expect(
      makeService(() =>
        Promise.reject(new Error('connection refused')),
      ).isDatabaseReachable(),
    ).resolves.toBe(false);
  });

  it('is false when the query hangs past the timeout', async () => {
    const hang = () => new Promise(() => undefined);
    await expect(makeService(hang).isDatabaseReachable(20)).resolves.toBe(
      false,
    );
  });
});
