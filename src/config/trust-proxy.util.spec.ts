import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { applyTrustProxy, parseTrustProxyHops } from './trust-proxy.util';

type Probe = { ip: string; auditIp: string | null };

@Controller('ip')
class IpProbeController {
  @Get()
  probe(@Req() req: Request) {
    return { ip: req.ip, auditIp: getRequestAuditMeta(req).ipAddress };
  }
}

async function buildApp(hops: number, limit = 3): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit }] }),
    ],
    controllers: [IpProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  applyTrustProxy(app, hops);
  await app.init();
  return app;
}

describe('parseTrustProxyHops', () => {
  it('defaults to 0 and only accepts positive integers', () => {
    expect(parseTrustProxyHops(undefined)).toBe(0);
    expect(parseTrustProxyHops('')).toBe(0);
    expect(parseTrustProxyHops('0')).toBe(0);
    expect(parseTrustProxyHops('-1')).toBe(0);
    expect(parseTrustProxyHops('abc')).toBe(0);
    expect(parseTrustProxyHops('1.5')).toBe(0);
    expect(parseTrustProxyHops('1')).toBe(1);
    expect(parseTrustProxyHops(2)).toBe(2);
  });
});

describe('trust proxy (TRUST_PROXY_HOPS=1, e.g. Azure Container Apps ingress)', () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await buildApp(1);
  });
  afterEach(async () => {
    await app.close();
  });

  it('uses the right-most X-Forwarded-For entry for req.ip and audit meta', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/ip')
      .set('X-Forwarded-For', '1.1.1.1, 2.2.2.2')
      .expect(200);
    expect(res.body as Probe).toEqual({ ip: '2.2.2.2', auditIp: '2.2.2.2' });
  });

  it('ignores a spoofed left-most entry when throttling', async () => {
    const server = app.getHttpServer() as App;
    for (let i = 0; i < 3; i++) {
      await request(server)
        .get('/ip')
        .set('X-Forwarded-For', `9.9.9.${i}, 2.2.2.2`)
        .expect(200);
    }
    // Same real client (right-most entry) with yet another spoofed prefix: still limited.
    await request(server)
      .get('/ip')
      .set('X-Forwarded-For', '9.9.9.99, 2.2.2.2')
      .expect(429);
  });

  it('keys the limit per real client IP (different right-most entries are independent)', async () => {
    const server = app.getHttpServer() as App;
    for (let i = 0; i < 6; i++) {
      await request(server)
        .get('/ip')
        .set('X-Forwarded-For', `3.3.3.${i}`)
        .expect(200);
    }
  });
});

describe('trust proxy disabled (TRUST_PROXY_HOPS=0, default)', () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await buildApp(0);
  });
  afterEach(async () => {
    await app.close();
  });

  it('ignores X-Forwarded-For entirely (socket address is used)', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/ip')
      .set('X-Forwarded-For', '1.1.1.1, 2.2.2.2')
      .expect(200);
    const body = res.body as Probe;
    expect(body.ip).not.toBe('1.1.1.1');
    expect(body.ip).not.toBe('2.2.2.2');
    expect(body.auditIp).toBe(body.ip);
  });
});
