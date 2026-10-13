/**
 * Payroll integration test harness.
 *
 * Runs the real services against the isolated local database created by
 * `node scripts/payroll-test-db.mjs` (<dev database name>_payroll_test). Every row is synthetic.
 * The harness refuses any database whose name does not end in `_payroll_test`.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PrismaClient, VisitReconciliationStatus } from '@prisma/client';
import { config } from 'dotenv';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { EmployeePayoutsService } from '../../src/billing/employee-payouts.service';
import { PayItemsService } from '../../src/billing/pay-items.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';

config({ path: join(__dirname, '..', '..', '.env') });

export const TEST_TIMEZONE = 'Europe/London';

/**
 * A visit that falls short of its planned time by no more than the organisation's tolerance is
 * paid for the planned time. The tolerance comes from the organisation settings (late-visit alert,
 * 20 minutes by default, else the global tolerance, 30) and is 15 minutes when no settings row
 * exists. These tests are written for 15 minutes, so the value is pinned on every reset.
 */
export const TEST_DURATION_TOLERANCE_MINUTES = 15;

export async function setDurationTolerance(prisma: PrismaService, minutes: number) {
  // The holiday pay basis is pinned too, so a test that changes it cannot leak into the next.
  const data = { domLateVisitAlertMinutes: minutes, domGlobalToleranceMinutes: minutes, holidayPremiumBasis: 'BOTH' };
  // The application creates this row on first use; create it here so the value is always explicit.
  if (!(await prisma.organisationGeneralSettings.findFirst({ select: { id: true } }))) {
    await prisma.organisationGeneralSettings.create({ data: data as never });
    return;
  }
  await prisma.organisationGeneralSettings.updateMany({ data });
}

function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set');
  const url = new URL(base);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Payroll integration tests only run against a local PostgreSQL server');
  }
  const name = url.pathname.replace(/^\//, '').replace(/_payroll_test$/, '');
  url.pathname = `/${name}_payroll_test`;
  return url.toString();
}

export function createTestPrisma(): PrismaService {
  const url = testDatabaseUrl();
  if (!new URL(url).pathname.endsWith('_payroll_test')) {
    throw new Error('Refusing to run payroll integration tests outside the payroll test database');
  }
  return new PrismaClient({ datasources: { db: { url } } }) as unknown as PrismaService;
}

