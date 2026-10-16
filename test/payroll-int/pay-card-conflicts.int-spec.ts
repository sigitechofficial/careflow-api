/**
 * Gate B sprint, PC-32 — a carer between two pay cards is not paid on whichever card was edited
 * last. Audit ID: PC-32.
 *
 * Before: when two active cards matched a carer at the same level (two organisation defaults, two
 * cards for one role, …) the most recently updated card was used, without a word to anyone.
 * Now nothing is chosen: the visit is held with the cards named, the pay run says what it could
 * not calculate, and the pay card screens show who is affected.
 *
 * Real services, controllers and database. All people, cards and visits are synthetic.
 */
import request from 'supertest';
import { PayCardsService } from '../../src/billing/billing-cards.service';
import { PayCardConflictException } from '../../src/billing/pay-card-assignment.util';
import { assignmentsCoveringDay } from '../../src/billing/employee-pay-card-assignment.util';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { createCompletedVisit, resetPayData, uuid } from './harness';
import {
  bearer,
  createAllocatedVisit,
  createBranch,
  createCarer,
  createStaffUser,
  createTestApp,
  resetIdentityData,
  seedDefaultCards,
  TestApp,
  useControlledClock,
} from './http-harness';

const CARDS = ['billing.pay_cards.read', 'billing.pay_cards.manage'];
const RUNS = ['billing.payroll_runs.read', 'billing.payroll_runs.manage'];
const RECON = ['billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage'];
const ORG = 'payroll.scope.organisation';

type Carer = { employeeId: string; accountId: string };

