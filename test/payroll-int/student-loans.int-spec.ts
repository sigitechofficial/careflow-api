/**
 * Gate C11 — student and postgraduate loan deductions through the monthly UK payroll run: net pay,
 * the run row, the YTD ledger, recalculation, supplementary payments and the cases refused.
 *
 * Synthetic employee on 1257L and NI category A, paid £3,000 a month in 2026-27, with Plan 2 and a
 * postgraduate loan recorded (GOV.UK 2026-27 monthly thresholds £2,448.75 and £1,750.00).
 */
import { PayrollEmployeesService } from '../../src/payroll/payroll-employees.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import request from 'supertest';
import { AuditLogsService } from '../../src/audit-logs/audit-logs.service';
import { buildUkPayrollRunsService, createUkRun, giveTaxCode, resetPayData } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('student and postgraduate loans through the UK run (Gate C11)', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let maker: { id: string };
  let checker: { id: string };
  let employeeId: string;

  const APRIL = { periodStart: '2026-04-01', periodEnd: '2026-04-30' };
  const MAY = { periodStart: '2026-05-01', periodEnd: '2026-05-31' };
  const run = (period: { periodStart: string; periodEnd: string }) => createUkRun(t.prisma, { ...period, employeeIds: [employeeId], createdById: maker.id });
  const calculate = async (runId: string) => {
    await ukRuns.calculateGross(maker.id, runId);
    await ukRuns.calculateStatutory(maker.id, runId);
  };
  const row = async (runId: string) => {
    const r = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
    return {
      plan: r.studentLoanPlanApplied,
      studentLoan: Number(r.studentLoanDeduction),
      postgraduate: r.postgraduateLoanApplied,
      postgraduateLoan: Number(r.postgraduateLoanDeduction),
      employerNi: Number(r.employerNi),
      netPay: Number(r.netPay),
    };
  };
  const ledger = () => t.prisma.employeePayrollYtdLedger.findFirstOrThrow({ where: { employeeId } });
  const supplementaryOf = async (runId: string, totalGross: number) => {
    const closed = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: runId } });
    const created = await t.prisma.ukPayrollRun.create({
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
        employees: { create: [{ employeeId, totalGross, grossCalculatedAt: new Date() }] },
      },
    });
    return created.id;
  };

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
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { studentLoanPlan2: true, postgraduateLoan: true } });
    await t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-04-01'),
        annualSalary: 36_000,
        contractedHours: 5,
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        approvedAt: new Date('2026-03-20T09:00:00Z'),
      } as never,
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it('Plan 2 and postgraduate loan: £49 and £75 off net pay, employer NI unchanged, posted to YTD once per closed run', async () => {
    const expected = { plan: '2', studentLoan: 49, postgraduate: true, postgraduateLoan: 75, employerNi: 387.45, netPay: 2329.64 };
    const april = await run(APRIL);
    await calculate(april);
    expect(await row(april)).toEqual(expected);
    await ukRuns.calculateStatutory(maker.id, april); // a draft recalculation: nothing doubled
    expect(await row(april)).toEqual(expected);
    await ukRuns.close(checker.id, april);
    const may = await run(MAY);
    await calculate(may);
    // May's PAYE is cumulative (£390.40), so net pay is £2,329.44; the loans are the same.
    expect(await row(may)).toEqual({ ...expected, netPay: 2329.44 });
    await ukRuns.close(checker.id, may);
    const after = await ledger();
    expect([Number(after.studentLoanYtd), Number(after.postgraduateLoanYtd), Number(after.netPayYtd)]).toEqual([98, 150, 4659.08]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId, studentLoan: 49, postgraduateLoan: 75 } })).toBe(2);
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Reactivate this closed run/);
    expect(await row(april)).toEqual(expected); // closed history unchanged
  });

  it('a supplementary payment applies the monthly threshold once; changed or multiple loan cases are refused', async () => {
    const april = await run(APRIL);
    await calculate(april);
    await ukRuns.close(checker.id, april);
    // £1,000 more in April: on £4,000, £139 and £135 less £49 and £75 = £90 and £60;
    // net £1,000 − £200 tax − £80 NI − £90 − £60 = £570.
    const supplementary = await supplementaryOf(april, 1000);
    await ukRuns.calculateStatutory(maker.id, supplementary);
    expect(await row(supplementary)).toMatchObject({ studentLoan: 90, postgraduateLoan: 60, netPay: 570 });

    // The postgraduate loan stopped since April's payment: the period's figures cannot be kept apart.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { postgraduateLoan: false } });
    await expect(ukRuns.calculateStatutory(maker.id, supplementary)).rejects.toThrow(/loan changed since an earlier payment in this earnings period/);

    // Two plans recorded: the plan HMRC notified has to be recorded, not chosen here.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { postgraduateLoan: true, studentLoanPlan1: true } });
    const may = await run(MAY);
    await ukRuns.calculateGross(maker.id, may);
    await expect(ukRuns.calculateStatutory(maker.id, may)).rejects.toThrow(/more than one student loan plan recorded \(1, 2\)/);
  });

  it('Gate C12: fortnightly pay uses the weekly thresholds on average weekly pay; YTD, recalculation and a supplementary payment', async () => {
    // A fortnightly run for tax weeks 1-2 (6 to 19 April 2026) paying £1,300: £650 a week on average.
    const first = await run({ periodStart: '2026-04-06', periodEnd: '2026-04-19' });
    const created = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: first } });
    await t.prisma.payrollSchedule.update({ where: { id: created.scheduleId }, data: { frequency: 'FORTNIGHTLY' } });
    await t.prisma.ukPayrollRun.update({ where: { id: first }, data: { status: 'GROSS_CALCULATED', grossCalculatedAt: new Date() } });
    await t.prisma.ukPayrollRunEmployee.updateMany({ where: { runId: first }, data: { totalGross: 1300, grossCalculatedAt: new Date() } });
    await ukRuns.calculateStatutory(maker.id, first);
    // Plan 2: £7 a week × 2 = £14; postgraduate: 6% of £246.16 = £14.77 → £14 × 2 = £28.
    const r1 = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: first, employeeId } });
    expect([r1.studentLoanPlanApplied, Number(r1.studentLoanDeduction), Number(r1.postgraduateLoanDeduction)]).toEqual(['2', 14, 28]);
    expect(Number(r1.employeeNi)).toBe(65.28); // NI unchanged: (1,300 − 484) × 8%
    expect(Number(r1.netPay)).toBe(Math.round((1300 - Number(r1.incomeTax) - 65.28 - 14 - 28) * 100) / 100);
    expect(r1.statutoryExplanation).toContain('a week (on average weekly pay over 2 weeks)');
    await ukRuns.calculateStatutory(maker.id, first); // draft recalculation: nothing doubled
    expect(await row(first)).toMatchObject({ studentLoan: 14, postgraduateLoan: 28 });
    await ukRuns.close(checker.id, first);

    // £200 more in the same fortnight: on £1,500 (£750 a week), £16 × 2 = £32 and £20 × 2 = £40,
    // less £14 and £28 already deducted: £18 and £12.
    const supplementary = await supplementaryOf(first, 200);
    await ukRuns.calculateStatutory(maker.id, supplementary);
    expect(await row(supplementary)).toMatchObject({ studentLoan: 18, postgraduateLoan: 12 });
    await ukRuns.close(checker.id, supplementary);
    const after = await ledger();
    expect([Number(after.studentLoanYtd), Number(after.postgraduateLoanYtd)]).toEqual([32, 40]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(2);
  });

  /**
   * Gate C13: HMRC SL1 / SL2 / PGL1 / PGL2 notices, applied from their effective payday by the
   * run's payment date (these runs are paid on the last day of the month). The profile's loan
   * checkboxes are cleared first so that only the notices decide.
   */
  describe('HMRC loan start / stop notices (Gate C13)', () => {
    const JUNE = { periodStart: '2026-06-01', periodEnd: '2026-06-30' };
    const employees = () => t.app.get(PayrollEmployeesService, { strict: false });
    const notice = (body: Record<string, unknown>) => employees().recordLoanNotice(maker.id, employeeId, body as never);
    const closeMonth = async (period: { periodStart: string; periodEnd: string }) => {
      const id = await run(period);
      await calculate(id);
      const r = await row(id);
      await ukRuns.close(checker.id, id);
      return { id, ...r };
    };
    beforeEach(async () => {
      await t.prisma.employeeLoanNotice.deleteMany();
      await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { studentLoanPlan2: false, postgraduateLoan: false } });
    });

    it('SL1 starts Plan 2 on its effective payday and SL2 stops it on its own; net pay follows', async () => {
      await notice({ noticeType: 'SL1', studentLoanPlan: '2', hmrcReference: 'SL1-A', noticeDate: '2026-05-01', receivedOn: '2026-05-12', effectivePayday: '2026-05-31' });
      await notice({ noticeType: 'SL2', hmrcReference: 'SL2-A', noticeDate: '2026-06-05', receivedOn: '2026-06-10', effectivePayday: '2026-06-30' });
      const april = await closeMonth(APRIL); // paid 30 April: before the SL1 payday
      expect(april).toMatchObject({ plan: 'NONE', studentLoan: 0, netPay: 2453.64 });
      const may = await closeMonth(MAY); // 31 May: Plan 2, £49; net 3,000 − 390.40 − 156.16 − 49
      expect(may).toMatchObject({ plan: '2', studentLoan: 49, netPay: 2404.44 });
      expect((await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: may.id, employeeId } })).statutoryExplanation)
        .toContain('HMRC SL1 SL1-A from payday 2026-05-31');
      const june = await closeMonth(JUNE); // 30 June: stopped by SL2
      expect(june).toMatchObject({ plan: 'NONE', studentLoan: 0, netPay: 2453.44 });
      expect(Number((await ledger()).studentLoanYtd)).toBe(49);
    });

    it('postgraduate notices work apart from student loan notices, and a later SL1 changes the plan', async () => {
      await notice({ noticeType: 'SL1', studentLoanPlan: '2', hmrcReference: 'SL1-B', noticeDate: '2026-04-06', receivedOn: '2026-04-20', effectivePayday: '2026-04-30' });
      await notice({ noticeType: 'PGL1', hmrcReference: 'PGL1-B', noticeDate: '2026-05-01', receivedOn: '2026-05-20', effectivePayday: '2026-05-31' });
      await notice({ noticeType: 'SL1', studentLoanPlan: '1', hmrcReference: 'SL1-C', noticeDate: '2026-06-01', receivedOn: '2026-06-15', effectivePayday: '2026-06-30' });
      expect(await closeMonth(APRIL)).toMatchObject({ plan: '2', studentLoan: 49, postgraduate: false, postgraduateLoan: 0 });
      expect(await closeMonth(MAY)).toMatchObject({ plan: '2', studentLoan: 49, postgraduate: true, postgraduateLoan: 75 });
      // June: Plan 1 replaces Plan 2 (£68); the postgraduate loan carries on (£75).
      expect(await closeMonth(JUNE)).toMatchObject({ plan: '1', studentLoan: 68, postgraduate: true, postgraduateLoan: 75 });
      const after = await ledger();
      expect([Number(after.studentLoanYtd), Number(after.postgraduateLoanYtd)]).toEqual([166, 150]);
    });

    it('a repeated notice is kept once with one audit entry; late, mismatched and conflicting notices are refused; closed runs stay as they were', async () => {
      const april = await closeMonth(APRIL); // closed before any notice
      const sl1 = { noticeType: 'SL1', studentLoanPlan: '2', hmrcReference: 'SL1-D', noticeDate: '2026-05-01', receivedOn: '2026-05-12', effectivePayday: '2026-05-31' };
      const first = await notice(sl1);
      const again = await notice(sl1);
      expect([first.duplicate, again.duplicate, again.data.id]).toEqual([false, true, first.data.id]);
      expect(await t.prisma.employeeLoanNotice.count({ where: { employeeId } })).toBe(1);
      expect(await t.prisma.auditLog.count({ where: { recordId: first.data.id, action: 'payroll_loan_notice_recorded' as never } })).toBe(1);
      await expect(notice({ ...sl1, studentLoanPlan: '1' })).rejects.toThrow(/already recorded with different details/);
      // Received on 10 June: it cannot be operated on the 31 May payday (no backdating).
      await expect(notice({ noticeType: 'PGL1', noticeDate: '2026-05-01', receivedOn: '2026-06-10', effectivePayday: '2026-05-31' })).rejects.toThrow(/not backdated/);
      await expect(notice({ noticeType: 'SL1', noticeDate: '2026-05-01', receivedOn: '2026-05-12', effectivePayday: '2026-05-31' })).rejects.toThrow(/needs the student loan plan/);
      // An SL2 for the same payday as the SL1: which applies cannot be told, so May is not calculated.
      await notice({ noticeType: 'SL2', hmrcReference: 'SL2-D', noticeDate: '2026-05-20', receivedOn: '2026-05-25', effectivePayday: '2026-05-31' });
      const may = await run(MAY);
      await ukRuns.calculateGross(maker.id, may);
      await expect(ukRuns.calculateStatutory(maker.id, may)).rejects.toThrow(/conflicting student loan notices from the same payday \(SL1 2, SL2\)/);
      // April, closed before the notices, keeps what it was calculated with.
      expect(await row(april.id)).toMatchObject({ plan: 'NONE', studentLoan: 0, netPay: 2453.64 });
      await expect(ukRuns.calculateStatutory(maker.id, april.id)).rejects.toThrow(/Reactivate this closed run/);
    });

    /** Gate C15: correcting a notice entered wrongly in Careflow (not stopping an HMRC instruction). */
    describe('correcting a notice recorded in error (Gate C15)', () => {
      const correct = (noticeId: string, body: Record<string, unknown>) =>
        employees().correctLoanNotice(maker.id, employeeId, noticeId, body as never);
      const wrong = { noticeType: 'SL1', studentLoanPlan: '1', hmrcReference: 'SL1-X', noticeDate: '2026-05-01', receivedOn: '2026-05-12', effectivePayday: '2026-05-31' };
      const why = { reason: 'Plan keyed as 1; the SL1 says Plan 2', evidenceReference: 'HMRC SL1 letter SL1-X' };
      const corrections = (recordId: string) =>
        t.prisma.auditLog.count({ where: { recordId, action: 'payroll_loan_notice_corrected' as never } });

      it('the wrong entry is voided and kept; the replacement (same reference) is the one payroll uses', async () => {
        const original = (await notice(wrong)).data;
        const result = await correct(original.id, { ...why, replacement: { ...wrong, studentLoanPlan: '2' } });
        expect(result.data.original).toMatchObject({ status: 'CORRECTED', studentLoanPlan: '1', voidReason: why.reason, voidEvidenceRef: why.evidenceReference, replacedById: result.data.replacement!.id });
        expect(result.data.replacement).toMatchObject({ status: 'ACTIVE', studentLoanPlan: '2', hmrcReference: 'SL1-X', replacesId: original.id });
        expect((await employees().listLoanNotices(employeeId)).data.map((n) => [n.studentLoanPlan, n.status])).toEqual([['1', 'CORRECTED'], ['2', 'ACTIVE']]);
        expect(await corrections(original.id)).toBe(1);
        await closeMonth(APRIL);
        expect(await closeMonth(MAY)).toMatchObject({ plan: '2', studentLoan: 49 }); // the replacement, not the voided Plan 1
      });

      it('a repeated correction is not applied twice; a different one, a failed audit entry and a reader are refused', async () => {
        const original = (await notice(wrong)).data;
        // The audit table cannot be written: nothing is saved.
        const audit = t.app.get(AuditLogsService, { strict: false });
        const broken = jest
          .spyOn(audit as unknown as { db: () => unknown }, 'db')
          .mockReturnValue({ auditLog: { create: () => Promise.reject(new Error('synthetic: audit table unavailable')) } });
        await expect(correct(original.id, why)).rejects.toThrow();
        broken.mockRestore();
        expect(await t.prisma.employeeLoanNotice.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ voidedAt: null });
        // A reader (read permission only) cannot correct over HTTP.
        const reader = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.scope.organisation'] });
        const denied = await request(t.app.getHttpServer())
          .post(`/payroll/employees/${employeeId}/loan-notices/${original.id}/correction`)
          .set(bearer(t.staffToken(reader.id)))
          .send(why);
        expect(denied.status).toBe(403);
        // Recorded in error (no replacement), then the same request again: one correction, one audit entry.
        expect((await correct(original.id, why)).data.original.status).toBe('VOIDED');
        expect((await correct(original.id, why)).duplicate).toBe(true);
        await expect(correct(original.id, { ...why, reason: 'A different reason entirely' })).rejects.toThrow(/already been corrected/);
        expect(await corrections(original.id)).toBe(1);
        expect(await t.prisma.employeeLoanNotice.count({ where: { employeeId } })).toBe(1);
      });

      it('a notice that closed payroll used cannot be corrected here; an open run calculated on it must be recalculated', async () => {
        const used = (await notice({ ...wrong, hmrcReference: 'SL1-Y', studentLoanPlan: '2', noticeDate: '2026-04-06', receivedOn: '2026-04-20', effectivePayday: '2026-04-30' })).data;
        const april = await closeMonth(APRIL);
        expect(april).toMatchObject({ plan: '2', studentLoan: 49 });
        await expect(correct(used.id, why)).rejects.toThrow(/affects closed payroll .* a separate payroll correction is needed/);
        expect((await t.prisma.employeeLoanNotice.findUniqueOrThrow({ where: { id: used.id } })).voidedAt).toBeNull();
        expect(await row(april.id)).toMatchObject({ plan: '2', studentLoan: 49 }); // closed run unchanged

        // A notice from the May payday, used by a May run not yet closed: voiding it sends May back.
        const mayNotice = (await notice({ noticeType: 'PGL1', hmrcReference: 'PGL1-Y', noticeDate: '2026-05-01', receivedOn: '2026-05-12', effectivePayday: '2026-05-31' })).data;
        const may = await run(MAY);
        await calculate(may);
        expect(await row(may)).toMatchObject({ postgraduate: true, postgraduateLoan: 75 });
        const result = await correct(mayNotice.id, { reason: 'Keyed against the wrong employee', evidenceReference: 'HMRC PGL1 PGL1-Y' });
        expect(result.runsToRecalculate).toEqual([may]);
        expect((await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: may } })).status).toBe('GROSS_CALCULATED');
        await expect(ukRuns.close(checker.id, may)).rejects.toThrow(/Calculate tax & NI before closing/);
        await ukRuns.calculateStatutory(maker.id, may);
        expect(await row(may)).toMatchObject({ plan: '2', postgraduate: false, postgraduateLoan: 0 });
      });
    });
  });
});
