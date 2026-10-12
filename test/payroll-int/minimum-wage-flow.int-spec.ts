/**
 * Gate A sprint — regression check of EL-09 along the whole route: the minimum wage top-up is
 * added once in the draft, approved and locked visit pay run, once in UK payroll gross, once in the
 * carer's totals and once in the export.
 */
import request from 'supertest';
import { PayrollRunLineType } from '@prisma/client';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { nmwHourlyRate } from '../../src/billing/pay-compliance.util';
import { createApprovedVisit, createRun, createUkRun, resetPayData } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('EL-09: one minimum wage top-up from visit pay run to UK payroll', () => {
  let t: TestApp;
  let runs: PayrollRunsService;
  let ukRuns: UkPayrollRunsService;
  let maker: string;
  let checker: string;
  let office: { id: string };
  let carer: { employeeId: string; accountId: string };

  const required = nmwHourlyRate('AGE_21_AND_OVER', new Date('2026-11-07'));
  const topUp = Math.round((required - 5) * 100) / 100;
  const topUpLines = (payrollRunId: string) =>
    t.prisma.payrollRunLine.findMany({ where: { payrollRunId, lineType: PayrollRunLineType.NMW_TOP_UP } });
  const runRow = (id: string) => t.prisma.payrollRun.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  /** Gross, top-up total and the sum of the lines must agree at every stage. */
  const expectOneTopUp = async (run: string) => {
    const row = await runRow(run);
    const lines = await topUpLines(run);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].amount)).toBe(topUp);
    expect(Number(row.nmwTopUp)).toBe(topUp);
    expect(Number(row.grossPay)).toBe(required);
    expect(Math.round(row.lines.reduce((sum, l) => sum + Number(l.amount), 0) * 100) / 100).toBe(required);
  };

  beforeAll(async () => {
    t = await createTestApp();
    runs = t.app.get(PayrollRunsService);
    ukRuns = t.app.get(UkPayrollRunsService);
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    [maker, checker] = (await Promise.all([1, 2].map(() => createStaffUser(t.prisma, { permissions: [] })))).map((u) => u.id);
    office = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'payroll.scope.organisation'] });
    carer = await createCarer(t.prisma);
    // One hour paid £5.00: below the legal hourly rate, so a top-up is due.
    await createApprovedVisit(t.prisma, { employeeId: carer.employeeId, start: '2026-11-03T09:00:00Z', minutes: 60, amount: 5 });
  });
  afterAll(async () => {
    await t.close();
  });

  it('draft, recalculated, approved and locked run: one top-up line each time', async () => {
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await expectOneTopUp(run);

    await runs.calculate(run); // recalculating a draft must not add a second top-up
    await expectOneTopUp(run);

    await runs.approve(checker, run);
    await expectOneTopUp(run);
    await runs.lock(checker, run);
    await expectOneTopUp(run);

    // The run detail shows the carer's gross once.
    const detail = (await runs.getById(run)).data as { grossPay: string; nmwTopUp: string; carerSummary?: Array<{ grossPay: string }> };
    expect(detail.grossPay).toContain(required.toFixed(2));
    expect(detail.nmwTopUp).toContain(topUp.toFixed(2));
  });

  it('a later run over the same dates does not top the same hour up again', async () => {
    const first = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(first);
    await runs.approve(checker, first);
    await runs.lock(checker, first);

    const second = await createRun(runs, maker, '2026-11-01', '2026-11-14');
    await runs.calculate(second);
    expect(await topUpLines(second)).toHaveLength(0);
    expect(Number((await runRow(second)).grossPay)).toBe(0);
    expect(await t.prisma.payrollRunLine.count({ where: { lineType: PayrollRunLineType.NMW_TOP_UP } })).toBe(1);
  });

  it('UK payroll gross takes the visit pay and the top-up once; a second UK run takes neither', async () => {
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await runs.approve(checker, run);
    await runs.lock(checker, run);

    const november = { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [carer.employeeId], createdById: maker };
    const uk = await createUkRun(t.prisma, november);
    await ukRuns.calculateGross(maker, uk);
    await ukRuns.calculateGross(maker, uk); // again: still once

    const inputs = await t.prisma.ukPayrollInputLine.findMany({ where: { runId: uk } });
    expect(inputs.filter((l) => l.lineType === 'NMW_TOP_UP')).toHaveLength(1);
    expect(inputs.filter((l) => l.lineType === 'VISIT_PAY')).toHaveLength(1);
    expect(Math.round(inputs.reduce((sum, l) => sum + Number(l.amount), 0) * 100) / 100).toBe(required);
    const ukEmployee = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: uk } });
    expect(Number(ukEmployee.totalGross)).toBe(required);

    const other = await createUkRun(t.prisma, november);
    // Everything is already claimed: a second run for the same period finds nothing to collect.
    await expect(ukRuns.calculateGross(maker, other)).rejects.toThrow(/No visit-pay or salary inputs found/);
    expect(await t.prisma.ukPayrollInputLine.count({ where: { runId: other } })).toBe(0);
  });

  it('the export and the carer totals show the top-up once', async () => {
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await runs.approve(checker, run);
    await runs.lock(checker, run);

    const { csv } = await runs.exportAndMark(run, checker);
    const rows = csv.trim().split(/\r?\n/).slice(1);
    // One row for the visit and one for the top-up. The last four columns are visit hours, visit
    // pay, the carer's total hours and the carer's gross: the hour is worked once, gross counted once.
    expect(rows).toHaveLength(2);
    const [visitRow, topUpRow] = rows.map((row) => row.split(',').slice(-4));
    expect(visitRow).toEqual(['1.00', '5.00', '1.00', required.toFixed(2)]);
    expect(topUpRow).toEqual(['0.00', topUp.toFixed(2), '1.00', required.toFixed(2)]);

    const earnings = await request(t.app.getHttpServer())
      .get(`/billing/payroll-runs/employee/${carer.employeeId}/earnings`)
      .set(bearer(t.staffToken(office.id)));
    expect(earnings.status).toBe(200);
    expect(earnings.body.data).toMatchObject({ totalEarnedAmount: required, paidVisitCount: 1 });
  });
});