describe('PC-32: conflicting pay cards are reported, not resolved by the last edit', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let payCards: PayCardsService;
  let recons: VisitReconciliationsService;
  let office: { id: string };
  let defaultCardId: string;
  let branch: string;

  const NOW = new Date('2026-11-03T08:00:00Z'); // Tuesday; November is GMT, local = UTC
  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const asCarer = (c: Carer) => bearer(t.carerToken(c.accountId));
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const patch = (user: { id: string }, path: string, body: Record<string, unknown>) =>
    request(server()).patch(path).set(as(user)).send(body);

  /** An active synthetic pay card paying `rate` an hour on any day. */
  const card = (rate: number, over: Record<string, unknown> = {}) =>
    t.prisma.payCard.create({
      data: {
        name: `Synthetic £${rate}`,
        code: `TEST-${rate}-${uuid().slice(0, 6)}`.toUpperCase(),
        assignmentLevel: 'ORGANISATION_DEFAULT',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        ...over,
        rules: { create: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: rate }] },
      } as never,
    });
  const employment = (carer: Carer, data: Record<string, unknown>) =>
    t.prisma.employeeEmployment.updateMany({ where: { employeeId: carer.employeeId }, data: data as never });
  /** Prices a completed one-hour visit for the carer and returns the reconciliation row. */
  const price = async (carer: Carer, start = '2026-11-03T09:00:00Z', minutes = 60) => {
    const visit = await createCompletedVisit(t.prisma, { start, plannedMinutes: minutes, employeeId: carer.employeeId });
    const id = (await recons.ensureForVisit(visit.visitId))!;
    return t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id }, include: { exceptions: true } });
  };
  const again = async (id: string) => {
    expect((await post(office, `/billing/visit-reconciliations/${id}/evaluate`)).status).toBe(201);
    return t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id }, include: { exceptions: true } });
  };
  const cardProblem = (row: { exceptions: Array<{ code: string; message: string | null }> }) =>
    row.exceptions.find((e) => e.code === 'PAY_CARD_MISSING')?.message ?? null;
  const conflictOf = (carer: Carer, at: Date = NOW, funderId?: string) =>
    payCards.resolveForEmployee(carer.employeeId, at, { funderId }).then(
      (resolved) => ({ card: resolved.data.payCard?.id ?? null, source: resolved.data.source, conflict: null }),
      (err) => {
        if (!(err instanceof PayCardConflictException)) throw err;
        return { card: null, source: 'CONFLICT', conflict: err.conflict };
      },
    );

  beforeAll(async () => {
    t = await createTestApp();
    payCards = t.app.get(PayCardsService);
    recons = t.app.get(VisitReconciliationsService);
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(NOW);
    await resetPayData(t.prisma);
    await t.prisma.payEvaluationFailure.deleteMany();
    await t.prisma.visitAttendanceEvent.deleteMany();
    await t.prisma.employeeNonCoreActivity.deleteMany();
    await resetIdentityData(t.prisma);
    defaultCardId = (await seedDefaultCards(t.prisma)).payCardId; // organisation default, £14
    office = await createStaffUser(t.prisma, { permissions: [...CARDS, ...RUNS, ...RECON, ORG] });
    branch = await createBranch(t.prisma, 'PC32');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.close();
  });

  it('two organisation defaults: the visit is held with both cards named, and priced once one is ended', async () => {
    const carer = await createCarer(t.prisma, { locationId: branch });
    const second = await card(16);
    const first = await t.prisma.payCard.findUniqueOrThrow({ where: { id: defaultCardId } });

    const row = await price(carer);
    expect(row).toMatchObject({ status: 'PENDING_REVIEW', payableAmount: null });
    expect(Number(row.billableAmount)).toBe(24); // the client charge does not wait for the pay card
    const reason = cardProblem(row)!;
    expect(reason).toContain('Carer pay cannot be priced: Two pay cards apply to this carer on 2026-11-03 at the same level (organisation default)');
    expect(reason).toContain(first.code);
    expect(reason).toContain(second.code);
    expect(reason).toContain('No card is chosen');

    // The order the cards were edited in no longer decides anything.
    await t.prisma.payCard.update({ where: { id: defaultCardId }, data: { notes: 'edited last' } });
    expect((await again(row.id)).payableAmount).toBeNull();

    // The carer's screen shows the conflict as information, not as an error.
    const resolved = await get(office, `/billing/pay-cards/resolve/${carer.employeeId}`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ source: 'CONFLICT', payCard: null, matchedLevel: 'ORGANISATION_DEFAULT' });
    expect(resolved.body.data.conflict.cards.map((c: { code: string }) => c.code).sort()).toEqual([first.code, second.code].sort());

    // The office's list of carers who cannot be paid.
    const list = await get(office, `/billing/pay-cards/conflicts?locationId=${branch}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toMatchObject({ day: '2026-11-03', carerCount: 1 });
    expect(list.body.data.groups[0]).toMatchObject({ level: 'ORGANISATION_DEFAULT', carerCount: 1 });
    expect(list.body.data.groups[0].carers[0].employeeId).toBe(carer.employeeId);

    // Ending one card before the visit date settles it; the visit is priced on the remaining card.
    expect((await patch(office, `/billing/pay-cards/${second.id}`, { effectiveTo: '2026-11-02' })).status).toBe(200);
    const fixed = await again(row.id);
    expect(Number(fixed.payableAmount)).toBe(14);
    expect(fixed.payCardId).toBe(defaultCardId);
    expect(cardProblem(fixed)).toBeNull();
    expect((await get(office, `/billing/pay-cards/conflicts?locationId=${branch}`)).body.data.carerCount).toBe(0);
  });

  it('two cards for one role: carers in that role are held, other carers are paid as before', async () => {
    const role = await t.prisma.employeeRoleLookup.create({ data: { name: `TEST role ${uuid().slice(0, 8)}` } });
    const inRole = await createCarer(t.prisma);
    const other = await createCarer(t.prisma);
    await employment(inRole, { roleId: role.id });
    const a = await card(15, { assignmentLevel: 'ROLE', assignmentTargetId: role.id });

    // One role card: it wins over the organisation default.
    expect(Number((await price(inRole)).payableAmount)).toBe(15);

    const b = await card(17, { assignmentLevel: 'ROLE', assignmentTargetId: role.id });
    const held = await price(inRole, '2026-11-03T11:00:00Z');
    expect(held.payableAmount).toBeNull();
    expect(cardProblem(held)).toContain('at the same level (role)');
    expect(cardProblem(held)).toContain(a.code);
    expect(cardProblem(held)).toContain(b.code);
    expect(Number((await price(other)).payableAmount)).toBe(14);
  });

  it('two branch cards: the same branch twice, and a carer who belongs to two branches', async () => {
    const branchB = await createBranch(t.prisma, 'PC32-B');
    const oneBranch = await createCarer(t.prisma, { locationId: branchB });
    const twoBranches = await createCarer(t.prisma, { locationId: branch });
    await employment(twoBranches, { baseLocationId: branchB });
    const cardA = await card(15, { assignmentLevel: 'BRANCH', assignmentTargetId: branch });
    const cardB = await card(16, { assignmentLevel: 'BRANCH', assignmentTargetId: branchB });

    // A carer of one branch has one branch card.
    expect(Number((await price(oneBranch)).payableAmount)).toBe(16);
    // A carer whose working branch and base branch each have a card: the rate is not guessed.
    const held = await price(twoBranches);
    expect(held.payableAmount).toBeNull();
    expect(cardProblem(held)).toContain('at the same level (branch)');
    expect(cardProblem(held)).toContain(cardA.code);
    expect(cardProblem(held)).toContain(cardB.code);

    // A second card for branch B now also holds the carer of that branch alone.
    await card(18, { assignmentLevel: 'BRANCH', assignmentTargetId: branchB });
    expect((await price(oneBranch, '2026-11-03T11:00:00Z')).payableAmount).toBeNull();
  });

  it('individual against branch: the more specific card wins, and a carer with their own card is never in conflict', async () => {
    const carer = await createCarer(t.prisma, { locationId: branch });
    await card(15, { assignmentLevel: 'BRANCH', assignmentTargetId: branch });
    expect(Number((await price(carer)).payableAmount)).toBe(15);

    // A card for this one carer outranks the branch card.
    await card(18, { assignmentLevel: 'INDIVIDUAL', assignmentTargetId: carer.employeeId });
    expect(await conflictOf(carer)).toMatchObject({ source: 'MATCHED', conflict: null });
    expect(Number((await price(carer, '2026-11-03T11:00:00Z')).payableAmount)).toBe(18);

    // A carer given a card by name is paid on it even while the organisation has two defaults.
    const named = await createCarer(t.prisma);
    await card(16);
    expect((await conflictOf(named)).source).toBe('CONFLICT');
    const own = await card(20);
    const change = await post(office, `/billing/pay-cards/employee-history/${named.employeeId}/change`, {
      payCardId: own.id,
      effectiveFrom: '2026-11-01',
      reason: 'Synthetic: placed on a named card',
    });
    expect(change.status).toBe(201);
    expect(await conflictOf(named)).toMatchObject({ source: 'EXPLICIT', card: own.id });
    expect(Number((await price(named)).payableAmount)).toBe(20);
  });

  it('a conflict does not stop the office giving the carer a personal card, which ends it', async () => {
    const carer = await createCarer(t.prisma);
    await card(16);
    expect((await conflictOf(carer)).source).toBe('CONFLICT');
    const held = await price(carer);
    expect(held.payableAmount).toBeNull();

    const change = await post(office, `/billing/pay-cards/employee-history/${carer.employeeId}/change`, {
      personalCard: { name: 'Synthetic personal card', code: `TEST-IND-${uuid().slice(0, 6)}`.toUpperCase(), rules: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: 19 }] },
      effectiveFrom: '2026-11-01',
      reason: 'Synthetic: personal card to settle a conflict',
    });
    expect(change.status).toBe(201);
    expect(Number((await again(held.id)).payableAmount)).toBe(19);
  });

  it('funder override against the normal card: the override wins; two overrides for one day are a conflict', async () => {
    const carer = await createCarer(t.prisma);
    const funder = await t.prisma.funder.create({ data: { name: `TEST funder ${uuid().slice(0, 6)}` } });
    const funderCard = await card(21, { assignmentLevel: 'CLIENT_FUNDER', assignmentTargetId: funder.id });
    const created = await post(office, '/billing/pay-cards/employee-funder-assignments', {
      employeeId: carer.employeeId,
      funderId: funder.id,
      payCardId: funderCard.id,
      effectiveFrom: '2026-01-01',
    });
    expect(created.status).toBe(201);

    // Work for that funder is paid on the override; other work on the normal card.
    expect(await conflictOf(carer, NOW, funder.id)).toMatchObject({ source: 'EMPLOYEE_FUNDER', card: funderCard.id });
    expect(await conflictOf(carer)).toMatchObject({ source: 'MATCHED', card: defaultCardId });

    // The override is the more specific instruction: it still applies when the normal cards conflict.
    await card(16);
    expect((await conflictOf(carer)).source).toBe('CONFLICT');
    expect(await conflictOf(carer, NOW, funder.id)).toMatchObject({ source: 'EMPLOYEE_FUNDER', card: funderCard.id });

    // Two overrides covering the same day (possible in data written before the lock): reported.
    const otherFunderCard = await card(23, { assignmentLevel: 'CLIENT_FUNDER', assignmentTargetId: funder.id });
    await t.prisma.employeeFunderPayAssignment.create({
      data: { employeeId: carer.employeeId, funderId: funder.id, payCardId: otherFunderCard.id, effectiveFrom: new Date('2026-06-01') },
    });
    const clash = await conflictOf(carer, NOW, funder.id);
    expect(clash.conflict).toMatchObject({ kind: 'FUNDER_OVERRIDE', day: '2026-11-03' });
    expect(clash.conflict!.cards.map((c) => c.code).sort()).toEqual([funderCard.code, otherFunderCard.code].sort());
    // Before the second override started there was only one.
    expect(await conflictOf(carer, new Date('2026-05-05T10:00:00Z'), funder.id)).toMatchObject({ card: funderCard.id });
  });

  it('a future-dated card: no conflict until it starts, a warning in the form, and a clean hand-over when the old card is ended', async () => {
    const carer = await createCarer(t.prisma, { locationId: branch });
    const next = await card(16, { effectiveFrom: new Date('2026-12-01') });

    // Today the new card is not in force.
    expect(Number((await price(carer)).payableAmount)).toBe(14);
    expect((await get(office, `/billing/pay-cards/conflicts?locationId=${branch}`)).body.data.carerCount).toBe(0);
    // From 1 December both would apply.
    const december = await price(carer, '2026-12-01T09:00:00Z');
    expect(december.payableAmount).toBeNull();
    expect(cardProblem(december)).toContain('on 2026-12-01');

    // The form says so before anything is saved.
    const check = await post(office, `/billing/pay-cards/conflict-check?locationId=${branch}`, {
      id: next.id,
      assignmentLevel: 'ORGANISATION_DEFAULT',
      effectiveFrom: '2026-12-01',
    });
    expect(check.status).toBe(201);
    expect(check.body.data).toMatchObject({ day: '2026-12-01', affectedCarerCount: 1 });
    expect(check.body.data.overlapping).toHaveLength(1);
    expect(check.body.data.overlapping[0]).toMatchObject({ id: defaultCardId, overlapFrom: '2026-12-01' });
    expect(check.body.data.affectedCarers[0].employeeId).toBe(carer.employeeId);
    expect(check.body.data.message).toContain('1 carer without a pay card of their own');

    // The old card is ended the day before: each visit is paid on the card of its own date.
    expect((await patch(office, `/billing/pay-cards/${defaultCardId}`, { effectiveTo: '2026-11-30' })).status).toBe(200);
    expect(Number((await again(december.id)).payableAmount)).toBe(16);
    expect(Number((await price(carer, '2026-11-30T09:00:00Z')).payableAmount)).toBe(14);
    const clear = await post(office, `/billing/pay-cards/conflict-check?locationId=${branch}`, {
      id: next.id,
      assignmentLevel: 'ORGANISATION_DEFAULT',
      effectiveFrom: '2026-12-01',
    });
    expect(clear.body.data).toMatchObject({ overlapping: [], affectedCarerCount: 0, message: null });
  });

  it('a rate changed after the visit: the visit keeps the rate in force on its own date', async () => {
    const carer = await createCarer(t.prisma);
    await t.prisma.payCard.update({ where: { id: defaultCardId }, data: { status: 'ARCHIVED' } });
    const created = await post(office, '/billing/pay-cards', {
      name: 'Synthetic versioned card',
      code: `TEST-VER-${uuid().slice(0, 6)}`.toUpperCase(),
      effectiveFrom: '2026-01-01',
      status: 'ACTIVE',
      rules: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: 14 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const early = await price(carer, '2026-11-03T09:00:00Z');
    expect(Number(early.payableAmount)).toBe(14);

    // New rates from 10 November, entered after the visit of 3 November was worked.
    const versioned = await patch(office, `/billing/pay-cards/${id}`, {
      rules: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: 15.5 }],
      versionEffectiveFrom: '2026-11-10',
      versionNote: 'Synthetic rate rise',
    });
    expect(versioned.status).toBe(200);
    expect(versioned.body.data.version).toBe(2);

    expect(Number((await again(early.id)).payableAmount)).toBe(14);
    expect(Number((await price(carer, '2026-11-09T09:00:00Z')).payableAmount)).toBe(14);
    expect(Number((await price(carer, '2026-11-10T09:00:00Z')).payableAmount)).toBe(15.5);
    // One card with two versions is not two cards.
    expect((await conflictOf(carer, new Date('2026-11-10T09:00:00Z'))).source).toBe('MATCHED');
  });

  it('historic ambiguity: a past period with two cards is reported for visits of that period only', async () => {
    const carer = await createCarer(t.prisma);
    // Priced while there was one card.
    const before = await price(carer, '2026-03-12T09:00:00Z');
    expect(Number(before.payableAmount)).toBe(14);

    // A second organisation default is recorded for March only.
    const march = await card(16, { effectiveFrom: new Date('2026-03-01'), effectiveTo: new Date('2026-03-31') });

    const inMarch = await price(carer, '2026-03-10T09:00:00Z');
    expect(inMarch.payableAmount).toBeNull();
    expect(cardProblem(inMarch)).toContain('on 2026-03-10');
    expect(cardProblem(inMarch)).toContain(march.code);
    // Outside March there is one card.
    expect(Number((await price(carer, '2026-04-01T09:00:00Z')).payableAmount)).toBe(14);
    expect(Number((await price(carer, '2026-11-03T09:00:00Z')).payableAmount)).toBe(14);
    // Today's list is about today.
    expect((await conflictOf(carer)).source).toBe('MATCHED');

    // A visit that was priced and approved before the second card was recorded keeps its card.
    const reEvaluated = await again(before.id);
    expect(Number(reEvaluated.payableAmount)).toBe(14);
    expect(reEvaluated.payCardId).toBe(defaultCardId);
  });

  it('conflict during a pay run: the held visit is not paid on a guess, and the run says what it left out', async () => {
    const paid = await createCarer(t.prisma);
    const stuck = await createCarer(t.prisma);
    await employment(paid, { defaultPayCardId: defaultCardId }); // has a card by name
    const second = await card(16);

    const work = async (carer: Carer, hm: string) => {
      const start = new Date(`2026-11-03T${hm}:00Z`);
      const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start });
      clock.set(new Date(start.getTime() + 60_000));
      await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer(carer)).send({});
      clock.set(new Date(start.getTime() + 60 * 60_000));
      const done = await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer(carer)).send({ status: 'COMPLETED' });
      expect(done.status).toBe(201); // the carer's completion is never refused for a pay card problem
      return t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId }, include: { exceptions: true } });
    };
    const paidRow = await work(paid, '09:00');
    const stuckRow = await work(stuck, '11:00');
    expect(Number(paidRow.payableAmount)).toBe(14);
    expect(stuckRow.payableAmount).toBeNull();
    // Training in the same week for the carer whose card cannot be decided.
    await t.prisma.employeeNonCoreActivity.create({
      data: {
        employeeId: stuck.employeeId,
        dateFrom: new Date('2026-11-04T10:00:00Z'),
        dateTo: new Date('2026-11-04T12:00:00Z'),
        includeInPayroll: true,
      },
    });
    clock.set(new Date('2026-11-09T09:00:00Z'));

    const created = await post(office, '/billing/payroll-runs', { periodStart: '2026-11-02', periodEnd: '2026-11-08' });
    expect(created.status).toBe(201);
    const runId = created.body.data.id as string;
    expect((await post(office, `/billing/payroll-runs/${runId}/calculate`)).status).toBe(201);

    const lines = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: runId } });
    const visitPay = lines.filter((l) => l.lineType === 'VISIT_PAY');
    expect(visitPay.map((l) => [l.employeeId, Number(l.amount)])).toEqual([[paid.employeeId, 14]]);
    const problem = lines.find((l) => l.sourceType === 'HELD_EARNING' && l.employeeId === stuck.employeeId);
    expect(problem).toMatchObject({ lineType: 'NON_VISIT_ACTIVITY' });
    expect(problem!.sourceRef).toMatch(/^HELD:ACTIVITY:/); // the training activity, held under its own identity (R-22)
    expect(Number(problem!.amount)).toBe(0);
    expect(problem!.exceptionMessage).toContain('Two pay cards apply to this carer');
    expect(problem!.exceptionMessage).toContain(second.code);
    const run = await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('EXCEPTION_FOUND');
    expect(Number(run.grossPay)).toBe(14);

    // The conflict is settled; the visit is priced and the next calculation picks it up.
    expect((await patch(office, `/billing/pay-cards/${second.id}`, { effectiveTo: '2026-11-01' })).status).toBe(200);
    const priced = await again(stuckRow.id);
    expect(Number(priced.payableAmount)).toBe(14);
    expect((await post(office, `/billing/payroll-runs/${runId}/calculate`)).status).toBe(201);
    const after = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: runId } });
    // The conflict is gone. The training is still held, now for its real reason: the card has no training rate.
    const stillHeld = after.filter((l) => l.sourceType === 'HELD_EARNING');
    expect(stillHeld).toHaveLength(1);
    expect(stillHeld[0].exceptionMessage).toContain('has no training rate');
    const paidVisits = after.filter((l) => l.lineType === 'VISIT_PAY' && !l.exceptionMessage);
    expect(paidVisits.map((l) => l.employeeId).sort()).toEqual([paid.employeeId, stuck.employeeId].sort());
    expect(Number((await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).grossPay)).toBe(28);
  });

  it('concurrent publication: two cards published at the same moment give a conflict, whichever was written last', async () => {
    const role = await t.prisma.employeeRoleLookup.create({ data: { name: `TEST role ${uuid().slice(0, 8)}` } });
    const carer = await createCarer(t.prisma);
    await employment(carer, { roleId: role.id });
    const publish = (rate: number) =>
      post(office, '/billing/pay-cards', {
        name: `Synthetic role card £${rate}`,
        code: `TEST-ROLE-${rate}-${uuid().slice(0, 6)}`.toUpperCase(),
        assignmentLevel: 'ROLE',
        assignmentTargetId: role.id,
        effectiveFrom: '2026-01-01',
        status: 'ACTIVE',
        rules: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: rate }],
      });
    const [a, b] = await Promise.all([publish(15), publish(17)]);
    expect([a.status, b.status]).toEqual([201, 201]); // a catalogue of cards for one role is allowed

    const clash = await conflictOf(carer);
    expect(clash.conflict).toMatchObject({ kind: 'MATCHED_LEVEL', level: 'ROLE' });
    expect(clash.conflict!.cards.map((c) => c.id).sort()).toEqual([a.body.data.id, b.body.data.id].sort());
    // Touching either card afterwards changes nothing.
    await t.prisma.payCard.update({ where: { id: a.body.data.id }, data: { notes: 'touched' } });
    expect((await conflictOf(carer)).source).toBe('CONFLICT');
    expect((await price(carer)).payableAmount).toBeNull();
  });

  it('concurrent assignment: two changes for one carer at once leave one card in force on every day', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const carer = await createCarer(t.prisma);
      const [x, y] = [await card(18 + attempt), await card(28 + attempt)];
      const change = (payCardId: string) =>
        post(office, `/billing/pay-cards/employee-history/${carer.employeeId}/change`, {
          payCardId,
          effectiveFrom: '2026-11-01',
          reason: 'Synthetic: two office users at once',
        });
      const results = await Promise.all([change(x.id), change(y.id)]);
      expect(results.some((r) => r.status === 201)).toBe(true);

      const history = await t.prisma.employeePayCardAssignment.findMany({ where: { employeeId: carer.employeeId } });
      for (const day of ['2026-10-31', '2026-11-01', '2026-11-03', '2027-01-01']) {
        expect(assignmentsCoveringDay(history, day).length).toBeLessThanOrEqual(1);
      }
      const resolved = await conflictOf(carer);
      expect(resolved).toMatchObject({ source: 'EXPLICIT', conflict: null });
      expect([x.id, y.id]).toContain(resolved.card);
      // The employment record points at the card that is in force.
      const record = await t.prisma.employeeEmployment.findFirstOrThrow({ where: { employeeId: carer.employeeId } });
      expect(record.defaultPayCardId).toBe(resolved.card);
    }
  });

  it('concurrent funder overrides: two requests at once leave one override', async () => {
    const carer = await createCarer(t.prisma);
    const funder = await t.prisma.funder.create({ data: { name: `TEST funder ${uuid().slice(0, 6)}` } });
    const [x, y] = [await card(21), await card(22)];
    const upsert = (payCardId: string) =>
      post(office, '/billing/pay-cards/employee-funder-assignments', {
        employeeId: carer.employeeId,
        funderId: funder.id,
        payCardId,
        effectiveFrom: '2026-01-01',
      });
    const results = await Promise.all([upsert(x.id), upsert(y.id), upsert(x.id), upsert(y.id)]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const rows = await t.prisma.employeeFunderPayAssignment.findMany({
      where: { employeeId: carer.employeeId, funderId: funder.id, deletedAt: null },
    });
    expect(rows).toHaveLength(1);
    expect((await conflictOf(carer, NOW, funder.id)).source).toBe('EMPLOYEE_FUNDER');
  });

  it('PC-19: a card starts on its local day (00:15 on the first day in summer time is already that day)', async () => {
    const carer = await createCarer(t.prisma);
    await card(20, {
      assignmentLevel: 'INDIVIDUAL',
      assignmentTargetId: carer.employeeId,
      effectiveFrom: new Date('2026-06-06'),
      effectiveTo: new Date('2026-06-06'),
    });
    // Saturday 6 June 2026, 00:15 BST is Friday 5 June 23:15 UTC.
    expect(Number((await price(carer, '2026-06-05T23:15:00Z', 60)).payableAmount)).toBe(20);
    // Friday 5 June 22:00 BST: the card has not started.
    expect(Number((await price(carer, '2026-06-05T21:00:00Z', 60)).payableAmount)).toBe(14);
    // Sunday 7 June 00:15 BST (Saturday 23:15 UTC): the card ended on Saturday.
    expect(Number((await price(carer, '2026-06-06T23:15:00Z', 60)).payableAmount)).toBe(14);
  });

  it('the lists of affected carers are limited to the branches of a branch-limited user', async () => {
    const otherBranch = await createBranch(t.prisma, 'PC32-other');
    const mine = await createCarer(t.prisma, { locationId: branch });
    await createCarer(t.prisma, { locationId: otherBranch });
    await card(16);
    const manager = await createStaffUser(t.prisma, { permissions: CARDS, locationIds: [branch] });

    expect((await get(manager, '/billing/pay-cards/conflicts')).status).toBe(403);
    // Another branch is answered as the rest of the application answers it: not found.
    expect((await get(manager, `/billing/pay-cards/conflicts?locationId=${otherBranch}`)).status).toBe(404);
    const own = await get(manager, `/billing/pay-cards/conflicts?locationId=${branch}`);
    expect(own.status).toBe(200);
    expect(own.body.data.groups.flatMap((g: { carers: Array<{ employeeId: string }> }) => g.carers.map((c) => c.employeeId))).toEqual([mine.employeeId]);

    const body = { assignmentLevel: 'ORGANISATION_DEFAULT', effectiveFrom: '2026-11-01' };
    expect((await post(manager, '/billing/pay-cards/conflict-check', body)).status).toBe(403);
    const check = await post(manager, `/billing/pay-cards/conflict-check?locationId=${branch}`, body);
    expect(check.status).toBe(201);
    expect(check.body.data.affectedCarers.map((c: { employeeId: string }) => c.employeeId)).toEqual([mine.employeeId]);
    expect(check.body.data.overlapping).toHaveLength(2);
    // A level that needs a target, with none chosen yet: nothing to report, not an error.
    const unfinished = await post(manager, `/billing/pay-cards/conflict-check?locationId=${branch}`, { assignmentLevel: 'ROLE', effectiveFrom: '2026-11-01' });
    expect(unfinished.body.data).toMatchObject({ overlapping: [], affectedCarerCount: 0, message: null });
  });
});
