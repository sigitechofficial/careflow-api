/**
 * HTTP-level harness for the payroll integration tests.
 *
 * Boots the real application module (controllers, guards, validation pipe, exception filter,
 * services) against the isolated payroll test database, and signs real access tokens for synthetic
 * staff users and carers, so a request goes through the same authentication and permission checks
 * as in the running application.
 *
 * What is replaced: the database (test database only), carer push notifications (no network call),
 * and scheduled jobs (stopped, so they cannot change test rows half-way through a test).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CarerVisitPushHook } from '../../src/notifications/carer-visit-push.hook';
import { createTestPrisma, uuid } from './harness';

export type TestApp = {
  app: INestApplication;
  prisma: PrismaService;
  staffToken: (userId: string) => string;
  carerToken: (accountId: string) => string;
  close: () => Promise<void>;
};

export async function createTestApp(): Promise<TestApp> {
  const prisma = createTestPrisma();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(CarerVisitPushHook)
    .useValue({ notify: () => undefined })
    .compile();

  const app = moduleRef.createNestApplication();
  // Same request handling as src/main.ts.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();

  // No scheduled job may run during a test.
  const scheduler = app.get(SchedulerRegistry, { strict: false });
  for (const job of scheduler.getCronJobs().values()) job.stop();
  for (const name of scheduler.getIntervals()) scheduler.deleteInterval(name);

  const jwt = app.get(JwtService, { strict: false });
  const secret = app.get(ConfigService, { strict: false }).get<string>('JWT_ACCESS_TOKEN_SECRET') as string;
  const sign = (payload: Record<string, unknown>) => jwt.sign(payload, { secret, expiresIn: '15m' });

  return {
    app,
    prisma,
    staffToken: (userId) => sign({ sub: userId }),
    carerToken: (accountId) => sign({ sub: accountId, typ: 'emp' }),
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/** Removes the synthetic identity rows these tests create (users, roles, carer accounts, branches). */
export async function resetIdentityData(prisma: PrismaService) {
  await prisma.userLocation.deleteMany({ where: { user: { email: { endsWith: '@payroll-test.invalid' } } } });
  await prisma.userRole.deleteMany({ where: { user: { email: { endsWith: '@payroll-test.invalid' } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@payroll-test.invalid' } } });
  await prisma.rolePermission.deleteMany({ where: { role: { name: { startsWith: 'TEST ' } } } });
  await prisma.role.deleteMany({ where: { name: { startsWith: 'TEST ' } } });
  await prisma.employeePortalAccount.deleteMany({ where: { email: { endsWith: '@payroll-test.invalid' } } });
}

/**
 * A synthetic office user. `roleName` defaults to a throw-away role; pass 'Super Admin' or 'Admin'
 * to test the built-in roles. `locationIds` are the branches the user is assigned to.
 */
export async function createStaffUser(
  prisma: PrismaService,
  input: { permissions?: string[]; roleName?: string; locationIds?: string[] } = {},
): Promise<{ id: string; email: string }> {
  const tag = uuid().slice(0, 8);
  const roleName = input.roleName ?? `TEST role ${tag}`;
  const role = await prisma.role.upsert({ where: { name: roleName }, update: {}, create: { name: roleName } });
  for (const key of input.permissions ?? []) {
    const permission = await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  const user = await prisma.user.create({
    data: {
      email: `user-${tag}@payroll-test.invalid`,
      passwordHash: 'not-a-usable-hash',
      firstName: 'Test',
      lastName: `User ${tag}`,
      userRoles: { create: [{ roleId: role.id }] },
      userLocations: { create: (input.locationIds ?? []).map((locationId) => ({ locationId })) },
    },
  });
  return { id: user.id, email: user.email };
}

/** A synthetic carer with a carer-app account. Optionally employed at a branch. */
export async function createCarer(
  prisma: PrismaService,
  input: { locationId?: string } = {},
): Promise<{ employeeId: string; accountId: string }> {
  const tag = uuid().slice(0, 8);
  const employee = await prisma.employee.create({ data: {} });
  // Pay card resolution needs an employment record; the branch is optional.
  await prisma.employeeEmployment.create({
    data: { employeeId: employee.id, ...(input.locationId ? { locationId: input.locationId } : {}) } as never,
  });
  const account = await prisma.employeePortalAccount.create({
    data: {
      employeeId: employee.id,
      email: `carer-${tag}@payroll-test.invalid`,
      passwordHash: 'not-a-usable-hash',
      isEnabled: true,
    } as never,
  });
  return { employeeId: employee.id, accountId: account.id };
}

export async function createBranch(prisma: PrismaService, name: string): Promise<string> {
  const branch = await prisma.location.create({ data: { name: `${name} ${uuid().slice(0, 6)}` } });
  return branch.id;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Organisation-default pay card (£14.00 an hour, any day) and charge card, resolved by the real services. */
export async function seedDefaultCards(prisma: PrismaService, hourlyRate = 14) {
  await prisma.payCardRule.deleteMany({ where: { payCard: { code: { startsWith: 'TEST-' } } } });
  await prisma.payCard.deleteMany({ where: { code: { startsWith: 'TEST-' } } });
  await prisma.chargeCardRule.deleteMany({ where: { chargeCard: { code: { startsWith: 'TESTC-' } } } });
  await prisma.chargeCard.deleteMany({ where: { code: { startsWith: 'TESTC-' } } });
  const payCard = await prisma.payCard.create({
    data: {
      name: 'Test organisation pay card',
      code: `TEST-${uuid().slice(0, 8)}`,
      assignmentLevel: 'ORGANISATION_DEFAULT',
      effectiveFrom: new Date('2026-01-01'),
      status: 'ACTIVE',
      rules: { create: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: hourlyRate }] },
    } as never,
  });
  const chargeCard = await prisma.chargeCard.create({
    data: {
      name: 'Test organisation charge card',
      code: `TESTC-${uuid().slice(0, 8)}`,
      assignmentLevel: 'ORGANISATION_DEFAULT',
      effectiveFrom: new Date('2026-01-01'),
      status: 'ACTIVE',
      rules: { create: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: 24 }] },
    } as never,
  });
  return { payCardId: payCard.id, chargeCardId: chargeCard.id };
}

/**
 * A visit that is allocated and not yet started. The first carer is the lead; further carers make
 * it a double-up (or triple) visit.
 */
export async function createAllocatedVisit(
  prisma: PrismaService,
  input: { carers: string[]; start: Date; plannedMinutes?: number; locationId?: string },
) {
  const start = input.start;
  const end = new Date(start.getTime() + (input.plannedMinutes ?? 60) * 60_000);
  const serviceUser = await prisma.serviceUser.create({
    data: { firstName: 'Test', lastName: `Client-${uuid().slice(0, 6)}`, ...(input.locationId ? { locationId: input.locationId } : {}) } as never,
  });
  const batch = await prisma.scheduleBatch.create({ data: { scheduleDate: start } });
  const job = await prisma.scheduledJob.create({
    data: {
      scheduleBatchId: batch.id,
      serviceUserId: serviceUser.id,
      jobName: 'Test visit',
      scheduledStartDateTime: start,
      scheduledEndDateTime: end,
      status: 'ALLOCATED',
      requiredCarers: input.carers.length,
    },
  });
  const visit = await prisma.scheduledVisit.create({
    data: {
      scheduledJobId: job.id,
      serviceUserId: serviceUser.id,
      visitName: 'Test visit',
      scheduledStartDateTime: start,
      scheduledEndDateTime: end,
      requiredCarers: input.carers.length,
    },
  });
  const allocationIds: Record<string, string> = {};
  for (const [index, employeeId] of input.carers.entries()) {
    const allocation = await prisma.jobAllocation.create({
      data: {
        scheduledJobId: job.id,
        scheduledVisitId: visit.id,
        employeeId,
        status: 'ALLOCATED',
        isLeadCarer: index === 0,
        scheduledStartDateTime: start,
        scheduledEndDateTime: end,
      },
    });
    allocationIds[employeeId] = allocation.id;
  }
  return { jobId: job.id, visitId: visit.id, serviceUserId: serviceUser.id, allocationIds, start, end };
}

/** Fakes the clock only (timers, promises and I/O stay real), so server "now" is under test control. */
export function useControlledClock(now: Date | string) {
  jest.useFakeTimers({
    now: new Date(now),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  return { set: (at: Date | string) => jest.setSystemTime(new Date(at)), restore: () => jest.useRealTimers() };
}
