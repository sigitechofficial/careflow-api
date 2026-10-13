/**
 * Gate B2, Stage 4 — travel time is classified, not assumed (TR-01 / TR-04 / TR-05 / TR-06).
 *
 * Before: the gap between two visits was read as travel or waiting by its length alone. That is an
 * estimate. It stays as the fallback, now labelled as an estimate, and a person can record what
 * the time actually was: travel between service users, required waiting, a rest break, an
 * ordinary commute, a training journey, a journey to a cancelled visit, or something else. Once a
 * second person approves the intervals of a visit, they decide what the pay run pays.
 *
 * The travel and waiting rates here are SYNTHETIC POLICY. Decisions Q32 and D-19 are open.
 */
import request from 'supertest';
import { createApprovedVisit, resetPayData, uuid } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('travel-time intervals (synthetic rates)', () => {
  let t: TestApp;
  let officer: { id: string };
  let officer2: { id: string };
  let reader: { id: string };
  let employeeId: string;
  let payCardId: string;

  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));

  /** Two visits for different service users, 40 minutes apart: 09:00–10:00 and 10:40–11:40. */
  const twoVisits = async () => {
    const first = await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 14 });
    const second = await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-03T10:40:00Z', amount: 14 });
    await t.prisma.visitReconciliation.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { payCardId } });
    return { first, second };
  };
  const interval = (toVisitReconciliationId: string, category: string, startAt: string, endAt: string, over: Record<string, unknown> = {}) =>
    post(officer, '/billing/travel-intervals', {
      toVisitReconciliationId,
      category,
      evidence: 'RECORDED',
      startAt: `2026-11-03T${startAt}:00Z`,
      endAt: `2026-11-03T${endAt}:00Z`,
      note: 'Synthetic: reported by the carer',
      ...over,
    });
  const approve = async (id: string, by = officer2) => expect((await post(by, `/billing/travel-intervals/${id}/approve`)).status).toBe(201);
  const runLines = async () => {
    const created = await post(officer, '/billing/payroll-runs', { periodStart: '2026-11-02', periodEnd: '2026-11-08' });
    const run = created.body.data.id as string;
    expect((await post(officer, `/billing/payroll-runs/${run}/calculate`)).status).toBe(201);
    return t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run }, orderBy: { createdAt: 'asc' } });
  };
  const of = (lines: Array<{ lineType: string; minutes: number | null; amount: unknown; description: string }>, lineType: string) =>
    lines.filter((l) => l.lineType === lineType).map((l) => ({ minutes: l.minutes, amount: Number(l.amount), description: l.description }));

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    payCardId = (await seedDefaultCards(t.prisma, 14)).payCardId;
    // Synthetic rates: travel and waiting time each at £12.00 an hour.
    await t.prisma.payCardRule.createMany({
      data: [
        { payCardId, label: 'Travel time', dayType: 'ANY', rateType: 'TRAVEL_TIME', amount: 12 },
        { payCardId, label: 'Waiting time', dayType: 'ANY', rateType: 'WAITING_TIME', amount: 12 },
      ] as never,
    });
    const perms = ['billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', 'billing.payroll_runs.read', 'billing.payroll_runs.manage', 'payroll.scope.organisation'];
    officer = await createStaffUser(t.prisma, { permissions: perms });
    officer2 = await createStaffUser(t.prisma, { permissions: perms });
    reader = await createStaffUser(t.prisma, { permissions: ['billing.visit_reconciliations.read', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.close();
  });

  it('with nothing classified the gap is still paid as before, and is labelled as an estimate', async () => {
    const { second } = await twoVisits();
    const seen = (await get(reader, `/billing/travel-intervals/visit/${second.id}`)).body.data;
    expect(seen).toMatchObject({ basis: 'ESTIMATED_FROM_GAP', decided: null, intervals: [] });
    expect(seen.estimate).toMatchObject({ gapMinutes: 40, travelMinutes: 40 });

    const [travel] = of(await runLines(), 'TRAVEL_TIME');
    expect(travel).toMatchObject({ minutes: 40, amount: 8 });
    expect(travel.description).toMatch(/estimated from the gap between visits, not verified/);
  });

  it('approved intervals split the gap: travel and required waiting are paid, a rest break is not', async () => {
    const { second } = await twoVisits();
    const travel = await interval(second.id, 'BETWEEN_SERVICE_USERS', '10:00', '10:15', { evidence: 'VERIFIED' });
    const rest = await interval(second.id, 'REST_BREAK', '10:15', '10:30');
    const wait = await interval(second.id, 'REQUIRED_WAITING', '10:30', '10:40');
    expect(travel.status).toBe(201);
    for (const created of [travel, rest, wait]) await approve(created.body.data.id);

    const seen = (await get(reader, `/billing/travel-intervals/visit/${second.id}`)).body.data;
    expect(seen.basis).toBe('APPROVED_INTERVALS');
    expect(seen.decided).toMatchObject({ travelMinutes: 15, waitingMinutes: 10, notPaidMinutes: 15 });
    expect(seen.intervals.map((i: { category: string; paid: boolean }) => [i.category, i.paid])).toEqual([
      ['BETWEEN_SERVICE_USERS', true],
      ['REST_BREAK', false],
      ['REQUIRED_WAITING', true],
    ]);

    const lines = await runLines();
    expect(of(lines, 'TRAVEL_TIME')).toEqual([expect.objectContaining({ minutes: 15, amount: 3 })]);
    expect(of(lines, 'WAITING_TIME')).toEqual([expect.objectContaining({ minutes: 10, amount: 2 })]);
    expect(of(lines, 'TRAVEL_TIME')[0].description).toMatch(/approved: 15 min travel between service users \(verified\); 15 min rest break, not paid \(recorded\)/);
    // Travel time is time. Nothing here created or changed a mileage line.
    expect(of(lines, 'MILEAGE')).toEqual([]);
  });

  it('a gap approved as a rest break is not paid as travel at all', async () => {
    const { second } = await twoVisits();
    await approve((await interval(second.id, 'REST_BREAK', '10:00', '10:40')).body.data.id);
    const lines = await runLines();
    expect(of(lines, 'TRAVEL_TIME')).toEqual([]);
    expect(of(lines, 'WAITING_TIME')).toEqual([]);
    expect(of(lines, 'VISIT_PAY').map((l) => l.amount)).toEqual([14, 14]);
  });

  it('an interval changes nothing until a second person approves it', async () => {
    const { second } = await twoVisits();
    const created = await interval(second.id, 'REST_BREAK', '10:00', '10:40');
    expect(created.body.message).toMatch(/once a second person approves/);
    // Pending: the estimate still applies.
    expect(of(await runLines(), 'TRAVEL_TIME')[0]).toMatchObject({ minutes: 40 });

    const own = await post(officer, `/billing/travel-intervals/${created.body.data.id}/approve`);
    expect(own.status).toBe(403);
    expect(own.body.message).toMatch(/different user/);
    expect((await post(reader, `/billing/travel-intervals/${created.body.data.id}/approve`)).status).toBe(403);

    const rejected = await post(officer2, `/billing/travel-intervals/${created.body.data.id}/reject`, { note: 'Carer confirms she drove straight there' });
    expect(rejected.status).toBe(201);
    expect((await post(officer2, `/billing/travel-intervals/${created.body.data.id}/approve`)).status).toBe(400);
    const actions = (await t.prisma.auditLog.findMany({ where: { recordId: created.body.data.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['travel_interval_recorded', 'travel_interval_rejected']));
  });

  it('an ordinary commute is never paid; a training journey or a journey to a cancelled visit only when approved as payable', async () => {
    const first = await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 14 });
    await t.prisma.visitReconciliation.update({ where: { id: first.id }, data: { payCardId } });
    // Marking a commute payable has no effect.
    await approve((await interval(first.id, 'ORDINARY_COMMUTE', '08:30', '09:00', { payable: true })).body.data.id);
    expect(of(await runLines(), 'TRAVEL_TIME')).toEqual([]);

    await resetPayData(t.prisma);
    const visit = await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 14 });
    await t.prisma.visitReconciliation.update({ where: { id: visit.id }, data: { payCardId } });
    await approve((await interval(visit.id, 'CANCELLED_VISIT_JOURNEY', '08:00', '08:20')).body.data.id); // not payable
    await approve((await interval(visit.id, 'TRAINING_JOURNEY', '08:20', '08:50', { payable: true })).body.data.id);
    const [paid] = of(await runLines(), 'TRAVEL_TIME');
    expect(paid).toMatchObject({ minutes: 30, amount: 6 });
    expect(paid.description).toMatch(/20 min journey to a cancelled visit, not paid/);
  });

  it('refuses intervals that overlap, run backwards, or belong to a visit whose pay is settled', async () => {
    const { second } = await twoVisits();
    expect((await interval(second.id, 'BETWEEN_SERVICE_USERS', '10:00', '10:20')).status).toBe(201);
    expect((await interval(second.id, 'REST_BREAK', '10:10', '10:30')).body.message).toMatch(/already covers part of that time/);
    expect((await interval(second.id, 'REST_BREAK', '10:30', '10:25')).body.message).toMatch(/must end after it starts/);
    expect((await interval(second.id, 'REST_BREAK', '10:30', '12:30')).body.message).toMatch(/cannot end after the visit/);
    expect((await interval(second.id, 'HOLIDAY', '10:30', '10:35')).status).toBe(400);
    expect((await interval(uuid(), 'REST_BREAK', '10:30', '10:35')).status).toBe(404);

    const run = await t.prisma.payrollRun.create({
      data: { periodLabel: 'Synthetic locked run', periodStart: new Date('2026-11-02'), periodEnd: new Date('2026-11-08'), status: 'DRAFT' } as never,
    });
    await t.prisma.visitReconciliation.update({ where: { id: second.id }, data: { includedInPayrollRunId: run.id } });
    expect((await interval(second.id, 'REST_BREAK', '10:30', '10:35')).body.message).toMatch(/locked payroll run.*pay correction/);
  });
});
