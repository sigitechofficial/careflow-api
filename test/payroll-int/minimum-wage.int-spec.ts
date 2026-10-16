/**
 * Phase 4.1 — the minimum wage top-up is counted once in the run total.
 * Audit ID: EL-09.
 */
import { PayrollRunLineType } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { nmwHourlyRate } from '../../src/billing/pay-compliance.util';
import { buildPayrollRunsService, createApprovedVisit, createRun, createTestPrisma, resetPayData, uuid } from './harness';

describe('minimum wage top-up in the visit pay run', () => {
  let prisma: PrismaService;
  let runs: PayrollRunsService;
  const maker = uuid();

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    runs = buildPayrollRunsService(prisma).service;
  });
  beforeEach(() => resetPayData(prisma));
  afterAll(() => prisma.$disconnect());

  it('EL-09: run gross = pay lines + one top-up, not two', async () => {
    // One hour paid £5.00: below the adult rate, so a top-up to the legal hourly rate is due.
    await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z', minutes: 60, amount: 5 });
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);

    const required = nmwHourlyRate('AGE_21_AND_OVER', new Date('2026-11-07'));
    const topUp = Math.round((required - 5) * 100) / 100;
    const lines = await prisma.payrollRunLine.findMany({ where: { payrollRunId: run } });
    const topUpLines = lines.filter((l) => l.lineType === PayrollRunLineType.NMW_TOP_UP);
    expect(topUpLines).toHaveLength(1);
    expect(Number(topUpLines[0].amount)).toBe(topUp);

    const row = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });
    const sumOfLines = lines.reduce((sum, l) => sum + Number(l.amount), 0);
    expect(Number(row.nmwTopUp)).toBe(topUp);
    expect(Number(row.grossPay)).toBe(Math.round(sumOfLines * 100) / 100);
    expect(Number(row.grossPay)).toBe(required);
  });

  it('a visit paid at or above the legal rate gets no top-up and gross is the visit pay', async () => {
    await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z', minutes: 60, amount: 14 });
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);

    const row = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });
    expect(Number(row.nmwTopUp)).toBe(0);
    expect(Number(row.grossPay)).toBe(14);
  });
});
