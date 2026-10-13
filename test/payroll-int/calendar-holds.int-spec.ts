/**
 * Gate B2, R-27 — a day that is normally a bank holiday, with no entry in the calendar, is not
 * priced as an ordinary day. Audit IDs: PC-23, PC-24.
 *
 * Before: a year (or a nation) with no dates priced Good Friday, Easter Monday and the rest at
 * the ordinary rate, saying nothing. Also found here: a visit whose pay run line was an exception
 * (£0.00) was marked as paid when the run was locked, and was never paid afterwards.
 *
 * Real controllers, services and database. All people, cards and amounts are synthetic.
 */
import request from 'supertest';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { createCompletedVisit, resetPayData } from './harness';
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

describe('R-27: an unresolved bank holiday holds carer pay instead of pricing an ordinary day', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let recons: VisitReconciliationsService;
  let office: { id: string };
  let approver: { id: string };
  let carer: Carer;
  let payCardId: string;
  let chargeCardId: string;

  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const patch = (user: { id: string }, path: string, body: Record<string, unknown>) =>
    request(server()).patch(path).set(as(user)).send(body);

  const allDay = { startTime: '00:00', endTime: '23:59' };
  const hourly = (dayType: string, amount: number) => ({ label: dayType, dayType, rateType: 'HOURLY', amount, ...(dayType === 'WEEKDAY' ? {} : allDay) });
  const setPayRules = async (rules: object[]) => {
    await t.prisma.payCardRule.deleteMany({ where: { payCardId } });
    await t.prisma.payCardRule.createMany({ data: rules.map((r) => ({ ...r, payCardId })) as never });
  };
  const holiday = (date: string, name: string, region = 'UK') => post(office, '/billing/bank-holidays', { holidayDate: date, name, region });
  /** A completed visit priced by the real service: carer pay, charge, status and the hold reason if any. */
  const price = async (start: string, minutes = 60) => {
    const visit = await createCompletedVisit(t.prisma, { start, plannedMinutes: minutes, employeeId: carer.employeeId });
    const id = (await recons.ensureForVisit(visit.visitId))!;
    return read(id);
  };
  const read = async (id: string) => {
    const row = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id }, include: { exceptions: true } });
    return {
      id,
      pay: row.payableAmount == null ? null : Number(row.payableAmount),
      charge: Number(row.billableAmount),
      status: row.status,
      held: row.exceptions.find((e) => e.code === 'RATE_MISSING')?.message ?? null,
    };
  };
  const again = async (id: string) => {
    expect((await post(office, `/billing/visit-reconciliations/${id}/evaluate`)).status).toBe(201);
    return read(id);
  };

  beforeAll(async () => {
    t = await createTestApp();
    recons = t.app.get(VisitReconciliationsService);
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(new Date('2027-06-01T08:00:00Z'));
    await resetPayData(t.prisma);
    await t.prisma.payEvaluationFailure.deleteMany();
    await t.prisma.bankHoliday.deleteMany();
    await resetIdentityData(t.prisma);
    const cards = await seedDefaultCards(t.prisma);
    payCardId = cards.payCardId;
    chargeCardId = cards.chargeCardId;
    await setPayRules([hourly('WEEKDAY', 14), hourly('SATURDAY', 16), hourly('SUNDAY', 18), hourly('BANK_HOLIDAY', 28)]);
    await t.prisma.chargeCardRule.deleteMany({ where: { chargeCardId } });
    await t.prisma.chargeCardRule.createMany({ data: [hourly('WEEKDAY', 20), hourly('BANK_HOLIDAY', 40)].map((r) => ({ ...r, chargeCardId })) as never });
    office = await createStaffUser(t.prisma, {
      permissions: ['billing.pay_cards.read', 'billing.pay_cards.manage', 'billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', 'billing.payroll_runs.read', 'billing.payroll_runs.manage', 'payroll.scope.organisation'],
    });
    approver = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', 'payroll.scope.organisation'] });
    carer = await createCarer(t.prisma);
  });
  afterEach(() => clock.restore());
  afterAll(async () => {
    await t.prisma.bankHoliday.deleteMany();
    await resetPayData(t.prisma);
    await t.close();
  });

  it('a calendar year with no dates: Good Friday is held with the reason, an ordinary day is paid, and adding the date settles it', async () => {
    const goodFriday = await price('2027-03-26T10:00:00Z');
    expect(goodFriday).toMatchObject({ pay: null, status: 'PENDING_REVIEW' });
    expect(goodFriday.held).toBe(
      'Carer pay is held: 2027-03-26 is normally Good Friday in England & Wales, but the bank holiday calendar has no entry for it, so it is not known whether the holiday rate applies. Add the date under Billing → Bank holidays (or import from GOV.UK), or add it switched off if it is not a holiday that year; then evaluate the visit again.',
    );
    // The day before is an ordinary Thursday: nothing about it is in doubt.
    expect(await price('2027-03-25T10:00:00Z')).toMatchObject({ pay: 14, held: null });

    expect((await holiday('2027-03-26', 'Good Friday')).status).toBe(201);
    expect(await again(goodFriday.id)).toMatchObject({ pay: 28, held: null });
  });

  it('a date recorded as switched off is a decision: the day is paid as an ordinary day', async () => {
    const created = await holiday('2027-05-03', 'Early May bank holiday');
    expect((await patch(office, `/billing/bank-holidays/${created.body.data.id}`, { isActive: false })).status).toBe(200);
    expect(await price('2027-05-03T10:00:00Z')).toMatchObject({ pay: 14, held: null });
  });

  it('a card with no holiday rate is not held: the calendar cannot change what it pays', async () => {
    await setPayRules([hourly('WEEKDAY', 14), hourly('SATURDAY', 16), hourly('SUNDAY', 18)]);
    expect(await price('2027-03-26T10:00:00Z')).toMatchObject({ pay: 14, held: null });
  });

  it('substitute days: the Monday after a weekend Christmas is held; Christmas Day itself is paid by date', async () => {
    expect(await price('2027-12-25T10:00:00Z')).toMatchObject({ pay: 28, held: null }); // Saturday 25 December, by date
    const monday = await price('2027-12-27T10:00:00Z');
    expect(monday.pay).toBeNull();
    expect(monday.held).toContain('2027-12-27 is normally Christmas Day');
    expect((await holiday('2027-12-27', 'Christmas Day')).status).toBe(201);
    expect(await again(monday.id)).toMatchObject({ pay: 28 });
    expect(await price('2027-12-29T10:00:00Z')).toMatchObject({ pay: 14, held: null });
  });

  it('midnight: a visit ending at midnight before an unresolved holiday is paid; one minute into it is held', async () => {
    // Sunday 2 May 2027, 22:00 to midnight local (BST). Monday 3 May is normally the early May bank holiday.
    expect(await price('2027-05-02T21:00:00Z', 120)).toMatchObject({ pay: 36, held: null });
    const across = await price('2027-05-02T21:00:00Z', 150); // to 00:30 on Monday
    expect(across.pay).toBeNull();
    expect(across.held).toContain('2027-05-03 is normally Early May bank holiday');
    // 00:15 local on Monday is still Sunday in UTC: it is Monday's question.
    expect((await price('2027-05-02T23:15:00Z', 30)).held).toContain('2027-05-03');
    expect((await holiday('2027-05-03', 'Early May bank holiday')).status).toBe(201);
    expect(await again(across.id)).toMatchObject({ pay: 50, held: null }); // 2h Sunday £36 + 0.5h bank holiday £14
  });

  it('Scotland: its own holidays are checked on a Scottish card, and England & Wales entries do not answer for them', async () => {
    await t.prisma.payCard.update({ where: { id: payCardId }, data: { bankHolidayRegion: 'SCOTLAND' } });
    // England & Wales has its 2027 dates; Scotland has none.
    for (const [date, name] of [['2027-08-30', 'Summer bank holiday'], ['2027-03-29', 'Easter Monday']] as const) await holiday(date, name, 'UK');

    expect((await price('2027-08-02T10:00:00Z')).held).toContain('2027-08-02 is normally Summer bank holiday in Scotland'); // first Monday of August
    expect((await price('2027-01-04T10:00:00Z')).held).toContain('2027-01-04 is normally 2nd January'); // substitute for Saturday 2 January
    expect((await price('2027-11-30T10:00:00Z')).held).toContain("St Andrew's Day");
    // Not Scottish holidays: ordinary days on a Scottish card.
    expect(await price('2027-08-30T10:00:00Z')).toMatchObject({ pay: 14, held: null });
    expect(await price('2027-03-29T10:00:00Z')).toMatchObject({ pay: 14, held: null });

    expect((await holiday('2027-08-02', 'Summer bank holiday', 'SCOTLAND')).status).toBe(201);
    expect(await price('2027-08-02T12:00:00Z')).toMatchObject({ pay: 28, held: null });
  });

  it('Northern Ireland: St Patrick’s Day and the Twelfth are checked on a Northern Ireland card', async () => {
    await t.prisma.payCard.update({ where: { id: payCardId }, data: { bankHolidayRegion: 'NORTHERN_IRELAND' } });
    expect((await price('2027-03-17T10:00:00Z')).held).toContain("2027-03-17 is normally St Patrick's Day in Northern Ireland");
    expect((await price('2027-07-12T10:00:00Z')).held).toContain('Battle of the Boyne');
    expect(await price('2027-07-13T10:00:00Z')).toMatchObject({ pay: 14, held: null });
    await holiday('2027-03-17', 'St Patrick’s Day', 'NORTHERN_IRELAND');
    expect(await price('2027-03-17T12:00:00Z')).toMatchObject({ pay: 28 });
  });

  it('the client charge is not changed by this (it keeps its own calendar rules)', async () => {
    const goodFriday = await price('2027-03-26T10:00:00Z');
    expect(goodFriday.pay).toBeNull();
    expect(goodFriday.charge).toBe(20);
  });

  it('pay run: a visit approved at an ordinary rate on an unresolved holiday is held, the rest is paid, and locking does not swallow it', async () => {
    // Approved while the date was recorded as "not a holiday"; the entry is then removed, as if never recorded.
    const off = await holiday('2027-05-03', 'Early May bank holiday');
    await patch(office, `/billing/bank-holidays/${off.body.data.id}`, { isActive: false });
    const monday = await price('2027-05-03T10:00:00Z');
    const tuesday = await price('2027-05-04T10:00:00Z');
    expect([monday.pay, monday.status, tuesday.pay]).toEqual([14, 'APPROVED_FOR_BOTH', 14]);
    await t.prisma.bankHoliday.deleteMany();

    clock.set(new Date('2027-05-10T09:00:00Z'));
    const created = await post(office, '/billing/payroll-runs', { periodStart: '2027-05-03', periodEnd: '2027-05-09' });
    const run = created.body.data.id as string;
    expect((await post(office, `/billing/payroll-runs/${run}/calculate`)).status).toBe(201);
    const lines = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run } });
    const heldLine = lines.find((l) => l.visitReconciliationId === monday.id)!;
    expect(heldLine).toMatchObject({ sourceType: 'HELD_EARNING', sourceRef: `HELD:VISIT:${monday.id}`, claimKey: null });
    expect(Number(heldLine.amount)).toBe(0);
    expect(heldLine.exceptionMessage).toContain('2027-05-03 is normally Early May bank holiday');
    expect(heldLine.exceptionMessage).toContain('use "Recalculate amounts" for the visit');
    expect(lines.filter((l) => !l.exceptionMessage).map((l) => [l.visitReconciliationId, Number(l.amount)])).toEqual([[tuesday.id, 14]]);
    const runRow = await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });
    expect([runRow.status, Number(runRow.grossPay)]).toEqual(['EXCEPTION_FOUND', 14]);

    // The run is locked with the held visit in it: the visit is NOT marked as paid.
    expect((await post(approver, `/billing/payroll-runs/${run}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${run}/lock`)).status).toBe(201);
    const afterLock = await t.prisma.visitReconciliation.findMany({ where: { id: { in: [monday.id, tuesday.id] } } });
    expect(Object.fromEntries(afterLock.map((v) => [v.id, v.includedInPayrollRunId]))).toEqual({ [monday.id]: null, [tuesday.id]: run });
    const list = await get(office, '/billing/payroll-runs/held-earnings');
    expect(list.body.data.find((h: { subjectId: string }) => h.subjectId === monday.id)).toMatchObject({ kind: 'VISIT', state: 'OPEN' });

    // The calendar is settled, the visit is re-priced, and a run over the same period pays it once.
    expect((await holiday('2027-05-03', 'Early May bank holiday')).status).toBe(201);
    const recalculated = await post(office, '/billing/visit-reconciliations/recalculate-amounts', { ids: [monday.id], reason: 'Synthetic: bank holiday added to the calendar' });
    expect(recalculated.status).toBe(201);
    expect((await read(monday.id)).pay).toBe(28);
    const second = await post(office, '/billing/payroll-runs', { periodStart: '2027-05-03', periodEnd: '2027-05-09' });
    const supplementary = second.body.data.id as string;
    expect((await post(office, `/billing/payroll-runs/${supplementary}/calculate`)).status).toBe(201);
    const paid = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: supplementary } });
    expect(paid.map((l) => [l.visitReconciliationId, Number(l.amount), l.exceptionMessage])).toEqual([[monday.id, 28, null]]);
    expect((await post(approver, `/billing/payroll-runs/${supplementary}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${supplementary}/lock`)).status).toBe(201);
    const after = await get(office, '/billing/payroll-runs/held-earnings');
    expect(after.body.data.find((h: { subjectId: string }) => h.subjectId === monday.id)).toMatchObject({ state: 'PAID', paidByRunId: supplementary });
  });
});
