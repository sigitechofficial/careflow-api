/**
 * Gate C1 — PAYE through the UK payroll run: cumulative tax, refunds, Week 1 / Month 1, the tax
 * year and the year-to-date ledger.
 *
 * Synthetic employee on code 1257L, paid monthly in tax year 2026-27, with figures worked by
 * HMRC's method (Pay Adjustment Tables A: £1,048.26 free pay a month for code 1257; taxable pay to
 * date rounded down to the pound; 20% basic rate). The calculation itself is tested against HMRC's
 * printed examples in src/payroll/payroll-statutory.util.spec.ts.
 */
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createUkRun, giveTaxCode, resetPayData } from './harness';
import { createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('PAYE through the UK payroll run (Gate C1)', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let maker: { id: string };
  let checker: { id: string };
  let employeeId: string;

  const APRIL = { periodStart: '2026-04-01', periodEnd: '2026-04-30' }; // tax month 1
  const MAY = { periodStart: '2026-05-01', periodEnd: '2026-05-31' }; // tax month 2
  const agree = (annualSalary: number, over: Record<string, unknown> = {}) =>
    t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-04-01'),
        annualSalary,
        contractedHours: 5, // well above the minimum wage at either salary
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        approvedAt: new Date('2026-03-20T09:00:00Z'),
        ...over,
      } as never,
    });
  const run = (period: { periodStart: string; periodEnd: string }) => createUkRun(t.prisma, { ...period, employeeIds: [employeeId], createdById: maker.id });
  const taxAndNi = async (runId: string) => {
    await ukRuns.calculateGross(maker.id, runId);
    await ukRuns.calculateStatutory(maker.id, runId);
    const row = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
    return {
      gross: Number(row.totalGross),
      taxablePay: Number(row.taxablePay),
      incomeTax: Number(row.incomeTax),
      employeeNi: Number(row.employeeNi),
      netPay: Number(row.netPay),
      taxCodeApplied: row.taxCodeApplied,
    };
  };
  const ledger = () => t.prisma.employeePayrollYtdLedger.findFirst({ where: { employeeId } });

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = buildUkPayrollRunsService(t.prisma).service;
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    await t.prisma.employeePayrollYtdContribution.deleteMany();
    await t.prisma.employeePayrollYtdLedger.deleteMany();
    maker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.manage', 'payroll.scope.organisation'] });
    checker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.close', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
    await giveTaxCode(t.prisma, [employeeId], '1257L');
  });
  afterAll(async () => {
    await t.close();
  });

  it('cumulative tax, a refund when pay falls, net pay, and a year-to-date ledger posted once per closed run', async () => {
    const original = await agree(36_000); // £3,000.00 a month
    const april = await run(APRIL);
    // £3,000 − £1,048.26 = £1,951.74, taxable £1,951, tax £390.20; NI (3,000 − 1,048) × 8% = £156.16.
    expect(await taxAndNi(april)).toEqual({ gross: 3000, taxablePay: 1951, incomeTax: 390.2, employeeNi: 156.16, netPay: 2453.64, taxCodeApplied: '1257L' });
    await ukRuns.close(checker.id, april);
    expect(await ledger()).toMatchObject({ grossPayYtd: expect.anything() });
    expect(Number((await ledger())!.incomeTaxYtd)).toBe(390.2);

    // From May the salary is £6,000 a year (£500 a month). To date £3,500 − £2,096.52 = £1,403.48,
    // taxable £1,403, tax due £280.60: £109.60 is refunded, and £500 is below the NI threshold.
    await t.prisma.employeePayAgreement.update({ where: { id: original.id }, data: { status: 'SUPERSEDED' } });
    await agree(6_000, { effectiveFrom: new Date('2026-05-01'), approvedAt: new Date('2026-04-20T09:00:00Z') });
    const may = await run(MAY);
    const first = await taxAndNi(may);
    expect(first).toMatchObject({ gross: 500, incomeTax: -109.6, employeeNi: 0, netPay: 609.6 });
    // Calculated again: the same figures, nothing added twice, and nothing posted before closing.
    expect(await taxAndNi(may)).toEqual(first);
    expect(Number((await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: may } })).totalIncomeTax)).toBe(-109.6);
    expect(Number((await ledger())!.incomeTaxYtd)).toBe(390.2);
    await ukRuns.close(checker.id, may);
    const after = (await ledger())!;
    expect([Number(after.grossPayYtd), Number(after.incomeTaxYtd)]).toEqual([3500, 280.6]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(2);

    // Closed history stays as it was, and cannot be recalculated.
    const aprilRow = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: april, employeeId } });
    expect([Number(aprilRow.incomeTax), Number(aprilRow.netPay)]).toEqual([390.2, 2453.64]);
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Reactivate this closed run/);
  });

  it('Week 1 / Month 1: the same fall in pay gives no refund', async () => {
    const original = await agree(36_000);
    const april = await run(APRIL);
    await taxAndNi(april);
    await ukRuns.close(checker.id, april);
    await t.prisma.employeePayAgreement.update({ where: { id: original.id }, data: { status: 'SUPERSEDED' } });
    await agree(6_000, { effectiveFrom: new Date('2026-05-01'), approvedAt: new Date('2026-04-20T09:00:00Z') });
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCodeWeek1Month1: true } });
    const may = await run(MAY);
    // £500 alone against £1,048.26 of free pay: no tax, and April's tax is not looked at.
    expect(await taxAndNi(may)).toMatchObject({ gross: 500, incomeTax: 0, netPay: 500 });
  });

  it('Gate C2: a K code limited to 50% of pay; the rest is collected later where it can be, and the ledger holds what was deducted', async () => {
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'K1500' } });
    await agree(4_800); // £400.00 a month
    const april = await run(APRIL);
    // £400 + £1,250.76 additional pay → £1,650, tax due £330.00, deducted £200.00 (50% of £400).
    expect(await taxAndNi(april)).toMatchObject({ gross: 400, incomeTax: 200, employeeNi: 0, netPay: 200, taxCodeApplied: 'K1500' });
    const explained = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: april, employeeId } });
    expect(explained.statutoryExplanation).toMatch(/Regulatory limit: tax due this period £330\.00 .* £130\.00 not deducted/);
    await ukRuns.close(checker.id, april);
    expect(Number((await ledger())!.incomeTaxYtd)).toBe(200);

    // May: to date £800 + £2,501.52 → £3,301, due £660.20 less £200.00 = £460.20; deducted £200.00 again.
    const may = await run(MAY);
    const first = await taxAndNi(may);
    expect(first).toMatchObject({ gross: 400, incomeTax: 200, netPay: 200 });
    expect(await taxAndNi(may)).toEqual(first); // calculated again: nothing added twice
    await ukRuns.close(checker.id, may);
    expect(Number((await ledger())!.incomeTaxYtd)).toBe(400);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(2);
  });

  it('Gate C3: S1257L is taxed on the 2026-27 Scottish bands through to net pay and the year-to-date ledger', async () => {
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'S1257L' } });
    await agree(36_000); // £3,000.00 a month
    const april = await run(APRIL);
    // Taxable £1,951: £62.81 at 19% + £216.48 at 20% (to £1,413) + 21% of £538 = £392.27 (England: £390.20).
    expect(await taxAndNi(april)).toEqual({ gross: 3000, taxablePay: 1951, incomeTax: 392.27, employeeNi: 156.16, netPay: 2451.57, taxCodeApplied: 'S1257L' });
    const row = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: april, employeeId } });
    expect(row.statutoryExplanation).toContain('Scottish income tax bands applied');
    await ukRuns.close(checker.id, april);
    expect(Number((await ledger())!.incomeTaxYtd)).toBe(392.27);

    // May, cumulative: taxable to date £3,903, due £784.75 less £392.27 = £392.48.
    const may = await run(MAY);
    const first = await taxAndNi(may);
    expect(first).toMatchObject({ gross: 3000, incomeTax: 392.48, netPay: 2451.36 });
    expect(await taxAndNi(may)).toEqual(first); // calculated again: nothing added twice
    await ukRuns.close(checker.id, may);
    const after = (await ledger())!;
    expect([Number(after.grossPayYtd), Number(after.incomeTaxYtd)]).toEqual([6000, 784.75]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(2);
  });

  it('Gate C4: CK475 and SK475 through the UK run: tax, net pay and the year-to-date ledger', async () => {
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'CK475' } });
    await agree(24_000); // £2,000.00 a month
    const april = await run(APRIL);
    // CK475: £2,000 + £396.59 → £2,396 at 20% = £479.20; NI (2,000 − 1,048) × 8% = £76.16.
    expect(await taxAndNi(april)).toEqual({ gross: 2000, taxablePay: 2396, incomeTax: 479.2, employeeNi: 76.16, netPay: 1444.64, taxCodeApplied: 'CK475' });

    // The code is corrected to SK475 before closing: recalculated on the Scottish bands, £485.72.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'SK475' } });
    expect(await taxAndNi(april)).toEqual({ gross: 2000, taxablePay: 2396, incomeTax: 485.72, employeeNi: 76.16, netPay: 1438.12, taxCodeApplied: 'SK475' });
    await ukRuns.close(checker.id, april);
    expect(Number((await ledger())!.incomeTaxYtd)).toBe(485.72);

    // May, cumulative: due to date £971.65 less £485.72 = £485.93.
    const may = await run(MAY);
    const first = await taxAndNi(may);
    expect(first).toMatchObject({ gross: 2000, incomeTax: 485.93, netPay: 1437.91 });
    expect(await taxAndNi(may)).toEqual(first);
    await ukRuns.close(checker.id, may);
    const after = (await ledger())!;
    expect([Number(after.grossPayYtd), Number(after.incomeTaxYtd)]).toEqual([4000, 971.65]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(2);
  });

  it('Gate C5: C1257L on the Welsh bands, then SD1 at 42% cumulative: tax, net pay and the year-to-date ledger', async () => {
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'C1257L' } });
    await agree(24_000); // £2,000.00 a month
    const april = await run(APRIL);
    // C1257L: £2,000 − £1,048.26 → £951 at 20% = £190.20; NI (2,000 − 1,048) × 8% = £76.16.
    expect(await taxAndNi(april)).toEqual({ gross: 2000, taxablePay: 951, incomeTax: 190.2, employeeNi: 76.16, netPay: 1733.64, taxCodeApplied: 'C1257L' });
    expect((await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: april, employeeId } })).statutoryExplanation).toContain('Welsh income tax bands applied');

    // Corrected to SD1 before closing: 42% of all pay, £840.00.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'SD1' } });
    expect(await taxAndNi(april)).toEqual({ gross: 2000, taxablePay: 2000, incomeTax: 840, employeeNi: 76.16, netPay: 1083.84, taxCodeApplied: 'SD1' });
    await ukRuns.close(checker.id, april);
    expect(Number((await ledger())!.incomeTaxYtd)).toBe(840);

    // May, cumulative: £4,000 × 42% = £1,680 less £840 = £840.
    const may = await run(MAY);
    const first = await taxAndNi(may);
    expect(first).toMatchObject({ gross: 2000, incomeTax: 840, netPay: 1083.84 });
    expect(await taxAndNi(may)).toEqual(first);
    await ukRuns.close(checker.id, may);
    const after = (await ledger())!;
    expect([Number(after.grossPayYtd), Number(after.incomeTaxYtd)]).toEqual([4000, 1680]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(2);
  });

  it('Gate C6: employee NI reduces net pay, employer NI is recorded separately, nothing doubles, and a supplementary run pays NI on the period total', async () => {
    const employerSide = async (runId: string) => {
      const row = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
      const r = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: runId } });
      return {
        employerNi: Number(row.employerNi),
        niCategoryApplied: row.niCategoryApplied,
        runTotals: [Number(r.totalEmployeeNi), Number(r.totalEmployerNi), Number(r.totalNetPay)],
      };
    };
    await agree(36_000); // £3,000.00 a month
    const april = await run(APRIL);
    // £156.16 employee NI is deducted; £387.45 employer NI is the employer's cost, not taken from pay.
    expect(await taxAndNi(april)).toMatchObject({ gross: 3000, incomeTax: 390.2, employeeNi: 156.16, netPay: 2453.64 });
    expect(await employerSide(april)).toEqual({ employerNi: 387.45, niCategoryApplied: 'A', runTotals: [156.16, 387.45, 2453.64] });
    // Calculated again: the same figures, run totals not added twice.
    await taxAndNi(april);
    expect(await employerSide(april)).toEqual({ employerNi: 387.45, niCategoryApplied: 'A', runTotals: [156.16, 387.45, 2453.64] });
    // Category M recorded instead: no employer NI below the upper secondary threshold.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { niCategory: 'M' } });
    expect(await taxAndNi(april)).toMatchObject({ employeeNi: 156.16, netPay: 2453.64 });
    expect(await employerSide(april)).toEqual({ employerNi: 0, niCategoryApplied: 'M', runTotals: [156.16, 0, 2453.64] });
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { niCategory: 'A' } });
    await taxAndNi(april);
    await ukRuns.close(checker.id, april);
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Reactivate this closed run/);

    // A supplementary run in the same earnings period pays £1,000 more: NI on the £4,000 total
    // (£236.16 / £537.45) less April's (£156.16 / £387.45); tax cumulative: £590.20 less £390.20.
    const closed = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: april } });
    const supplementary = await t.prisma.ukPayrollRun.create({
      data: {
        periodId: closed.periodId,
        taxYearId: closed.taxYearId,
        scheduleId: closed.scheduleId,
        runNumber: 2,
        label: 'Test supplementary run',
        status: 'GROSS_CALCULATED',
        grossCalculatedAt: new Date(),
        employeeCount: 1,
        createdById: maker.id,
        employees: { create: [{ employeeId, totalGross: 1000, grossCalculatedAt: new Date() }] },
      },
    });
    await ukRuns.calculateStatutory(maker.id, supplementary.id);
    const row = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: supplementary.id, employeeId } });
    expect([Number(row.incomeTax), Number(row.employeeNi), Number(row.employerNi), Number(row.netPay)]).toEqual([200, 80, 150, 720]);
    // The closed April run is untouched.
    expect(await employerSide(april)).toEqual({ employerNi: 387.45, niCategoryApplied: 'A', runTotals: [156.16, 387.45, 2453.64] });
  });

  it('Gate C7: a director appointed in May — April stays ordinary NI; from May NI is on the pro rata annual period, cumulative', async () => {
    const JUNE = { periodStart: '2026-06-01', periodEnd: '2026-06-30' }; // tax month 3
    const row = async (runId: string) => {
      const r = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
      return [Number(r.incomeTax), Number(r.employeeNi), Number(r.employerNi), Number(r.netPay), r.directorNicMethodApplied];
    };
    await agree(36_000); // £3,000.00 a month
    // April, as an employee: ordinary monthly NI, £156.16 / £387.45.
    const april = await run(APRIL);
    await taxAndNi(april);
    expect(await row(april)).toEqual([390.2, 156.16, 387.45, 2453.64, null]);
    await ukRuns.close(checker.id, april);

    // Appointed director on 10 May 2026 (tax week 5: 48 weeks, PT £11,604, ST £4,616, CA44).
    await t.prisma.employeePayrollProfile.update({
      where: { employeeId },
      data: { isDirector: true, directorAppointedOn: new Date('2026-05-10'), directorNicMethod: 'AN' },
    });
    // May: £3,000 since appointment, below both: no NI. April's pay and NI are not in the director's period.
    const may = await run(MAY);
    await taxAndNi(may);
    expect(await row(may)).toEqual([390.4, 0, 0, 2609.6, 'AN']);
    await taxAndNi(may); // calculated again: nothing added twice
    expect(await row(may)).toEqual([390.4, 0, 0, 2609.6, 'AN']);
    await ukRuns.close(checker.id, may);

    // June: £6,000 since appointment: employer (6,000 − 4,616) × 15% = £207.60, not deducted from pay.
    const june = await run(JUNE);
    await taxAndNi(june);
    expect(await row(june)).toEqual([390.4, 0, 207.6, 2609.6, 'AN']);
    await ukRuns.close(checker.id, june);
    await expect(ukRuns.calculateStatutory(maker.id, june)).rejects.toThrow(/Reactivate this closed run/);
    expect(await row(april)).toEqual([390.2, 156.16, 387.45, 2453.64, null]); // closed history untouched
  });

  it('nothing is guessed: no tax code, a code not supported yet, or a period outside the tax year stops the calculation', async () => {
    await agree(36_000, { effectiveFrom: new Date('2026-03-01') }); // paid in March too
    const april = await run(APRIL);
    await ukRuns.calculateGross(maker.id, april);

    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: null } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Tax and NI were not calculated for this run\. 1 employee needs attention: .+ — no tax code recorded/);
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'SK0' } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Scottish K code SK0 is not recognised/);
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'SD4' } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Scottish flat-rate code SD4 is not recognised/);
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'K475' } });
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: 'CK0' } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Welsh K code CK0 is not recognised/);
    expect((await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: april, employeeId } })).statutoryCalculatedAt).toBeNull();

    // Gate C6: NI only on a recorded category this version calculates, never assumed to be A.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: '1257L', niCategory: 'B' } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/NI category B \(not calculated by this version\)/);
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { niCategory: null } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/no NI category recorded/);

    // Gate C7: a director needs an appointment date and method AN. A status not recorded is treated
    // as not a director (only carers are managed), so it no longer stops the run.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { niCategory: 'A', isDirector: true } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/director appointment date not recorded/);
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { directorAppointedOn: new Date('2020-01-01') } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/director NI method not recorded \(only the standard annual method AN/);
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { isDirector: false, directorAppointedOn: null } });

    // A period paid on 31 March 2026 belongs to tax year 2025-26, not to this run's 2026-27.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { taxCode: '1257L', niCategory: 'A' } });
    const march = await run({ periodStart: '2026-03-01', periodEnd: '2026-03-31' });
    await ukRuns.calculateGross(maker.id, march);
    await expect(ukRuns.calculateStatutory(maker.id, march)).rejects.toThrow(/paid on 2026-03-31, outside tax year TEST-2026-27/);
  });
});
