/**
 * Gate B2, Stage 5 — holiday entitlement and holiday pay foundations (policy decision Q35).
 *
 * Before: the only holiday calculation was a pay card flag adding 12.07% rolled-up holiday pay to
 * everyone on the card, whatever kind of worker they were. There was no leave year, entitlement,
 * balance or holiday pay rate.
 *
 * Now each employee has leave terms, approved by a second person: worker category, leave year,
 * normal week, contractual extra, carry-over and how holiday is paid. Nothing is worked out for
 * an employee without terms. The terms in this file are SYNTHETIC POLICY.
 */
import request from 'supertest';
import { createApprovedVisit, resetPayData } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('Q35: holiday entitlement and holiday pay (synthetic terms)', () => {
  let t: TestApp;
  let officer: { id: string };
  let approver: { id: string };
  let payOfficer: { id: string };
  let payApprover: { id: string };
  let employeeId: string;
  let payCardId: string;

  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));
  const REGULAR = { workerCategory: 'REGULAR_HOURS', leaveYearStartMonth: 4, weeklyHours: 37.5, payMethod: 'NORMAL_REMUNERATION_52_WEEKS', effectiveFrom: '2026-04-01' };
  const IRREGULAR = { workerCategory: 'IRREGULAR_HOURS', leaveYearStartMonth: 4, payMethod: 'ROLLED_UP_12_07', effectiveFrom: '2026-04-01' };
  const terms = async (body: Record<string, unknown>) => {
    const created = await post(officer, `/payroll/employees/${employeeId}/leave-terms`, body);
    expect(created.status).toBe(201);
    expect((await post(approver, `/payroll/leave-terms/${created.body.data.id}/approve`)).status).toBe(201);
    return created.body.data.id as string;
  };
  const entry = (body: Record<string, unknown>) => post(officer, `/payroll/employees/${employeeId}/leave-entries`, { note: 'Synthetic', ...body });
  const position = async (query = 'asOf=2026-11-03') => (await get(officer, `/payroll/employees/${employeeId}/leave?${query}`)).body.data;

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    payCardId = (await seedDefaultCards(t.prisma, 14)).payCardId;
    const org = 'payroll.scope.organisation';
    officer = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.employees.manage', org] });
    approver = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.pay_agreements.approve', org] });
    payOfficer = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.manage', org] });
    payApprover = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', org] });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.close();
  });

  it('an employee with no approved terms has nothing worked out', async () => {
    expect(await position()).toMatchObject({ terms: null });
    // Entered but not approved: still nothing.
    await post(officer, `/payroll/employees/${employeeId}/leave-terms`, REGULAR);
    const seen = await position();
    expect(seen.terms).toBeNull();
    expect(seen.note).toMatch(/a holiday method is not assumed/);
  });

  it('terms need a second person, and rolled-up pay cannot be recorded for a regular-hours worker', async () => {
    const created = await post(officer, `/payroll/employees/${employeeId}/leave-terms`, REGULAR);
    expect(created.body.message).toMatch(/once a second person approves/);
    const own = await createStaffUser(t.prisma, { permissions: ['payroll.employees.manage', 'payroll.pay_agreements.approve', 'payroll.scope.organisation'] });
    const draft = await post(own, `/payroll/employees/${employeeId}/leave-terms`, REGULAR);
    expect((await post(own, `/payroll/leave-terms/${draft.body.data.id}/approve`)).status).toBe(403);
    expect((await post(officer, `/payroll/leave-terms/${created.body.data.id}/approve`)).status).toBe(403);

    const refused = await post(officer, `/payroll/employees/${employeeId}/leave-terms`, { ...REGULAR, payMethod: 'ROLLED_UP_12_07' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/only be used for a worker with irregular hours or who works part of the year/);
    expect((await post(officer, `/payroll/employees/${employeeId}/leave-terms`, { ...REGULAR, weeklyHours: undefined })).body.message).toMatch(
      /hours of a normal working week/,
    );
  });

  it('regular hours: 5.6 weeks of the normal week, earned through the leave year, with what was taken and the balance', async () => {
    await terms(REGULAR);
    await entry({ entryType: 'TAKEN', hours: 37.5, date: '2026-08-10' });
    await entry({ entryType: 'CARRY_OVER', hours: 15, date: '2026-04-01' });
    const seen = await position();
    expect(seen.leaveYear).toEqual({ start: '2026-04-01', end: '2027-03-31' });
    // 1 April to 3 November is 217 of 365 days of 210 hours.
    expect(seen.statutory).toMatchObject({ entitlement: 124.85, fullYearEntitlement: 210, taken: 37.5, carriedOver: 15, balance: 102.35 });
    expect(seen.contractual).toMatchObject({ entitlement: 0, balance: 0 });
  });

  it('contractual leave is kept apart from statutory leave', async () => {
    await terms({ ...REGULAR, contractualExtraHours: 37.5, carryOverMaxHours: 20 });
    await entry({ entryType: 'TAKEN', entitlementType: 'CONTRACTUAL', hours: 7.5, date: '2026-09-01' });
    const seen = await position('asOf=2027-03-31');
    expect(seen.statutory).toMatchObject({ entitlement: 210, taken: 0, balance: 210 });
    expect(seen.contractual).toMatchObject({ entitlement: 37.5, taken: 7.5, balance: 30 });
    expect(seen.carryOverAllowed).toBe(20); // what the terms allow, not everything that is left
  });

  it('irregular hours: leave accrues at 12.07% of the hours worked in each pay period', async () => {
    await terms(IRREGULAR);
    await createApprovedVisit(t.prisma, { employeeId, start: '2026-10-06T08:00:00Z', minutes: 100 * 60, amount: 1400 }); // October
    await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-02T08:00:00Z', minutes: 20 * 60, amount: 280 }); // November
    const seen = await position('asOf=2026-11-30');
    expect(seen.statutory.entitlement).toBe(14); // 12 (of 100h) + 2 (of 20h)
    expect(seen.statutory.basis).toMatch(/12\.07% of the hours worked in each of 2 pay period/);
    expect(seen.holidayPay).toMatchObject({ method: 'ROLLED_UP_12_07', averageHourlyPay: null });
    expect(seen.holidayPay.note).toMatch(/nothing further is paid when leave is taken/);
  });

  it('holiday pay for a regular-hours worker is the average of the paid weeks before the leave', async () => {
    await terms(REGULAR);
    // Two paid weeks in locked pay runs: 30 hours for £420, and 20 hours for £300 (including a premium).
    for (const [day, minutes, amount] of [
      ['2026-10-06', 1800, 420],
      ['2026-10-13', 1200, 300],
    ] as const) {
      await createApprovedVisit(t.prisma, { employeeId, start: `${day}T08:00:00Z`, minutes, amount });
    }
    const run = (await post(payOfficer, '/billing/payroll-runs', { periodStart: '2026-10-05', periodEnd: '2026-10-18' })).body.data.id as string;
    await post(payOfficer, `/billing/payroll-runs/${run}/calculate`);
    await post(payApprover, `/billing/payroll-runs/${run}/approve`);
    expect((await post(payApprover, `/billing/payroll-runs/${run}/lock`)).status).toBe(201);

    const seen = await position();
    expect(seen.holidayPay).toMatchObject({ method: 'NORMAL_REMUNERATION_52_WEEKS', weeksUsed: 2, averageWeeklyPay: 360, averageHourlyPay: 14.4 });
    expect(seen.holidayPay.note).toMatch(/Average of the 2 paid week\(s\) there are; fewer than 52/);
  });

  it('a leaver: what was earned to the leaving day against what was taken, shown and never paid automatically', async () => {
    await terms(REGULAR);
    await entry({ entryType: 'TAKEN', hours: 30, date: '2026-05-11' });
    const leaving = await position('leavingDate=2026-06-30');
    // 1 April to 30 June is 91 of 365 days of 210 hours = 52.36 hours earned.
    expect(leaving.statutory).toMatchObject({ entitlement: 52.36, taken: 30, balance: 22.36 });
    expect(leaving.leaver).toMatchObject({ leavingDate: '2026-06-30', untakenHours: 22.36, takenMoreThanEarned: false });
    expect(await t.prisma.employeePayItem.count({ where: { employeeId } })).toBe(0);

    await entry({ entryType: 'TAKEN', hours: 30, date: '2026-06-01' });
    expect((await position('leavingDate=2026-06-30')).leaver).toMatchObject({ untakenHours: -7.64, takenMoreThanEarned: true, paymentInLieu: null });
  });

  it('new terms replace the earlier ones from their start date; the earlier ones stay as history', async () => {
    await terms(REGULAR);
    await terms({ ...REGULAR, weeklyHours: 20, effectiveFrom: '2026-10-01' });
    const listed = (await get(officer, `/payroll/employees/${employeeId}/leave-terms`)).body.data;
    expect(listed.map((r: Record<string, unknown>) => [r.effectiveFrom, r.effectiveTo, r.status, r.weeklyHours])).toEqual([
      ['2026-10-01', null, 'ACTIVE', 20],
      ['2026-04-01', '2026-09-30', 'SUPERSEDED', 37.5],
    ]);
    expect((await position('asOf=2026-09-15')).terms.weeklyHours).toBe(37.5);
    expect((await position('asOf=2026-11-03')).terms.weeklyHours).toBe(20);
  });

  describe('rolled-up holiday pay on a pay card is not applied to everyone on the card', () => {
    const runLines = async () => {
      await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-03T08:00:00Z', minutes: 600, amount: 140 });
      const run = (await post(payOfficer, '/billing/payroll-runs', { periodStart: '2026-11-02', periodEnd: '2026-11-08' })).body.data.id as string;
      expect((await post(payOfficer, `/billing/payroll-runs/${run}/calculate`)).status).toBe(201);
      return t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run } });
    };
    beforeEach(() => t.prisma.payCard.update({ where: { id: payCardId }, data: { holidayPayMethod: 'ROLLED_UP_12_07' } as never }));

    it('an irregular-hours worker on rolled-up terms is paid it', async () => {
      await terms(IRREGULAR);
      const holiday = (await runLines()).filter((l) => l.lineType === 'HOLIDAY_PAY');
      expect(holiday.map((l) => Number(l.amount))).toEqual([16.9]); // 12.07% of £140.00
      expect(holiday[0].description).not.toMatch(/not verified/);
    });

    it('a regular-hours worker is not: the line is held with the reason', async () => {
      await terms(REGULAR);
      const lines = await runLines();
      const [held] = lines.filter((l) => l.sourceType === 'HELD_EARNING');
      expect(held).toMatchObject({ lineType: 'HOLIDAY_PAY', sourceRef: `HELD:HOLIDAY:${employeeId}` });
      expect(Number(held.amount)).toBe(0);
      expect(held.exceptionMessage).toMatch(/regular hours: rolled-up holiday pay cannot be used for them/);
      expect(lines.filter((l) => l.lineType === 'VISIT_PAY').map((l) => Number(l.amount))).toEqual([140]);
    });

    it('an employee with no terms keeps the earlier behaviour, and the line says the eligibility is not verified', async () => {
      const holiday = (await runLines()).filter((l) => l.lineType === 'HOLIDAY_PAY');
      expect(holiday.map((l) => Number(l.amount))).toEqual([16.9]);
      expect(holiday[0].description).toMatch(/no leave terms recorded for this employee.*not verified/);
    });
  });
});
