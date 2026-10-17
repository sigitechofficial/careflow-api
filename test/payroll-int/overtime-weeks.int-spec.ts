/**
 * Gate B2, Stage 3 — weekly overtime when a week is divided between pay runs (WM-18).
 *
 * Before: each run worked out overtime from its own visits only, so a week split between two runs
 * was two short weeks and the premium was never paid; the line was identified by the run, so
 * nothing tied the overtime of one week together across runs.
 *
 * Now a Monday–Sunday week is one work period and its overtime carries one identity
 * (OVERTIME:<employee>:<week>:<n>) whichever runs its visits are in.
 *
 * The overtime rule here is SYNTHETIC POLICY (time and a half above 10 hours a week on a £14.00
 * card). Policy decision Q29 is open.
 */
import request from 'supertest';
import { createApprovedVisit, resetPayData } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('WM-18: weekly overtime across pay runs (synthetic rule)', () => {
  let t: TestApp;
  let preparer: { id: string };
  let approver: { id: string };
  let employeeId: string;

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
  /** Hours worked on a day of the week of Monday 2 November 2026, at £14.00 an hour. */
  const work = (day: string, hours: number) =>
    createApprovedVisit(t.prisma, { employeeId, start: `${day}T09:00:00Z`, minutes: hours * 60, amount: hours * 14 });
  const overtime = (payrollRunId?: string) =>
    t.prisma.payrollRunLine.findMany({
      where: { lineType: 'OVERTIME', sourceType: 'OVERTIME', employeeId, ...(payrollRunId ? { payrollRunId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  const amounts = async (payrollRunId?: string) => (await overtime(payrollRunId)).map((l) => Number(l.amount));

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    const { payCardId } = await seedDefaultCards(t.prisma, 14);
    await t.prisma.payCardRule.create({
      data: { payCardId, label: 'Overtime', dayType: 'ANY', rateType: 'OVERTIME', amount: 1.5, enhancementMethod: 'MULTIPLIER', minimumMinutes: 600 } as never,
    });
    preparer = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.manage', 'payroll.scope.organisation'] });
    approver = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.close();
  });

  it('a week inside one run: only the hours above the threshold earn the premium', async () => {
    await work('2026-11-02', 6);
    await work('2026-11-03', 6);
    await work('2026-11-04', 2);
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);
    const [line] = await overtime(run);
    expect(Number(line.amount)).toBe(28); // 4 hours × £7.00 premium
    expect(line.minutes).toBe(240);
    expect(line.claimKey).toBe(`OVERTIME:${employeeId}:2026-11-02:1`);
    // Base pay stays in visit pay: the overtime hours are not paid at the full rate again.
    const visitPay = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run, lineType: 'VISIT_PAY' } });
    expect(visitPay.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(196);
  });

  it('a week divided between two runs, neither part above the threshold: the premium is paid by the second run', async () => {
    await work('2026-11-02', 6);
    const first = await newRun('2026-11-02', '2026-11-03');
    await calculate(first);
    expect(await amounts(first)).toEqual([]);
    await lock(first);

    await work('2026-11-04', 6);
    await work('2026-11-05', 2);
    const second = await newRun('2026-11-04', '2026-11-08');
    await calculate(second);
    expect(await amounts(second)).toEqual([28]); // 14 hours in the week, 4 above the threshold

    // Calculating again changes nothing.
    await calculate(second);
    expect(await amounts()).toEqual([28]);
  });

  it('a week divided between two runs, the first already above the threshold: the second pays only the rest', async () => {
    await work('2026-11-02', 6);
    await work('2026-11-03', 6);
    const first = await newRun('2026-11-02', '2026-11-03');
    await calculate(first);
    expect(await amounts(first)).toEqual([14]); // 2 hours above
    await lock(first);

    await work('2026-11-05', 2);
    const second = await newRun('2026-11-04', '2026-11-08');
    await calculate(second);
    const [rest] = await overtime(second);
    expect(Number(rest.amount)).toBe(14);
    expect(rest.minutes).toBe(120);
    expect(rest.claimKey).toBe(`OVERTIME:${employeeId}:2026-11-02:2`);
    expect(rest.description).toMatch(/£14\.00 of it already paid by an earlier run/);
    await lock(second);
    expect((await amounts()).reduce((a, b) => a + b, 0)).toBe(28);
  });

  it('two open runs covering parts of one week cannot both pay it: the second is held until the first is locked', async () => {
    await work('2026-11-02', 6);
    await work('2026-11-03', 6);
    const first = await newRun('2026-11-02', '2026-11-03');
    await calculate(first);
    await work('2026-11-05', 2);
    const second = await newRun('2026-11-04', '2026-11-08');
    await calculate(second);

    expect(await amounts(second)).toEqual([]);
    const [held] = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: second, sourceType: 'HELD_EARNING' } });
    expect(held.sourceRef).toBe(`HELD:WEEK:OVERTIME:${employeeId}:2026-11-02`);
    expect(held.exceptionMessage).toMatch(/is not locked yet\. Lock or recalculate that run, then recalculate this one/);
    // Approving and locking it now would skip the premium, so it is refused.
    await t.prisma.payrollRun.update({ where: { id: second }, data: { status: 'APPROVED' } });
    const refused = await post(approver, `/billing/payroll-runs/${second}/lock`);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/waiting for another pay run that covers part of the same week/);

    await lock(first);
    await calculate(second);
    expect(await amounts(second)).toEqual([14]);
  });

  it('a visit of a settled week approved late: a supplementary run pays the further premium once', async () => {
    await work('2026-11-02', 6);
    await work('2026-11-03', 6);
    const first = await newRun('2026-11-02', '2026-11-08');
    await calculate(first);
    await lock(first);
    expect(await amounts()).toEqual([14]);

    // Two more hours on the Wednesday of that week, approved after the run was locked.
    await work('2026-11-04', 2);
    const supplementary = await newRun('2026-11-02', '2026-11-08');
    await calculate(supplementary);
    expect(await amounts(supplementary)).toEqual([14]);
    const lines = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: supplementary, lineType: 'VISIT_PAY' } });
    expect(lines.map((l) => Number(l.amount))).toEqual([28]); // only the late visit
    await lock(supplementary);

    // A further run over the same dates finds nothing left to pay.
    const again = await newRun('2026-11-02', '2026-11-08');
    await calculate(again);
    expect(await t.prisma.payrollRunLine.count({ where: { payrollRunId: again } })).toBe(0);
  });

  it('each week is its own work period: hours are not carried from one week to the next', async () => {
    await work('2026-11-05', 6);
    await work('2026-11-09', 6); // the following Monday
    const run = await newRun('2026-11-02', '2026-11-15');
    await calculate(run);
    expect(await amounts(run)).toEqual([]);
  });

  it('the premium is worked out on the card base rate, whatever the visits themselves were paid', async () => {
    // A Saturday visit paid at an enhanced amount: the overtime premium does not multiply it.
    await work('2026-11-02', 6);
    await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-07T09:00:00Z', minutes: 360, amount: 126 });
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);
    const [line] = await overtime(run);
    expect(Number(line.unitAmount)).toBe(7);
    expect(Number(line.amount)).toBe(14); // 2 hours × £7.00
  });
});
