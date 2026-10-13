/**
 * Gate B2, Stage 5 — minimum wage over the pay reference period (Q37–Q39).
 *
 * Before: the check was made over the dates of each visit pay run, with the age and the rate of
 * the last day of the run, and anyone on an apprentice contract was held to the apprentice rate.
 * So a month's run averaged a low week away, a week's run could not see the rest of the month,
 * and an apprentice of 25 in their second year was checked against £8.00.
 *
 * Now the period is the worker's UK payroll schedule period; a period divided between runs is
 * assessed as a whole and topped up once; age and rate are those at the start of the period.
 *
 * Pay amounts here are synthetic. The statutory rates are the ones already held in the code.
 */
import request from 'supertest';
import { nmwHourlyRate } from '../../src/billing/pay-compliance.util';
import { createApprovedVisit, resetPayData, uuid } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('minimum wage by pay reference period', () => {
  let t: TestApp;
  let preparer: { id: string };
  let approver: { id: string };
  let employeeId: string;
  const ADULT = nmwHourlyRate('AGE_21_AND_OVER', new Date('2026-11-01')); // 12.71

  const server = () => t.app.getHttpServer();
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(bearer(t.staffToken(user.id))).send(body);
  const newRun = async (periodStart: string, periodEnd: string) => {
    const created = await post(preparer, '/billing/payroll-runs', { periodStart, periodEnd });
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  };
  const calculate = async (id: string) => expect((await post(preparer, `/billing/payroll-runs/${id}/calculate`)).status).toBe(201);
  const lock = async (id: string) => {
    expect((await post(approver, `/billing/payroll-runs/${id}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${id}/lock`)).status).toBe(201);
  };
  /** Ten hours on a day, paid at the given hourly figure. */
  const work = (day: string, hourly: number, hours = 10) =>
    createApprovedVisit(t.prisma, { employeeId, start: `${day}T08:00:00Z`, minutes: hours * 60, amount: hours * hourly });
  const topUps = (payrollRunId?: string) =>
    t.prisma.payrollRunLine.findMany({
      where: { lineType: 'NMW_TOP_UP', employeeId, sourceType: 'NMW_PERIOD', ...(payrollRunId ? { payrollRunId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  const amounts = async (payrollRunId?: string) => (await topUps(payrollRunId)).map((l) => Number(l.amount));
  const assessments = (payrollRunId: string) =>
    t.prisma.nmwPeriodAssessment.findMany({ where: { payrollRunId, employeeId }, orderBy: { periodStart: 'asc' } });
  /** The worker's UK payroll schedule with the given pay periods: these are the pay reference periods. */
  const paidBy = async (frequency: 'WEEKLY' | 'MONTHLY', periods: Array<[string, string]>, profile: Record<string, unknown> = {}) => {
    const tag = uuid().slice(0, 8);
    const taxYear =
      (await t.prisma.payrollTaxYear.findFirst({ where: { code: 'TEST-2026-27' } })) ??
      (await t.prisma.payrollTaxYear.create({
        data: { code: 'TEST-2026-27', label: 'Test 2026/27', startDate: new Date('2026-04-06'), endDate: new Date('2027-04-05') },
      }));
    const schedule = await t.prisma.payrollSchedule.create({ data: { name: `Test ${tag}`, code: `TEST-${tag}`, frequency } });
    for (const [index, [start, end]] of periods.entries()) {
      await t.prisma.payrollPeriod.create({
        data: { scheduleId: schedule.id, taxYearId: taxYear.id, sequence: index + 1, label: `${start} – ${end}`, periodStart: new Date(start), periodEnd: new Date(end), paymentDate: new Date(end) },
      });
    }
    await t.prisma.employeePayrollProfile.create({ data: { employeeId, scheduleId: schedule.id, ...profile } as never });
  };
  const bornOn = (dateOfBirth: string) =>
    t.prisma.employeePersonalDetail.create({ data: { employeeId, firstName: 'Synthetic', lastName: `Worker ${uuid().slice(0, 6)}`, dateOfBirth: new Date(dateOfBirth) } as never });
  const NOVEMBER: Array<[string, string]> = [['2026-11-01', '2026-11-30']];

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await t.prisma.employeePayrollProfile.deleteMany({ where: { schedule: { code: { startsWith: 'TEST-' } } } });
    await t.prisma.payrollSchedule.deleteMany({ where: { code: { startsWith: 'TEST-' } } });
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma, 14);
    preparer = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.manage', 'payroll.scope.organisation'] });
    approver = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.prisma.employeePayrollProfile.deleteMany({ where: { schedule: { code: { startsWith: 'TEST-' } } } });
    await t.close();
  });

  it('a monthly run does not average a low week away for a worker paid weekly', async () => {
    await paidBy('WEEKLY', [
      ['2026-11-02', '2026-11-08'],
      ['2026-11-09', '2026-11-15'],
    ]);
    await work('2026-11-03', 12); // week 1: below the rate
    await work('2026-11-10', 14); // week 2: above it. Together they average £13.00.
    const run = await newRun('2026-11-01', '2026-11-30');
    await calculate(run);

    const [line] = await topUps(run);
    expect(Number(line.amount)).toBe(Math.round((ADULT - 12) * 10 * 100) / 100); // £7.10 for week 1
    expect(line.claimKey).toBe(`NMW:${employeeId}:2026-11-02:1`);
    expect(line.description).toMatch(/pay reference period 2026-11-02 to 2026-11-08: £120\.00 for 10h = £12\.0000\/hr, rate £12\.71/);
    expect((await assessments(run)).map((a) => [a.periodSource, a.compliant, Number(a.topUpInRun)])).toEqual([
      ['PAYROLL_SCHEDULE', false, 7.1],
      ['PAYROLL_SCHEDULE', true, 0],
    ]);
  });

  it('a monthly period divided between weekly runs is assessed as a whole and topped up once', async () => {
    await paidBy('MONTHLY', NOVEMBER);
    await work('2026-11-03', 12);
    const first = await newRun('2026-11-02', '2026-11-08');
    await calculate(first);
    expect(await amounts(first)).toEqual([7.1]); // all there is of the period so far is short
    await calculate(first);
    expect(await amounts()).toEqual([7.1]); // calculating again adds nothing
    await lock(first);

    // More low-paid hours in the same period: only the further shortfall is added.
    await work('2026-11-10', 12);
    const second = await newRun('2026-11-09', '2026-11-15');
    await calculate(second);
    const [further] = await topUps(second);
    expect(Number(further.amount)).toBe(7.1);
    expect(further.claimKey).toBe(`NMW:${employeeId}:2026-11-01:2`);
    expect(further.description).toMatch(/£240\.00 for 20h.*£7\.10 already topped up by an earlier run/);
    await lock(second);

    // Higher pay later in the period lifts the whole period above the rate. The top-ups already
    // paid are then an overpayment: proposed for recovery and shown, never deducted by themselves
    // (Sprint B3). Authorised, they are deducted once.
    await work('2026-11-17', 16, 20);
    const third = await newRun('2026-11-16', '2026-11-22');
    await calculate(third);
    expect(await amounts(third)).toEqual([]);
    const [position] = await assessments(third);
    expect(position).toMatchObject({ periodMinutes: 2400, compliant: true });
    expect(Number(position.periodPay)).toBe(560); // £14.00 an hour over the period
    const [shown] = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: third, sourceType: 'HELD_EARNING' } });
    expect(shown.sourceRef).toBe(`HELD:RECOVERY:NMW:${employeeId}:2026-11-01:3`);
    const [recovery] = await t.prisma.wageRecovery.findMany({ where: { employeeId } });
    expect(recovery).toMatchObject({ kind: 'NMW_TOP_UP', status: 'PROPOSED' });
    expect(Number(recovery.amount)).toBe(14.2);

    await t.prisma.wageRecovery.update({ where: { id: recovery.id }, data: { status: 'APPROVED', authorityBasis: 'Synthetic authority', decidedAt: new Date() } });
    await calculate(third);
    expect(await amounts(third)).toEqual([-14.2]);
    await lock(third);
    expect((await amounts()).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 2);
    expect((await t.prisma.wageRecovery.findUniqueOrThrow({ where: { id: recovery.id } })).status).toBe('APPLIED');
  });

  it('a supplementary run over a locked period adds no second top-up', async () => {
    await paidBy('MONTHLY', NOVEMBER);
    await work('2026-11-03', 12);
    const first = await newRun('2026-11-02', '2026-11-08');
    await calculate(first);
    await lock(first);
    const supplementary = await newRun('2026-11-02', '2026-11-08');
    await calculate(supplementary);
    expect(await t.prisma.payrollRunLine.count({ where: { payrollRunId: supplementary } })).toBe(0);
    expect(await amounts()).toEqual([7.1]);
  });

  it('two open runs covering parts of one period: the second is held until the first is locked', async () => {
    await paidBy('MONTHLY', NOVEMBER);
    await work('2026-11-03', 12);
    const first = await newRun('2026-11-02', '2026-11-08');
    await calculate(first);
    await work('2026-11-10', 12);
    const second = await newRun('2026-11-09', '2026-11-15');
    await calculate(second);
    expect(await amounts(second)).toEqual([]);
    const [held] = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: second, sourceType: 'HELD_EARNING' } });
    expect(held.sourceRef).toBe(`HELD:WEEK:NMW:${employeeId}:2026-11-01`);
    expect(held.exceptionMessage).toMatch(/is not locked yet/);
    await lock(first);
    await calculate(second);
    expect(await amounts(second)).toEqual([7.1]);
  });

  it('with no payroll schedule the dates of the run are used, and the line says so', async () => {
    await work('2026-11-03', 12);
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);
    const [line] = await topUps(run);
    expect(Number(line.amount)).toBe(7.1);
    expect(line.description).toMatch(/the dates of this run: no payroll schedule period covers them/);
    expect((await assessments(run))[0].periodSource).toBe('PAY_RUN_PERIOD');
  });

  it('age is taken at the start of the period: a 21st birthday in the period changes the next period', async () => {
    await paidBy('MONTHLY', [
      ['2026-11-01', '2026-11-30'],
      ['2026-12-01', '2026-12-31'],
    ]);
    await bornOn('2005-11-15'); // 21 on 15 November 2026
    await work('2026-11-20', 11); // after the birthday, but in the period that began before it
    await work('2026-12-03', 11);
    const run = await newRun('2026-11-01', '2026-12-31');
    await calculate(run);
    const rows = await assessments(run);
    expect(rows.map((a) => [a.category, a.ageAtPeriodStart, a.compliant])).toEqual([
      ['AGE_18_TO_20', 20, true], // £11.00 against £10.85
      ['AGE_21_AND_OVER', 21, false], // £11.00 against £12.71
    ]);
    expect(await amounts(run)).toEqual([Math.round((ADULT - 11) * 10 * 100) / 100]);
  });

  describe('apprentices', () => {
    const apprenticeContract = async () => {
      const contractType = await t.prisma.contractType.upsert({ where: { name: 'Apprenticeship (synthetic test)' }, update: {}, create: { name: 'Apprenticeship (synthetic test)' } });
      await t.prisma.employeeEmployment.update({ where: { employeeId }, data: { contractTypeId: contractType.id } });
    };
    const firstAssessment = async () => {
      const run = await newRun('2026-11-02', '2026-11-08');
      await calculate(run);
      return { row: (await assessments(run))[0], topUp: await amounts(run) };
    };

    it('an apprentice of 25 with no apprenticeship start date is checked against the rate for their age', async () => {
      await paidBy('MONTHLY', NOVEMBER);
      await bornOn('2001-03-01');
      await apprenticeContract();
      await work('2026-11-03', 9);
      const { row, topUp } = await firstAssessment();
      expect(row.category).toBe('AGE_21_AND_OVER');
      expect(row.note).toMatch(/date the apprenticeship began is not recorded/);
      expect(topUp).toEqual([Math.round((ADULT - 9) * 10 * 100) / 100]);
    });

    it('in the first year of the apprenticeship the apprentice rate applies; after it, the age rate', async () => {
      await paidBy('MONTHLY', NOVEMBER, { apprenticeshipStartDate: new Date('2026-03-01') });
      await bornOn('2001-03-01');
      await apprenticeContract();
      await work('2026-11-03', 9);
      const first = await firstAssessment();
      expect(first.row.category).toBe('APPRENTICE');
      expect(first.topUp).toEqual([]);

      await resetPayData(t.prisma);
      await t.prisma.employeePayrollProfile.updateMany({ where: { employeeId }, data: { apprenticeshipStartDate: new Date('2025-09-01') } });
      await work('2026-11-03', 9);
      const second = await firstAssessment();
      expect(second.row.category).toBe('AGE_21_AND_OVER');
      expect(second.topUp).toHaveLength(1);
    });

    it('an apprentice under 19 is on the apprentice rate whatever the start date', async () => {
      await paidBy('MONTHLY', NOVEMBER);
      await bornOn('2008-06-01'); // 18
      await apprenticeContract();
      await work('2026-11-03', 9);
      expect((await firstAssessment()).row.category).toBe('APPRENTICE');
    });
  });

  it('a salaried worker is not given a top-up worked out from visit lines', async () => {
    await paidBy('MONTHLY', NOVEMBER);
    await t.prisma.employeePayAgreement.create({
      data: { employeeId, basis: 'SALARIED', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), annualSalary: 24000, salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS', salaryCoverage: 'ALL_VISIT_WORK', approvedAt: new Date('2026-01-01') } as never,
    });
    await work('2026-11-03', 9);
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);
    expect(await amounts(run)).toEqual([]);
    const [row] = await assessments(run);
    expect(row).toMatchObject({ workType: 'SALARIED_HOURS' });
    expect(row.note).toMatch(/Salaried hours work/);
  });

  it('pay for hours not worked does not hide a shortfall on hours that were worked', async () => {
    await paidBy('MONTHLY', NOVEMBER);
    await work('2026-11-03', 12);
    // An approved cancellation payment in the same period: it is not pay for working time.
    await t.prisma.employeePayItem.create({
      data: { employeeId, wageTypeCode: 'DISRUPTION_PAY', workDate: new Date('2026-11-04'), unit: 'AMOUNT', amount: 50, reason: 'Synthetic cancelled visit', status: 'APPROVED', approvedAt: new Date() } as never,
    });
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);
    expect(await amounts(run)).toEqual([7.1]);
  });
});
