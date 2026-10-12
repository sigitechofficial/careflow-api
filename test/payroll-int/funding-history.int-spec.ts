/**
 * Gate B sprint, PC-10 — a funder pay override follows the funder on the day of the visit.
 * Audit ID: PC-10.
 *
 * Before: the funder was read from the client's funding as it is today. A visit worked while the
 * council was funding, and evaluated after the client moved to another funder, lost the carer's
 * council pay card (or gained the new funder's card for work that funder never paid for).
 *
 * Real services and database. All people, funders, cards and visits are synthetic.
 */
import request from 'supertest';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { createCompletedVisit, resetPayData, uuid } from './harness';
import {
  bearer,
  createCarer,
  createStaffUser,
  createTestApp,
  resetIdentityData,
  seedDefaultCards,
  TestApp,
  useControlledClock,
} from './http-harness';

type Carer = { employeeId: string; accountId: string };

describe('PC-10: the funder on the day of the visit decides a funder pay override', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let recons: VisitReconciliationsService;
  let office: { id: string };
  let fundingTypeId: string;
  let council: { id: string; name: string };
  let nhs: { id: string; name: string };

  const NOW = new Date('2026-11-03T08:00:00Z');
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const post = (path: string) =>
    request(t.app.getHttpServer()).post(path).set(bearer(t.staffToken(office.id))).send({});

  const payCard = (rate: number) =>
    t.prisma.payCard.create({
      data: {
        name: `Synthetic funder card £${rate}`,
        code: `TEST-F${rate}-${uuid().slice(0, 6)}`.toUpperCase(),
        assignmentLevel: 'CLIENT_FUNDER',
        effectiveFrom: day('2026-01-01'),
        status: 'ACTIVE',
        rules: { create: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: rate }] },
      } as never,
    });
  /** The carer is paid `rate` an hour for work funded by `funder`. */
  const override = async (carer: Carer, funder: { id: string }, rate: number) => {
    const card = await payCard(rate);
    await t.prisma.employeeFunderPayAssignment.create({
      data: { employeeId: carer.employeeId, funderId: funder.id, payCardId: card.id, effectiveFrom: day('2026-01-01') },
    });
  };
  const fundingLine = (serviceUserId: string, funder: { id: string }, over: Record<string, unknown> = {}) =>
    t.prisma.serviceUserFunding.create({
      data: { serviceUserId, fundingTypeId, funderId: funder.id, status: 'ACTIVE', createdAt: day('2026-01-01'), ...over } as never,
    });
  const makeCurrent = (serviceUserId: string, fundingId: string) =>
    t.prisma.serviceUser.update({ where: { id: serviceUserId }, data: { currentFundingId: fundingId } });
  /** A completed one-hour visit for the carer, not yet evaluated. */
  const visit = (carer: Carer, start: string) => createCompletedVisit(t.prisma, { start, employeeId: carer.employeeId });
  const evaluate = async (visitId: string) => {
    const id = (await recons.ensureForVisit(visitId))!;
    return t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id }, include: { exceptions: true } });
  };
  const again = async (id: string) => {
    expect((await post(`/billing/visit-reconciliations/${id}/evaluate`)).status).toBe(201);
    return t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id }, include: { exceptions: true } });
  };
  const problem = (row: { exceptions: Array<{ code: string; message: string | null }> }) =>
    row.exceptions.find((e) => e.code === 'PAY_CARD_MISSING')?.message ?? null;

  beforeAll(async () => {
    t = await createTestApp();
    recons = t.app.get(VisitReconciliationsService);
    fundingTypeId = (
      await t.prisma.fundingType.upsert({
        where: { code: 'TEST-PC10' },
        update: {},
        create: { name: 'Synthetic funding type', code: 'TEST-PC10' },
      })
    ).id;
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(NOW);
    await resetPayData(t.prisma);
    await t.prisma.payEvaluationFailure.deleteMany();
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma); // organisation default £14; client charge £24
    office = await createStaffUser(t.prisma, {
      permissions: ['billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', 'payroll.scope.organisation'],
    });
    council = await t.prisma.funder.create({ data: { name: `TEST Council ${uuid().slice(0, 6)}` } });
    nhs = await t.prisma.funder.create({ data: { name: `TEST NHS ${uuid().slice(0, 6)}` } });
  });
  afterEach(() => clock.restore());
  afterAll(async () => {
    await t.close();
  });

  it('a change of funder: a visit from before the change keeps the old funder\'s pay card', async () => {
    const carer = await createCarer(t.prisma);
    await override(carer, council, 21);
    const june = await visit(carer, '2026-06-15T09:00:00Z');
    const july = await visit(carer, '2026-07-10T09:00:00Z');
    // Council until 30 June; NHS from 1 July, and NHS is the client's funding today.
    for (const v of [june, july]) {
      await fundingLine(v.serviceUserId, council, { startDate: day('2026-01-01'), endDate: day('2026-06-30'), isActive: false, status: 'ENDED' });
      const current = await fundingLine(v.serviceUserId, nhs, { startDate: day('2026-07-01'), isPrimary: true });
      await makeCurrent(v.serviceUserId, current.id);
    }

    const juneRow = await evaluate(june.visitId);
    expect(juneRow.payCardSource).toBe('EMPLOYEE_FUNDER');
    expect(Number(juneRow.payableAmount)).toBe(21); // was £14: today's funder is the NHS
    const julyRow = await evaluate(july.visitId);
    expect(julyRow.payCardSource).toBe('MATCHED');
    expect(Number(julyRow.payableAmount)).toBe(14);
    // The client charge is not touched by any of this.
    expect(Number(juneRow.billableAmount)).toBe(24);
  });

  it('the new funder\'s pay card is not applied to work the old funder paid for', async () => {
    const carer = await createCarer(t.prisma);
    await override(carer, nhs, 19);
    const june = await visit(carer, '2026-06-15T09:00:00Z');
    const july = await visit(carer, '2026-07-10T09:00:00Z');
    for (const v of [june, july]) {
      await fundingLine(v.serviceUserId, council, { startDate: day('2026-01-01'), endDate: day('2026-06-30') });
      const current = await fundingLine(v.serviceUserId, nhs, { startDate: day('2026-07-01'), isPrimary: true });
      await makeCurrent(v.serviceUserId, current.id);
    }
    expect(Number((await evaluate(june.visitId)).payableAmount)).toBe(14); // was £19
    expect(Number((await evaluate(july.visitId)).payableAmount)).toBe(19);
  });

  it('funding with no dates that was already on record on the day applies, as it always has', async () => {
    const carer = await createCarer(t.prisma);
    await override(carer, council, 21);
    const v = await visit(carer, '2026-06-15T09:00:00Z');
    const line = await fundingLine(v.serviceUserId, council); // recorded 1 January, no dates
    await makeCurrent(v.serviceUserId, line.id);
    const row = await evaluate(v.visitId);
    expect(row.payCardSource).toBe('EMPLOYEE_FUNDER');
    expect(Number(row.payableAmount)).toBe(21);
  });

  it('history that cannot say who was funding: held for review when it matters, and settled by entering the dates', async () => {
    const withOverride = await createCarer(t.prisma);
    const without = await createCarer(t.prisma);
    await override(withOverride, nhs, 19);
    const v1 = await visit(withOverride, '2026-06-15T09:00:00Z');
    const v2 = await visit(without, '2026-06-15T11:00:00Z');
    // The only funding on record was entered in September, with no start date.
    const lines: Record<string, string> = {};
    for (const v of [v1, v2]) {
      const line = await fundingLine(v.serviceUserId, nhs, { createdAt: day('2026-09-01'), isPrimary: true });
      await makeCurrent(v.serviceUserId, line.id);
      lines[v.visitId] = line.id;
    }

    // The carer who is paid differently for NHS work: not priced on a guess either way.
    const held = await evaluate(v1.visitId);
    expect(held).toMatchObject({ status: 'PENDING_REVIEW', payableAmount: null });
    expect(problem(held)).toBe(
      `Carer pay cannot be priced: The client's funding records do not show who was funding their care on 2026-06-15, and this carer has a different pay card for work funded by ${nhs.name}. Enter the start and end dates on the client's funding and evaluate the visit again, or approve the pay by hand.`,
    );
    expect(Number(held.billableAmount)).toBe(24);
    // A carer with no funder pay card is paid the same whoever was funding: nothing to review.
    const plain = await evaluate(v2.visitId);
    expect(Number(plain.payableAmount)).toBe(14);
    expect(problem(plain)).toBeNull();

    // The office records that NHS funding began on 1 June.
    await t.prisma.serviceUserFunding.update({ where: { id: lines[v1.visitId] }, data: { startDate: day('2026-06-01') } });
    const settled = await again(held.id);
    expect(settled.payCardSource).toBe('EMPLOYEE_FUNDER');
    expect(Number(settled.payableAmount)).toBe(19);
    expect(problem(settled)).toBeNull();
  });

  it('…or the dates show the funder started later: the normal card applies', async () => {
    const carer = await createCarer(t.prisma);
    await override(carer, nhs, 19);
    const v = await visit(carer, '2026-06-15T09:00:00Z');
    const line = await fundingLine(v.serviceUserId, nhs, { createdAt: day('2026-09-01'), startDate: day('2026-07-01'), isPrimary: true });
    await makeCurrent(v.serviceUserId, line.id);
    const row = await evaluate(v.visitId);
    expect(Number(row.payableAmount)).toBe(14);
    expect(problem(row)).toBeNull();
  });

  it('a visit already approved on a funder card is not re-priced when the client changes funder', async () => {
    const carer = await createCarer(t.prisma);
    await override(carer, council, 21);
    const v = await visit(carer, '2026-06-15T09:00:00Z');
    const councilLine = await fundingLine(v.serviceUserId, council);
    await makeCurrent(v.serviceUserId, councilLine.id);
    const first = await evaluate(v.visitId);
    expect(Number(first.payableAmount)).toBe(21);

    // In November the council line is stopped without an end date and the NHS takes over.
    await t.prisma.serviceUserFunding.update({ where: { id: councilLine.id }, data: { isActive: false, status: 'ENDED' } });
    const nhsLine = await fundingLine(v.serviceUserId, nhs, { createdAt: NOW, isPrimary: true });
    await makeCurrent(v.serviceUserId, nhsLine.id);
    const after = await again(first.id);
    expect(Number(after.payableAmount)).toBe(21);
    expect(after.payCardId).toBe(first.payCardId);
  });
});