/** Remove all synthetic pay rows. Uses the reset switch the locked-history triggers honour. */
export async function resetPayData(prisma: PrismaService) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('careflow.allow_financial_reset', 'on', true)`);
    // Children first; only the tables these tests write to.
    await tx.employeePayoutLine.deleteMany();
    await tx.employeePayoutBatch.deleteMany();
    await tx.employeePayrollYtdContribution.deleteMany();
    await tx.employeePayrollYtdLedger.deleteMany();
    await tx.ukPayrollInputLine.deleteMany();
    await tx.ukPayrollRunEmployee.deleteMany();
    await tx.ukPayrollRun.deleteMany();
    await tx.payrollPeriod.deleteMany();
    await tx.employeePayAgreement.deleteMany();
    await tx.payrollSchedule.deleteMany();
    await tx.payrollRunLine.deleteMany();
    await tx.payrollRun.deleteMany();
    await tx.visitDisruptionPayDecision.deleteMany();
    await tx.visitDisruptionPayRule.deleteMany();
    await tx.travelTimeInterval.deleteMany();
    await tx.employeePayItem.deleteMany();
    await tx.visitAttendanceVerification.deleteMany(); // history entries go with it
    await tx.financeException.deleteMany();
    await tx.visitReconciliation.deleteMany();
  });
  await setDurationTolerance(prisma, TEST_DURATION_TOLERANCE_MINUTES);
}

export const stubOrgSettings = { getOperationalTimezone: async () => TEST_TIMEZONE };
export const stubPayCards = { resolveRulesForEmployeeAt: async () => null };

export type AuditCall = { action: string; recordType?: string; recordId?: string; userId?: string };

/** Records audit calls so tests can assert that money-moving actions are audited. */
export function createAuditSpy() {
  const calls: AuditCall[] = [];
  return {
    calls,
    service: {
      logAudit: async (entry: AuditCall) => {
        calls.push(entry);
      },
    },
  };
}

export function buildPayrollRunsService(prisma: PrismaService, audit = createAuditSpy()) {
  const payouts = {} as unknown as EmployeePayoutsService;
  const service = new (PayrollRunsService as unknown as new (...args: unknown[]) => PayrollRunsService)(
    prisma,
    payouts,
    stubOrgSettings,
    stubPayCards,
    audit.service,
  );
  return { service, audit };
}

export function buildPayItemsService(prisma: PrismaService, audit = createAuditSpy()) {
  const service = new (PayItemsService as unknown as new (...args: unknown[]) => PayItemsService)(
    prisma,
    audit.service,
    stubPayCards,
  );
  return { service, audit };
}

export function buildPayoutsService(prisma: PrismaService, audit = createAuditSpy()) {
  const service = new (EmployeePayoutsService as unknown as new (...args: unknown[]) => EmployeePayoutsService)(
    prisma,
    stubOrgSettings,
    audit.service,
  );
  return { service, audit };
}

/** A UK run with net pay per employee, in the given status (CLOSED = final figures). */
export async function createUkRunWithNetPay(
  prisma: PrismaService,
  input: { periodStart: string; periodEnd: string; netPay: Record<string, number>; status: 'STATUTORY_CALCULATED' | 'CLOSED' },
) {
  const runId = await createUkRun(prisma, {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    employeeIds: Object.keys(input.netPay),
  });
  for (const [employeeId, netPay] of Object.entries(input.netPay)) {
    await prisma.ukPayrollRunEmployee.updateMany({ where: { runId, employeeId }, data: { netPay, totalGross: netPay } });
  }
  const total = Object.values(input.netPay).reduce((a, b) => a + b, 0);
  await prisma.ukPayrollRun.update({
    where: { id: runId },
    data: {
      status: input.status,
      statutoryCalculatedAt: new Date(),
      totalNetPay: total,
      closedAt: input.status === 'CLOSED' ? new Date() : null,
    },
  });
  return runId;
}

export const uuid = () => randomUUID();

/** An approved, priced visit for one carer (one reconciliation row = one carer on one visit). */
export async function createApprovedVisit(
  prisma: PrismaService,
  input: {
    employeeId: string;
    start: string;
    minutes?: number;
    amount?: number;
    scheduledVisitId?: string;
    jobAllocationId?: string;
    status?: VisitReconciliationStatus;
  },
) {
  const start = new Date(input.start);
  const minutes = input.minutes ?? 60;
  const end = new Date(start.getTime() + minutes * 60_000);
  return prisma.visitReconciliation.create({
    data: {
      scheduledVisitId: input.scheduledVisitId ?? uuid(),
      scheduledJobId: uuid(),
      serviceUserId: uuid(),
      employeeId: input.employeeId,
      jobAllocationId: input.jobAllocationId ?? uuid(),
      visitRef: `VIS-TST-${start.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 9000 + 1000)}`,
      plannedStartDateTime: start,
      plannedEndDateTime: end,
      actualStartDateTime: start,
      actualEndDateTime: end,
      approvedPayStart: start,
      approvedPayEnd: end,
      payableMinutes: minutes,
      payableAmount: input.amount ?? 14,
      status: input.status ?? VisitReconciliationStatus.APPROVED_FOR_BOTH,
    },
  });
}

export async function createRun(
  service: PayrollRunsService,
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<string> {
  const res = (await service.create(userId, { periodStart, periodEnd } as never)) as { data: { id: string } };
  return res.data.id;
}

export function buildUkPayrollRunsService(prisma: PrismaService, audit = createAuditSpy()) {
  const service = new (UkPayrollRunsService as unknown as new (...args: unknown[]) => UkPayrollRunsService)(
    prisma,
    audit.service,
  );
  return { service, audit };
}

/** A UK payroll run with enrolled employees on its own schedule (so periods may overlap other runs). */
export async function createUkRun(
  prisma: PrismaService,
  input: { periodStart: string; periodEnd: string; employeeIds: string[]; createdById?: string },
) {
  const tag = uuid().slice(0, 8);
  const taxYear =
    (await prisma.payrollTaxYear.findFirst({ where: { code: 'TEST-2026-27' } })) ??
    (await prisma.payrollTaxYear.create({
      data: {
        code: 'TEST-2026-27',
        label: 'Test 2026/27',
        startDate: new Date('2026-04-06'),
        endDate: new Date('2027-04-05'),
      },
    }));
  const schedule = await prisma.payrollSchedule.create({
    data: { name: `Test schedule ${tag}`, code: `TEST-${tag}`, frequency: 'MONTHLY' },
  });
  const period = await prisma.payrollPeriod.create({
    data: {
      scheduleId: schedule.id,
      taxYearId: taxYear.id,
      sequence: 1,
      label: `Test period ${tag}`,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      paymentDate: new Date(input.periodEnd),
    },
  });
  const run = await prisma.ukPayrollRun.create({
    data: {
      periodId: period.id,
      taxYearId: taxYear.id,
      scheduleId: schedule.id,
      runNumber: 1,
      label: `Test run ${tag}`,
      status: 'EMPLOYEES_ENROLLED',
      employeeCount: input.employeeIds.length,
      createdById: input.createdById ?? null,
      employees: { create: input.employeeIds.map((employeeId) => ({ employeeId })) },
    },
  });
  return run.id;
}

/** Stand-in for the tax & NI step: these tests exercise gross collection and closing only. */
export async function markStatutoryCalculated(prisma: PrismaService, runId: string) {
  await prisma.ukPayrollRun.update({
    where: { id: runId },
    data: { status: 'STATUTORY_CALCULATED', statutoryCalculatedAt: new Date() },
  });
}

/** A pay card with one any-day hourly rate, and a reconciliation service that resolves every carer to it. */
export async function buildReconciliationService(
  prisma: PrismaService,
  options: { hourlyRate?: number; audit?: ReturnType<typeof createAuditSpy> } = {},
) {
  const audit = options.audit ?? createAuditSpy();
  const card = await prisma.payCard.create({
    data: {
      name: `Test card ${uuid().slice(0, 8)}`,
      code: `TEST-${uuid().slice(0, 8)}`,
      effectiveFrom: new Date('2026-01-01'),
      status: 'ACTIVE',
      rules: { create: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: options.hourlyRate ?? 14 }] },
    },
    include: { rules: true },
  });
  const payCards = {
    resolveForEmployee: async () => ({ data: { source: 'TEST_CARD', payCard: card } }),
    resolveRulesForEmployeeAt: async () => null,
  };
  const chargeCard = await prisma.chargeCard.create({
    data: {
      name: `Test charge card ${uuid().slice(0, 8)}`,
      code: `TESTC-${uuid().slice(0, 8)}`,
      effectiveFrom: new Date('2026-01-01'),
      status: 'ACTIVE',
      rules: { create: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: 24 }] },
    },
    include: { rules: true },
  });
  const chargeCards = {
    resolveForServiceUser: async () => ({ data: { source: 'TEST_CARD', chargeCard } }),
  };
  const payItems = buildPayItemsService(prisma, audit).service;
  const service = new (VisitReconciliationsService as unknown as new (
    ...args: unknown[]
  ) => VisitReconciliationsService)(prisma, payCards, chargeCards, stubOrgSettings, audit.service, payItems);
  return { service, audit, card, chargeCard, payItems };
}

/**
 * A completed visit with real scheduling rows (service user, job, visit, allocation), so the
 * reconciliation service can create and price it exactly as it does in the application.
 */
export async function createCompletedVisit(
  prisma: PrismaService,
  input: { start: string; plannedMinutes?: number; actualMinutes?: number; employeeId?: string },
) {
  const start = new Date(input.start);
  const plannedEnd = new Date(start.getTime() + (input.plannedMinutes ?? 60) * 60_000);
  const actualEnd = new Date(start.getTime() + (input.actualMinutes ?? input.plannedMinutes ?? 60) * 60_000);
  const employeeId = input.employeeId ?? (await prisma.employee.create({ data: {} })).id;
  const serviceUser = await prisma.serviceUser.create({ data: { firstName: 'Test', lastName: `Client-${uuid().slice(0, 6)}` } });
  const batch = await prisma.scheduleBatch.create({ data: { scheduleDate: start } });
  const job = await prisma.scheduledJob.create({
    data: {
      scheduleBatchId: batch.id,
      serviceUserId: serviceUser.id,
      jobName: 'Test visit',
      scheduledStartDateTime: start,
      scheduledEndDateTime: plannedEnd,
      status: 'COMPLETED',
    },
  });
  const visit = await prisma.scheduledVisit.create({
    data: {
      scheduledJobId: job.id,
      serviceUserId: serviceUser.id,
      visitName: 'Test visit',
      scheduledStartDateTime: start,
      scheduledEndDateTime: plannedEnd,
      actualStartDateTime: start,
      actualEndDateTime: actualEnd,
      status: 'COMPLETED',
    },
  });
  const allocation = await prisma.jobAllocation.create({
    data: {
      scheduledJobId: job.id,
      scheduledVisitId: visit.id,
      employeeId,
      status: 'ALLOCATED',
      scheduledStartDateTime: start,
      scheduledEndDateTime: plannedEnd,
      actualStartDateTime: start,
      actualEndDateTime: actualEnd,
    },
  });
  return { employeeId, serviceUserId: serviceUser.id, jobId: job.id, visitId: visit.id, allocationId: allocation.id };
}

export type { PayItemsService, VisitReconciliationsService };
