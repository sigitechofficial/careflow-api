import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators/permissions.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { PlatformCostsController } from './platform-costs.controller';
import {
  CostBreakdownQueryDto,
  EstimateRequestDto,
  PricesQueryDto,
  UpdatePlatformCostSettingsDto,
} from './dto/platform-costs.dto';
import { normaliseRecipients } from './platform-costs.service';

const READ = 'platform_costs.read';
const MANAGE = 'platform_costs.manage';

const READ_HANDLERS = [
  'overview',
  'breakdown',
  'prices',
  'baseline',
  'estimate',
  'recommendations',
  'unitEconomics',
  'anomalies',
  'getSettings',
  'syncRuns',
] as const;
const MANAGE_HANDLERS = [
  'acknowledge',
  'updateSettings',
  'triggerSync',
  'export',
  'previewReport',
  'sendTestReport',
] as const;

function user(
  permissions: string[],
  roles: string[] = ['Admin'],
  accountKind: RequestUser['accountKind'] = 'user',
): RequestUser {
  return { id: 'u1', email: 'u@test', roles, permissions, accountKind };
}

function canActivate(handlerName: string, u: RequestUser): boolean {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);
  const handler = (
    PlatformCostsController.prototype as unknown as Record<string, () => void>
  )[handlerName];
  const ctx = {
    getHandler: () => handler,
    getClass: () => PlatformCostsController,
    switchToHttp: () => ({ getRequest: () => ({ user: u }) }),
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

describe('PlatformCostsController permissions', () => {
  it('is protected by JWT + permissions guards at class level', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      PlatformCostsController,
    );
    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('declares permissions on every route handler', () => {
    const proto = PlatformCostsController.prototype as unknown as Record<
      string,
      unknown
    >;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== 'constructor',
    );
    expect(new Set(handlers)).toEqual(
      new Set([...READ_HANDLERS, ...MANAGE_HANDLERS]),
    );
    for (const h of READ_HANDLERS) {
      expect(
        Reflect.getMetadata(ANY_PERMISSIONS_KEY, proto[h] as object),
      ).toEqual([READ, MANAGE]);
    }
    for (const h of MANAGE_HANDLERS) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[h] as object)).toEqual([
        MANAGE,
      ]);
    }
  });

  it.each(READ_HANDLERS)('%s: allowed with read, denied without', (h) => {
    expect(canActivate(h, user([READ]))).toBe(true);
    expect(() => canActivate(h, user(['billing.payments.read']))).toThrow(
      ForbiddenException,
    );
  });

  it.each(MANAGE_HANDLERS)(
    '%s: requires manage (read alone is not enough)',
    (h) => {
      expect(canActivate(h, user([MANAGE]))).toBe(true);
      expect(() => canActivate(h, user([READ]))).toThrow(ForbiddenException);
    },
  );

  it('allows Super Admin everywhere and blocks employee/service-user tokens', () => {
    for (const h of [...READ_HANDLERS, ...MANAGE_HANDLERS]) {
      expect(canActivate(h, user([], ['Super Admin']))).toBe(true);
      expect(() =>
        canActivate(h, user([READ, MANAGE], ['Carer'], 'employee')),
      ).toThrow(ForbiddenException);
    }
  });
});

function errors<T extends object>(cls: new () => T, plain: object): string[] {
  const inst = plainToInstance(cls, plain, { enableImplicitConversion: true });
  return validateSync(inst, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('Platform costs DTO validation', () => {
  it('accepts valid settings', () => {
    expect(
      errors(UpdatePlatformCostSettingsDto, {
        anomalyThresholdPercent: 50,
        anomalyMinDailyIncrease: 1.5,
        monthlyReportEnabled: true,
        monthlyReportRecipients: ['finance@example.com'],
      }),
    ).toEqual([]);
  });

  it.each([
    [{ anomalyThresholdPercent: 0 }],
    [{ anomalyThresholdPercent: 2000 }],
    [{ anomalyThresholdPercent: 12.5 }],
    [{ anomalyMinDailyIncrease: -1 }],
    [{ anomalyMinDailyIncrease: 1.234 }],
    [{ monthlyReportRecipients: ['not-an-email'] }],
    [
      {
        monthlyReportRecipients: Array.from(
          { length: 21 },
          (_, i) => `a${i}@x.com`,
        ),
      },
    ],
    [{ unknownField: 1 }],
  ])('rejects invalid settings %j', (payload) => {
    expect(
      errors(UpdatePlatformCostSettingsDto, payload).length,
    ).toBeGreaterThan(0);
  });

  it('normalises recipients', () => {
    expect(normaliseRecipients([' A@x.com', 'a@x.com', 'b@x.com '])).toEqual([
      'a@x.com',
      'b@x.com',
    ]);
  });

  it('validates breakdown query values', () => {
    expect(
      errors(CostBreakdownQueryDto, {
        from: '2026-09-01',
        to: '2026-09-30',
        groupBy: 'resource',
      }),
    ).toEqual([]);
    expect(
      errors(CostBreakdownQueryDto, { from: '2026-13-01' }).length,
    ).toBeGreaterThan(0);
    expect(
      errors(CostBreakdownQueryDto, { groupBy: 'tag' }).length,
    ).toBeGreaterThan(0);
  });

  it('parses usedOnly=false as false (not truthy)', () => {
    const q = plainToInstance(
      PricesQueryDto,
      { usedOnly: 'false' },
      { enableImplicitConversion: true },
    );
    expect(q.usedOnly).toBe(false);
    expect(
      errors(PricesQueryDto, { usedOnly: 'maybe' }).length,
    ).toBeGreaterThan(0);
  });

  it('validates what-if inputs', () => {
    expect(
      errors(EstimateRequestDto, {
        apiReplicas: 2,
        dbSku: 'D2ds_v5',
        dbHighAvailability: true,
      }),
    ).toEqual([]);
    expect(
      errors(EstimateRequestDto, { dbSku: 'B4ms' }).length,
    ).toBeGreaterThan(0);
    expect(
      errors(EstimateRequestDto, { dbStorageGiB: 10 }).length,
    ).toBeGreaterThan(0);
    expect(
      errors(EstimateRequestDto, { apiReplicas: 1.5 }).length,
    ).toBeGreaterThan(0);
  });
});
