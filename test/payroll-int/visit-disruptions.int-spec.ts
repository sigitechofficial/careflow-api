/**
 * Gate B2, Stage 4 — cancellations, no access and emergency care (policy decision Q13).
 *
 * Before: a cancelled visit produced nothing for the carer and nothing said so. What is paid when
 * a visit does not go ahead as planned is the employer's policy, so nothing is assumed here —
 * including "no pay". An event is recorded for the carer; an approved rule proposes the amount,
 * or a person decides; a second person approves; an amount is paid once through a pay item.
 *
 * Every rule in this file is SYNTHETIC POLICY (isSynthetic: true). None is Allfor Care's.
 */
import request from 'supertest';
import { resetPayData, uuid } from './harness';
import { bearer, createAllocatedVisit, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('Q13: pay for visits that do not go ahead as planned (synthetic rules)', () => {
  let t: TestApp;
  let officer: { id: string };
  let officer2: { id: string };
  let reader: { id: string };
  let employeeId: string;

  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));

  const rule = async (body: Record<string, unknown>) => {
    const created = await post(officer, '/billing/visit-disruptions/rules', { effectiveFrom: '2026-01-01', isSynthetic: true, ...body });
    expect(created.status).toBe(201);
    expect((await post(officer2, `/billing/visit-disruptions/rules/${created.body.data.id}/approve`)).status).toBe(201);
    return created.body.data.id as string;
  };
  const event = (body: Record<string, unknown> = {}, by = officer) =>
    post(by, '/billing/visit-disruptions', {
      employeeId,
      scheduledJobId: uuid(),
      eventType: 'LATE_CANCELLATION',
      eventAt: '2026-11-03T09:00:00Z',
      noticeMinutes: 60,
      scheduledMinutes: 60,
      reason: 'Synthetic: client rang at 08:00',
      ...body,
    });
  const payLines = async () => {
    const created = await post(officer, '/billing/payroll-runs', { periodStart: '2026-11-02', periodEnd: '2026-11-08' });
    const run = created.body.data.id as string;
    expect((await post(officer, `/billing/payroll-runs/${run}/calculate`)).status).toBe(201);
    return { run, lines: await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run } }) };
  };

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma, 14);
    const perms = ['billing.payroll_runs.read', 'billing.payroll_runs.manage', 'billing.pay_cards.read', 'billing.pay_cards.manage', 'payroll.scope.organisation'];
    officer = await createStaffUser(t.prisma, { permissions: perms });
    officer2 = await createStaffUser(t.prisma, { permissions: perms });
    reader = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.close();
  });

  it('with no rule a cancelled visit is not "no pay": it waits for a person, and cannot be approved empty', async () => {
    const recorded = await event();
    expect(recorded.status).toBe(201);
    expect(recorded.body.data).toMatchObject({ status: 'NEEDS_DECISION', proposedOutcome: 'NOT_DECIDED', amount: null, hourlyRate: 14 });
    expect(recorded.body.message).toMatch(/No approved rule covers this event\. A person decides what is paid/);
    const id = recorded.body.data.id as string;
    expect((await post(officer2, `/billing/visit-disruptions/${id}/approve`)).body.message).toMatch(/Record what is to be paid/);

    // A person decides; zero is allowed, with its reason, and is still approved by someone else.
    const decided = await post(officer, `/billing/visit-disruptions/${id}/decide`, { amount: 7, note: 'Half the visit, agreed with the manager' });
    expect(decided.body.data).toMatchObject({ status: 'PENDING_APPROVAL', amount: 7 });
    expect((await post(officer, `/billing/visit-disruptions/${id}/approve`)).status).toBe(403);
    const approved = await post(officer2, `/billing/visit-disruptions/${id}/approve`);
    expect(approved.status).toBe(201);
    expect(approved.body.message).toMatch(/£7\.00 approved\. It is paid in the next visit pay run/);

    const { lines } = await payLines();
    expect(lines.map((l) => [l.lineType, Number(l.amount), l.claimKey])).toEqual([
      ['CANCELLATION', 7, `PAY_ITEM:${approved.body.data.payItemId}`],
    ]);
  });

  it('a rule by notice: under two hours the scheduled visit is paid in full, under a day half of it, otherwise nothing', async () => {
    await rule({ eventType: 'LATE_CANCELLATION', noticeBelowMinutes: 120, outcome: 'FULL_SCHEDULED' });
    await rule({ eventType: 'LATE_CANCELLATION', noticeBelowMinutes: 1440, outcome: 'PERCENT_OF_SCHEDULED', percent: 50 });
    await rule({ eventType: 'LATE_CANCELLATION', outcome: 'NO_PAY' });

    const short = await event({ noticeMinutes: 60 });
    expect(short.body.data).toMatchObject({ status: 'PENDING_APPROVAL', proposedOutcome: 'FULL_SCHEDULED', amount: 14 });
    const medium = await event({ noticeMinutes: 600, scheduledMinutes: 90 });
    expect(medium.body.data).toMatchObject({ proposedOutcome: 'PERCENT_OF_SCHEDULED', amount: 10.5 });
    const long = await event({ noticeMinutes: 4000 });
    expect(long.body.data).toMatchObject({ status: 'PENDING_APPROVAL', proposedOutcome: 'NO_PAY', amount: 0 });

    for (const recorded of [short, medium, long]) {
      expect((await post(officer2, `/billing/visit-disruptions/${recorded.body.data.id}/approve`)).status).toBe(201);
    }
    // "No pay" under a rule is a recorded decision; it creates no pay item.
    expect((await t.prisma.visitDisruptionPayDecision.findUniqueOrThrow({ where: { id: long.body.data.id } })).payItemId).toBeNull();
    const { lines } = await payLines();
    expect(lines.map((l) => Number(l.amount)).sort((a, b) => a - b)).toEqual([10.5, 14]);
  });

  it('each kind of event has its own rule: travelling, nobody home, emergency, cut short, waiting', async () => {
    await rule({ eventType: 'CARER_ALREADY_TRAVELLING', outcome: 'FIXED_AMOUNT', fixedAmount: 6 });
    await rule({ eventType: 'NOBODY_HOME', outcome: 'FULL_SCHEDULED' });
    await rule({ eventType: 'EMERGENCY_VISIT', outcome: 'FIXED_AMOUNT', fixedAmount: 10 });
    await rule({ eventType: 'ENDED_EARLY', outcome: 'HOURLY_FOR_AFFECTED_MINUTES' });
    await rule({ eventType: 'ADDITIONAL_WAITING', outcome: 'HOURLY_FOR_AFFECTED_MINUTES' });

    const amounts: Record<string, number | null> = {};
    for (const [eventType, extra] of [
      ['CARER_ALREADY_TRAVELLING', {}],
      ['NOBODY_HOME', { scheduledMinutes: 45 }],
      ['EMERGENCY_VISIT', {}],
      ['ENDED_EARLY', { affectedMinutes: 30 }],
      ['ADDITIONAL_WAITING', { affectedMinutes: 15 }],
      ['REPLACEMENT_WORKER', {}], // no rule recorded for it
    ] as const) {
      amounts[eventType] = (await event({ eventType, ...extra })).body.data.amount;
    }
    expect(amounts).toEqual({
      CARER_ALREADY_TRAVELLING: 6,
      NOBODY_HOME: 10.5,
      EMERGENCY_VISIT: 10,
      ENDED_EARLY: 7,
      ADDITIONAL_WAITING: 3.5,
      REPLACEMENT_WORKER: null,
    });
  });

  it('a rule that cannot be worked out from what is known is left to a person', async () => {
    await rule({ eventType: 'NOBODY_HOME', outcome: 'FULL_SCHEDULED' });
    const recorded = await event({ eventType: 'NOBODY_HOME', scheduledMinutes: undefined });
    expect(recorded.body.data).toMatchObject({ status: 'NEEDS_DECISION', proposedOutcome: 'FULL_SCHEDULED', amount: null });
    expect(recorded.body.message).toMatch(/needs the scheduled length of the visit/);
  });

  it('a rule applies only after a second person approves it, and stops when retired', async () => {
    const draft = await post(officer, '/billing/visit-disruptions/rules', { eventType: 'NOBODY_HOME', outcome: 'FULL_SCHEDULED', effectiveFrom: '2026-01-01', isSynthetic: true });
    const id = draft.body.data.id as string;
    expect((await event({ eventType: 'NOBODY_HOME' })).body.data.status).toBe('NEEDS_DECISION');
    expect((await post(officer, `/billing/visit-disruptions/rules/${id}/approve`)).status).toBe(403);
    expect((await post(reader, `/billing/visit-disruptions/rules/${id}/approve`)).status).toBe(403);
    expect((await post(officer2, `/billing/visit-disruptions/rules/${id}/approve`)).status).toBe(201);
    expect((await event({ eventType: 'NOBODY_HOME' })).body.data.status).toBe('PENDING_APPROVAL');

    expect((await post(officer2, `/billing/visit-disruptions/rules/${id}/retire`)).status).toBe(201);
    expect((await event({ eventType: 'NOBODY_HOME' })).body.data.status).toBe('NEEDS_DECISION');
    const rules = (await get(reader, '/billing/visit-disruptions/rules')).body.data;
    expect(rules).toEqual([expect.objectContaining({ id, status: 'RETIRED', isSynthetic: true })]);
    expect((await post(officer, '/billing/visit-disruptions/rules', { eventType: 'NOBODY_HOME', outcome: 'PERCENT_OF_SCHEDULED', effectiveFrom: '2026-01-01' })).body.message).toMatch(
      /Enter the percentage/,
    );
  });

  it('one event is recorded once per carer and visit, and paid once', async () => {
    await rule({ eventType: 'NOBODY_HOME', outcome: 'FULL_SCHEDULED' });
    const scheduledJobId = uuid();
    const first = await event({ eventType: 'NOBODY_HOME', scheduledJobId });
    expect((await event({ eventType: 'NOBODY_HOME', scheduledJobId })).body.message).toMatch(/already recorded/);
    await post(officer2, `/billing/visit-disruptions/${first.body.data.id}/approve`);
    expect((await post(officer2, `/billing/visit-disruptions/${first.body.data.id}/approve`)).status).toBe(400);

    const { run, lines } = await payLines();
    expect(lines).toHaveLength(1);
    const approver = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', 'payroll.scope.organisation'] });
    expect((await post(approver, `/billing/payroll-runs/${run}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${run}/lock`)).status).toBe(201);
    // A later run finds nothing more to pay for it.
    expect((await payLines()).lines).toHaveLength(0);

    // An event recorded in error is rejected, and may then be recorded again correctly.
    const wrong = await event({ eventType: 'NOBODY_HOME' });
    expect((await post(officer2, `/billing/visit-disruptions/${wrong.body.data.id}/reject`, { note: 'Recorded against the wrong visit' })).status).toBe(201);
    const listed = (await get(reader, '/billing/visit-disruptions?status=REJECTED')).body.data;
    expect(listed).toEqual([expect.objectContaining({ id: wrong.body.data.id, eventLabel: 'Nobody home / no access' })]);
  });

  it('lists cancelled visits that had a carer allocated and have no pay decision', async () => {
    const visit = await createAllocatedVisit(t.prisma, { carers: [employeeId], start: new Date('2026-11-03T09:00:00Z'), plannedMinutes: 60 });
    const job = await t.prisma.scheduledJob.findUniqueOrThrow({ where: { id: visit.jobId } });
    await t.prisma.scheduledJobCancellation.create({
      data: {
        scheduledJobId: job.id,
        serviceUserId: job.serviceUserId,
        outcome: 'CANCELLED',
        reasonCode: 'CLIENT_REQUEST',
        chargeDecision: 'NO_CHARGE',
        cancelledAt: new Date(),
      } as never,
    });
    const before = (await get(reader, '/billing/visit-disruptions/undecided-cancellations')).body.data as Array<Record<string, unknown>>;
    expect(before.filter((c) => c.scheduledJobId === job.id)).toEqual([
      expect.objectContaining({ employeeId, scheduledMinutes: 60, reasonCode: 'CLIENT_REQUEST' }),
    ]);

    await event({ eventType: 'CLIENT_CANCELLED', scheduledJobId: job.id });
    const after = (await get(reader, '/billing/visit-disruptions/undecided-cancellations')).body.data as Array<Record<string, unknown>>;
    expect(after.filter((c) => c.scheduledJobId === job.id)).toEqual([]);
    await t.prisma.scheduledJobCancellation.deleteMany({ where: { scheduledJobId: job.id } });
  });

  it('requires permission to record or decide', async () => {
    expect((await event({}, reader)).status).toBe(403);
    expect((await request(server()).get('/billing/visit-disruptions')).status).toBe(401);
  });
});
