/**
 * Gate B2, Stage 3 — guaranteed hours (WM-07 / EL-01).
 *
 * Before: a guaranteed number of weekly hours could be recorded on the employment record, and
 * nothing in pay read it. Whether a shortfall is paid at all is the employer's policy, so nothing
 * is paid unless an approved pay agreement states a guarantee and that the shortfall is paid.
 *
 * The guarantee here is SYNTHETIC POLICY (14 hours a week on a £14.00 card). Decision Q23 is open.
 */
import request from 'supertest';
import { createApprovedVisit, resetPayData, uuid } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('WM-07 / EL-01: guaranteed hours top-up (synthetic agreement)', () => {
  let t: TestApp;
  let preparer: { id: string };
  let approver: { id: string };
  let officer: { id: string };
  let employeeId: string;
  const WEEK = { periodStart: '2026-11-02', periodEnd: '2026-11-08' }; // Monday to Sunday

  const server = () => t.app.getHttpServer();
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(bearer(t.staffToken(user.id))).send(body);
  const newRun = async (period = WEEK) => {
    const created = await post(preparer, '/billing/payroll-runs', period);
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  };
  const calculate = async (id: string) => expect((await post(preparer, `/billing/payroll-runs/${id}/calculate`)).status).toBe(201);
  const lock = async (id: string) => {
    expect((await post(approver, `/billing/payroll-runs/${id}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${id}/lock`)).status).toBe(201);
  };
  const work = (day: string, hours: number, over: Record<string, unknown> = {}) =>
    createApprovedVisit(t.prisma, { employeeId, start: `${day}T09:00:00Z`, minutes: hours * 60, amount: hours * 14, ...over });
  /** An approved hourly agreement guaranteeing 14 hours a week, shortfall paid, visits counted. */
  const guarantee = (over: Record<string, unknown> = {}) =>
    t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'HOURLY_CARE',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        guaranteedWeeklyHours: 14,
        guaranteeTopUp: 'PAY_SHORTFALL',
        guaranteeQualifyingTime: 'VISITS',
        approvedById: uuid(),
        approvedAt: new Date('2026-01-01T09:00:00Z'),
        ...over,
      } as never,
    });
  const topUps = (payrollRunId?: string) =>
    t.prisma.payrollRunLine.findMany({
      where: { sourceType: 'GUARANTEED_HOURS', employeeId, ...(payrollRunId ? { payrollRunId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  const amounts = async (payrollRunId?: string) => (await topUps(payrollRunId)).map((l) => Number(l.amount));
  const held = (payrollRunId: string) =>
    t.prisma.payrollRunLine.findMany({ where: { payrollRunId, sourceType: 'HELD_EARNING', employeeId } });

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await t.prisma.employeeAbsenceRecord.deleteMany({ where: { notes: 'SYNTHETIC guaranteed hours test' } });
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma, 14);
    preparer = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.manage', 'payroll.scope.organisation'] });
    approver = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', 'payroll.scope.organisation'] });
    officer = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.employees.manage', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.prisma.employeeAbsenceRecord.deleteMany({ where: { notes: 'SYNTHETIC guaranteed hours test' } });
    await t.close();
  });

  it('nothing is paid without an approved agreement that says the shortfall is paid', async () => {
    await work('2026-11-03', 6);
    // No agreement at all.
    const none = await newRun();
    await calculate(none);
    expect(await amounts(none)).toEqual([]);
    // A guarantee recorded only, and a paid guarantee that nobody has approved yet.
    await guarantee({ guaranteeTopUp: null, guaranteeQualifyingTime: null });
    await guarantee({ status: 'DRAFT', approvedById: null, approvedAt: null });
    await calculate(none);
    expect(await amounts(none)).toEqual([]);
    expect(await held(none)).toHaveLength(0);
  });

  it('hours short of the guarantee are topped up at the card base rate; hours worked are paid as visits', async () => {
    await guarantee();
    await work('2026-11-03', 6);
    await work('2026-11-04', 4);
    const run = await newRun();
    await calculate(run);

    const [line] = await topUps(run);
    expect(line).toMatchObject({ lineType: 'GUARANTEED_HOURS', minutes: 240, claimKey: `GUARANTEE:${employeeId}:2026-11-02:1` });
    expect(Number(line.amount)).toBe(56); // 4 hours × £14.00
    expect(line.description).toMatch(/14h guaranteed, 10h visits counted, 4h short × £14\.00/);
    const all = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run } });
    // Base pay and top-up together pay exactly the guarantee: nothing is counted twice.
    expect(all.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(196);
  });

  it('a week at or above the guarantee has no top-up; a week with no work at all is topped up in full', async () => {
    await guarantee();
    await work('2026-11-03', 8);
    await work('2026-11-04', 8);
    const run = await newRun();
    await calculate(run);
    expect(await amounts(run)).toEqual([]);

    // The following week nothing was scheduled.
    const next = await newRun({ periodStart: '2026-11-09', periodEnd: '2026-11-15' });
    await calculate(next);
    expect(await amounts(next)).toEqual([196]); // 14 hours × £14.00
  });

  it('a week divided between two runs is settled once, by the run in which the week ends', async () => {
    await guarantee();
    await work('2026-11-02', 6);
    const first = await newRun({ periodStart: '2026-11-02', periodEnd: '2026-11-04' });
    await calculate(first);
    expect(await amounts(first)).toEqual([]); // the week is not over
    await lock(first);

    await work('2026-11-06', 4);
    const second = await newRun({ periodStart: '2026-11-05', periodEnd: '2026-11-08' });
    await calculate(second);
    expect(await amounts(second)).toEqual([56]); // 10 of 14 hours worked across both runs
    await calculate(second);
    expect(await amounts()).toEqual([56]);
  });

  it('a guarantee that starts part way through a week counts for its own days and its own work', async () => {
    await guarantee({ effectiveFrom: new Date('2026-11-05') }); // Thursday: 4 of 7 days = 8 hours
    await work('2026-11-03', 6); // before the guarantee: paid as a visit, not counted towards it
    await work('2026-11-06', 5);
    const run = await newRun();
    await calculate(run);
    const [line] = await topUps(run);
    expect(Number(line.amount)).toBe(42); // 3 hours short
    expect(line.description).toMatch(/8h guaranteed \(4 of 7 days\), 5h visits counted, 3h short/);
  });

  it('travel and waiting time count towards the guarantee only when the agreement says so', async () => {
    await guarantee({ guaranteeQualifyingTime: 'VISITS_AND_TRAVEL' });
    const visit = await work('2026-11-03', 10);
    // One hour of travel time paid with that visit by another, locked, pay run.
    const travelRun = await t.prisma.payrollRun.create({
      data: { periodLabel: 'Synthetic travel run', periodStart: new Date('2026-10-26'), periodEnd: new Date('2026-11-01'), status: 'DRAFT' } as never,
    });
    await t.prisma.payrollRunLine.create({
      data: { payrollRunId: travelRun.id, visitReconciliationId: visit.id, employeeId, lineType: 'TRAVEL_TIME', description: 'Synthetic travel', minutes: 60, amount: 14 } as never,
    });
    const run = await newRun();
    await calculate(run);
    const [line] = await topUps(run);
    expect(Number(line.amount)).toBe(42); // 14 − 10 − 1 = 3 hours
    expect(line.description).toMatch(/10h visits, 1h travel and waiting counted/);
  });

  describe('paid leave and absence', () => {
    const absence = (from: string, to: string) =>
      t.prisma.employeeAbsenceRecord.create({
        data: { employeeId, absenceType: 'Holiday', fromDateTime: new Date(from), toDateTime: new Date(to), notes: 'SYNTHETIC guaranteed hours test' } as never,
      });
    const paidLeave = (day: string, hours: number) =>
      t.prisma.employeePayItem.create({
        data: { employeeId, wageTypeCode: 'HOLIDAY_PAY', workDate: new Date(day), unit: 'HOURS', quantity: hours, rate: 14, amount: hours * 14, reason: 'Synthetic holiday pay', status: 'APPROVED', approvedAt: new Date() } as never,
      });

    it('paid leave hours count towards the guarantee when the agreement says so', async () => {
      await guarantee({ guaranteeLeaveTreatment: 'COUNT_PAID_LEAVE_HOURS' });
      await work('2026-11-03', 4);
      await absence('2026-11-05T00:00:00Z', '2026-11-05T23:00:00Z');
      await paidLeave('2026-11-05', 7);
      const run = await newRun();
      await calculate(run);
      const [line] = await topUps(run);
      expect(Number(line.amount)).toBe(42); // 14 − 4 − 7 = 3 hours
      expect(line.description).toMatch(/4h visits, 7h paid leave counted/);
    });

    it('absence days reduce the guarantee when the agreement says so', async () => {
      await guarantee({ guaranteeLeaveTreatment: 'REDUCE_FOR_ABSENCE_DAYS' });
      await work('2026-11-03', 4);
      await absence('2026-11-05T08:00:00Z', '2026-11-06T17:00:00Z'); // Thursday and Friday
      const run = await newRun();
      await calculate(run);
      const [line] = await topUps(run);
      expect(Number(line.amount)).toBe(84); // 10 hours guaranteed − 4 worked = 6 hours
      expect(line.description).toMatch(/10h guaranteed, reduced for 2 day\(s\) of absence/);
    });

    it('with no treatment recorded, a week with absence is held for a person: nothing is paid automatically', async () => {
      await guarantee();
      await work('2026-11-03', 4);
      await absence('2026-11-05T08:00:00Z', '2026-11-05T17:00:00Z');
      const run = await newRun();
      await calculate(run);
      expect(await amounts(run)).toEqual([]);
      const [hold] = await held(run);
      expect(hold.sourceRef).toBe(`HELD:GUARANTEE:${employeeId}:2026-11-02`);
      expect(hold.exceptionMessage).toMatch(/does not say how absence affects the guarantee\. Nothing is paid automatically/);
      // The visit pay of that week is not held back.
      expect(await t.prisma.payrollRunLine.count({ where: { payrollRunId: run, lineType: 'VISIT_PAY' } })).toBe(1);
    });
  });

  it('a visit not yet approved or rejected holds the top-up, so base pay and top-up cannot both be paid for it', async () => {
    await guarantee();
    await work('2026-11-03', 6);
    await work('2026-11-04', 4, { status: 'PENDING_REVIEW' });
    const run = await newRun();
    await calculate(run);
    expect(await amounts(run)).toEqual([]);
    expect((await held(run))[0].exceptionMessage).toMatch(/1 visit\(s\) of that week are not yet approved or rejected for pay/);
  });

  it('a visit of a settled week approved late reduces the top-up already paid, once', async () => {
    await guarantee();
    await work('2026-11-03', 6);
    const first = await newRun();
    await calculate(first);
    expect(await amounts(first)).toEqual([112]); // 8 hours short
    await lock(first);

    await work('2026-11-05', 2); // approved after the lock
    const supplementary = await newRun();
    await calculate(supplementary);
    const [adjustment] = await topUps(supplementary);
    expect(Number(adjustment.amount)).toBe(-28);
    expect(adjustment.claimKey).toBe(`GUARANTEE:${employeeId}:2026-11-02:2`);
    expect(adjustment.description).toMatch(/£112\.00 already paid by an earlier run/);
    // The late visit is paid as a visit; with the reduced top-up the week still totals the guarantee.
    const lines = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: supplementary } });
    expect(lines.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(0);
    await lock(supplementary);
    const everything = await t.prisma.payrollRunLine.findMany({ where: { employeeId } });
    expect(everything.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(196);
  });

  it('the top-up is not counted as pay for work when minimum wage is checked', async () => {
    await guarantee();
    await work('2026-11-03', 6);
    const run = await newRun();
    await calculate(run);
    expect(await t.prisma.payrollRunLine.count({ where: { payrollRunId: run, lineType: 'NMW_TOP_UP' } })).toBe(0);
    expect((await amounts(run))[0]).toBe(112);
  });

  it('through the API: a paid guarantee needs a second person, and cannot sit on a salary', async () => {
    const body = {
      basis: 'HOURLY_CARE',
      effectiveFrom: '2026-11-01',
      status: 'ACTIVE',
      guaranteedWeeklyHours: 14,
      guaranteeTopUp: 'PAY_SHORTFALL',
      guaranteeQualifyingTime: 'VISITS',
    };
    const path = `/payroll/employees/${employeeId}/pay-agreements`;
    const created = await post(officer, path, body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'DRAFT', awaitingApproval: true, guaranteedWeeklyHours: 14, guaranteeTopUp: 'PAY_SHORTFALL' });

    expect((await post(officer, path, { ...body, guaranteeQualifyingTime: undefined })).body.message).toMatch(/what counts towards the guaranteed hours/);
    expect((await post(officer, path, { ...body, guaranteedWeeklyHours: undefined })).body.message).toMatch(/Enter the guaranteed weekly hours/);
    const onSalary = await post(officer, path, {
      ...body,
      basis: 'SALARIED',
      annualSalary: 24000,
      salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
      salaryCoverage: 'ALL_VISIT_WORK',
    });
    expect(onSalary.body.message).toMatch(/top-up applies to hourly pay/);
    // A guarantee that is only recorded is an ordinary hourly agreement.
    const recorded = await post(officer, path, { basis: 'HOURLY_CARE', effectiveFrom: '2026-10-01', status: 'ACTIVE', guaranteedWeeklyHours: 14 });
    expect(recorded.body.data).toMatchObject({ status: 'ACTIVE', guaranteeTopUp: null });
  });
});
