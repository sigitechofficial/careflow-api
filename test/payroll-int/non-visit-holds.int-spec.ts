/**
 * Gate B2, R-22 — an earning outside visit pay that cannot be worked out is held and shown, never
 * left out. Audit IDs: VW-03, WM-18.
 *
 * Before: training, on-call, overtime premium and rolled-up holiday pay were skipped whenever the
 * pay card could not be read, had no rate for them, or the activity had no duration. Nothing on the
 * run said so, and a training activity of a period that was then locked was never paid.
 *
 * Real controllers, services and database. All people, cards and amounts are synthetic.
 */
import request from 'supertest';
import { PayCardsService } from '../../src/billing/billing-cards.service';
import { resetPayData, uuid } from './harness';
import {
  bearer,
  createAllocatedVisit,
  createCarer,
  createStaffUser,
  createTestApp,
  resetIdentityData,
  seedDefaultCards,
  TestApp,
  useControlledClock,
} from './http-harness';

type Carer = { employeeId: string; accountId: string };

describe('R-22: non-visit earnings that cannot be worked out are held, not dropped', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let preparer: { id: string };
  let approver: { id: string };
  let reader: { id: string };
  let payCardId: string;

  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);

  const work = async (carer: Carer, day: string, hm = '09:00', hours = 1) => {
    const start = new Date(`${day}T${hm}:00Z`);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start, plannedMinutes: hours * 60 });
    clock.set(new Date(start.getTime() + 60_000));
    await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(bearer(t.carerToken(carer.accountId))).send({});
    clock.set(new Date(start.getTime() + hours * 60 * 60_000));
    const done = await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(bearer(t.carerToken(carer.accountId))).send({ status: 'COMPLETED' });
    expect(done.status).toBe(201);
  };
  const activity = (carer: Carer, from: string, to: string, onCallForPeriod = false) =>
    t.prisma.employeeNonCoreActivity.create({
      data: { employeeId: carer.employeeId, dateFrom: new Date(from), dateTo: new Date(to), includeInPayroll: true, onCallForPeriod },
    });
  const rule = (rateType: string, amount: number) =>
    t.prisma.payCardRule.create({ data: { payCardId, label: rateType, dayType: 'ANY', rateType, amount } as never });
  const newRun = async (periodStart: string, periodEnd: string) => {
    const created = await post(preparer, '/billing/payroll-runs', { periodStart, periodEnd });
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  };
  const calculate = async (id: string) => expect((await post(preparer, `/billing/payroll-runs/${id}/calculate`)).status).toBe(201);
  const linesOf = (payrollRunId: string) => t.prisma.payrollRunLine.findMany({ where: { payrollRunId }, orderBy: { createdAt: 'asc' } });
  const heldOf = async (payrollRunId: string) => (await linesOf(payrollRunId)).filter((l) => l.sourceType === 'HELD_EARNING');
  const statusOf = async (id: string) => (await t.prisma.payrollRun.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(new Date('2026-11-02T08:00:00Z'));
    await resetPayData(t.prisma);
    await t.prisma.payEvaluationFailure.deleteMany();
    await t.prisma.visitAttendanceEvent.deleteMany();
    await t.prisma.employeeNonCoreActivity.deleteMany();
    await resetIdentityData(t.prisma);
    payCardId = (await seedDefaultCards(t.prisma, 14)).payCardId;
    preparer = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.manage', 'payroll.scope.organisation'] });
    approver = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', 'payroll.scope.organisation'] });
    reader = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read'], locationIds: [] });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.prisma.employeeNonCoreActivity.deleteMany();
    await t.close();
  });

  it('training on a card with no training rate: held with the reason, then paid once the rate exists', async () => {
    const ann = await createCarer(t.prisma);
    await work(ann, '2026-11-03');
    const training = await activity(ann, '2026-11-04T10:00:00Z', '2026-11-04T12:00:00Z');
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);

    const [held] = await heldOf(run);
    expect(held).toMatchObject({ employeeId: ann.employeeId, sourceRef: `HELD:ACTIVITY:${training.id}`, lineType: 'NON_VISIT_ACTIVITY', claimKey: null });
    expect(Number(held.amount)).toBe(0);
    expect(held.description).toContain('Not paid: training / activity');
    expect(held.exceptionMessage).toMatch(/has no training rate\. Add one, enter a pay item for this activity, or untick "include in payroll"/);
    expect(await statusOf(run)).toBe('EXCEPTION_FOUND');
    // The visit pay of the same carer is not held back by it.
    expect((await linesOf(run)).filter((l) => l.lineType === 'VISIT_PAY').map((l) => Number(l.amount))).toEqual([14]);

    await rule('TRAINING', 14);
    await calculate(run);
    expect(await heldOf(run)).toHaveLength(0);
    const paid = (await linesOf(run)).find((l) => l.sourceType === 'NON_CORE_ACTIVITY');
    expect(paid).toMatchObject({ sourceRef: training.id, claimKey: `NON_CORE_ACTIVITY:${training.id}`, minutes: 120 });
    expect(Number(paid!.amount)).toBe(28);
    expect(await statusOf(run)).toBe('READY_FOR_REVIEW');
  });

  it('on-call with no on-call rate, an activity with no duration, and a carer with no employment record are each held', async () => {
    const ann = await createCarer(t.prisma);
    const ben = await createCarer(t.prisma);
    await rule('TRAINING', 14);
    const onCall = await activity(ann, '2026-11-04T18:00:00Z', '2026-11-05T08:00:00Z', true);
    const empty = await activity(ann, '2026-11-05T10:00:00Z', '2026-11-05T10:00:00Z');
    const noRecord = await activity(ben, '2026-11-04T10:00:00Z', '2026-11-04T11:00:00Z');
    await t.prisma.employeeEmployment.deleteMany({ where: { employeeId: ben.employeeId } });
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);

    const held = Object.fromEntries((await heldOf(run)).map((l) => [l.sourceRef, l]));
    expect(Object.keys(held).sort()).toEqual([onCall.id, empty.id, noRecord.id].map((id) => `HELD:ACTIVITY:${id}`).sort());
    expect(held[`HELD:ACTIVITY:${onCall.id}`]).toMatchObject({ lineType: 'ON_CALL_STANDBY' });
    expect(held[`HELD:ACTIVITY:${onCall.id}`].exceptionMessage).toContain('has no on-call rate');
    expect(held[`HELD:ACTIVITY:${empty.id}`].exceptionMessage).toBe('The activity has no duration (its end is not after its start). Correct its times.');
    expect(held[`HELD:ACTIVITY:${noRecord.id}`]).toMatchObject({ employeeId: ben.employeeId, exceptionMessage: 'Employee employment record not found' });
    expect((await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: run } })).exceptionCount).toBe(3);
  });

  it('an unexpected error while reading the pay card: held with a safe message, and the next calculation tries again', async () => {
    const ann = await createCarer(t.prisma);
    await rule('TRAINING', 14);
    const training = await activity(ann, '2026-11-04T10:00:00Z', '2026-11-04T12:00:00Z');
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const run = await newRun('2026-11-02', '2026-11-08');
    jest
      .spyOn(t.app.get(PayCardsService), 'resolveRulesForEmployeeAt')
      .mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2 NI QQ123456C'));
    await calculate(run);

    const [held] = await heldOf(run);
    expect(held.sourceRef).toBe(`HELD:ACTIVITY:${training.id}`);
    // The reason says something went wrong and nothing about what the error contained.
    expect(held.exceptionMessage).toBeTruthy();
    for (const leaked of ['ECONNREFUSED', '10.1.2.3', 'hunter2', 'QQ123456C']) expect(held.exceptionMessage).not.toContain(leaked);

    jest.restoreAllMocks();
    await calculate(run);
    expect(await heldOf(run)).toHaveLength(0);
    expect((await linesOf(run)).filter((l) => l.sourceType === 'NON_CORE_ACTIVITY').map((l) => Number(l.amount))).toEqual([28]);
  });

  it('an activity held in a locked run is carried into later runs and paid once, when it can be', async () => {
    const ann = await createCarer(t.prisma);
    await work(ann, '2026-11-03');
    const training = await activity(ann, '2026-11-04T10:00:00Z', '2026-11-04T12:00:00Z');
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const first = await newRun('2026-11-02', '2026-11-08');
    await calculate(first);
    expect(await heldOf(first)).toHaveLength(1);
    // The run can still be approved and locked: the visit pay in it is right, and the activity stays payable.
    expect((await post(approver, `/billing/payroll-runs/${first}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${first}/lock`)).status).toBe(201);
    const list = await get(preparer, '/billing/payroll-runs/held-earnings');
    expect(list.status).toBe(200);
    expect(list.body.meta.open).toBe(1);
    expect(list.body.data[0]).toMatchObject({ kind: 'ACTIVITY', subjectId: training.id, employeeId: ann.employeeId, state: 'OPEN', payrollRunId: first });

    // The following week it still cannot be priced: held again, not forgotten.
    await work(ann, '2026-11-10');
    clock.set(new Date('2026-11-16T09:00:00Z'));
    const second = await newRun('2026-11-09', '2026-11-15');
    await calculate(second);
    expect((await heldOf(second)).map((l) => l.sourceRef)).toEqual([`HELD:ACTIVITY:${training.id}`]);

    // The card gets a training rate: the run for the later week pays the earlier activity.
    await rule('TRAINING', 14);
    await calculate(second);
    expect(await heldOf(second)).toHaveLength(0);
    const paid = (await linesOf(second)).filter((l) => l.sourceType === 'NON_CORE_ACTIVITY');
    expect(paid.map((l) => [l.sourceRef, Number(l.amount)])).toEqual([[training.id, 28]]);
    expect((await post(approver, `/billing/payroll-runs/${second}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${second}/lock`)).status).toBe(201);

    // Paid once: a third run finds nothing, and the list shows which run paid it.
    clock.set(new Date('2026-11-23T09:00:00Z'));
    const third = await newRun('2026-11-16', '2026-11-22');
    await calculate(third);
    expect(await linesOf(third)).toHaveLength(0);
    const after = await get(preparer, '/billing/payroll-runs/held-earnings');
    expect(after.body.meta.open).toBe(0);
    expect(after.body.data.find((d: { payrollRunId: string }) => d.payrollRunId === first)).toMatchObject({ state: 'PAID', paidByRunId: second });
  });

  it('an activity that is no longer marked as payable is not carried forward', async () => {
    const ann = await createCarer(t.prisma);
    await work(ann, '2026-11-03');
    const training = await activity(ann, '2026-11-04T10:00:00Z', '2026-11-04T12:00:00Z');
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const first = await newRun('2026-11-02', '2026-11-08');
    await calculate(first);
    expect((await post(approver, `/billing/payroll-runs/${first}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${first}/lock`)).status).toBe(201);
    await t.prisma.employeeNonCoreActivity.update({ where: { id: training.id }, data: { includeInPayroll: false } });

    clock.set(new Date('2026-11-16T09:00:00Z'));
    const second = await newRun('2026-11-09', '2026-11-15');
    await calculate(second);
    expect(await linesOf(second)).toHaveLength(0);
    const list = await get(preparer, '/billing/payroll-runs/held-earnings');
    expect(list.body.data[0]).toMatchObject({ state: 'WITHDRAWN' });
    expect(list.body.meta.open).toBe(0);
  });

  it('overtime premium and rolled-up holiday pay that cannot be worked out stop the lock', async () => {
    const ann = await createCarer(t.prisma);
    await work(ann, '2026-11-03');
    // After the visit was priced, a second organisation default appears: the carer's card can no longer be decided.
    const second = await t.prisma.payCard.create({
      data: {
        name: 'Synthetic second default',
        code: `TEST-2ND-${uuid().slice(0, 6)}`.toUpperCase(),
        assignmentLevel: 'ORGANISATION_DEFAULT',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        rules: { create: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: 16 }] },
      } as never,
    });
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);

    const [held] = await heldOf(run);
    expect(held).toMatchObject({ employeeId: ann.employeeId, sourceRef: `HELD:CARD:${ann.employeeId}`, description: 'Not worked out: overtime premium and rolled-up holiday pay' });
    expect(held.exceptionMessage).toContain('Two pay cards apply to this carer');
    // The visit pay, priced before the conflict, is in the run as approved.
    expect((await linesOf(run)).filter((l) => l.lineType === 'VISIT_PAY').map((l) => Number(l.amount))).toEqual([14]);

    expect((await post(approver, `/billing/payroll-runs/${run}/approve`)).status).toBe(201);
    const refused = await post(approver, `/billing/payroll-runs/${run}/lock`);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('Overtime premium and rolled-up holiday pay could not be worked out for 1 carer(s)');

    await t.prisma.payCard.update({ where: { id: second.id }, data: { effectiveTo: new Date('2026-10-31') } });
    await calculate(run);
    expect(await heldOf(run)).toHaveLength(0);
    expect((await post(approver, `/billing/payroll-runs/${run}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${run}/lock`)).status).toBe(201);
  });

  it('an approved pay item of a type the pay run does not know is held, not skipped', async () => {
    const ann = await createCarer(t.prisma);
    const item = await t.prisma.employeePayItem.create({
      data: {
        employeeId: ann.employeeId,
        wageTypeCode: 'RETIRED_TYPE',
        workDate: new Date('2026-11-04'),
        unit: 'AMOUNT',
        amount: 30,
        reason: 'Synthetic: entered under a type that no longer exists',
        status: 'APPROVED',
      } as never,
    });
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const run = await newRun('2026-11-02', '2026-11-08');
    await calculate(run);
    const [held] = await heldOf(run);
    expect(held).toMatchObject({ employeeId: ann.employeeId, sourceRef: `HELD:PAY_ITEM:${item.id}`, employeePayItemId: null });
    expect(held.exceptionMessage).toContain('Pay item type "RETIRED_TYPE" is not one the pay run can pay');
    // Not claimed and not marked as paid: it stays an approved item.
    expect((await t.prisma.employeePayItem.findUniqueOrThrow({ where: { id: item.id } })).includedInPayrollRunId).toBeNull();
  });

  it('the list of held earnings is for users with organisation-wide pay access', async () => {
    expect((await get(reader, '/billing/payroll-runs/held-earnings')).status).toBe(403);
    expect((await request(server()).get('/billing/payroll-runs/held-earnings')).status).toBe(401);
  });
});
