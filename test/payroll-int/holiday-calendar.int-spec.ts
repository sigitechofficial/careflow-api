/**
 * Gate B sprint, PC-22 / PC-23 / PC-24 — one holiday calendar for carer pay: three nations,
 * substitute days, organisation special days, a completeness check, and the organisation's policy
 * for holidays that fall on a weekend. Audit IDs: PC-22, PC-23, PC-24.
 *
 * The default policy is what was paid before the policy could be chosen, so nothing is re-priced
 * by this change. Real services, controllers and database; all data synthetic.
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

describe('PC-22 to PC-24: the holiday calendar for carer pay', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let recons: VisitReconciliationsService;
  let office: { id: string };
  let reader: { id: string };
  let carer: Carer;
  let payCardId: string;
  let chargeCardId: string;

  const NOW = new Date('2027-11-02T08:00:00Z');
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
  const setBasis = (basis: string) => patch(office, '/billing/bank-holidays/premium-basis', { basis, reason: 'Synthetic test: decided by the test client' });
  /** One hour from 10:00 on the day; carer pay and client charge. */
  const price = async (day: string) => {
    const visit = await createCompletedVisit(t.prisma, { start: `${day}T10:00:00Z`, employeeId: carer.employeeId });
    const id = (await recons.ensureForVisit(visit.visitId))!;
    const row = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
    return { id, pay: Number(row.payableAmount), charge: Number(row.billableAmount) };
  };
  const pays = async (days: string[]) => {
    const out: number[] = [];
    for (const day of days) out.push((await price(day)).pay);
    return out;
  };
  const CHRISTMAS_2027 = ['2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28', '2027-12-29'];

  beforeAll(async () => {
    t = await createTestApp();
    recons = t.app.get(VisitReconciliationsService);
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(NOW);
    await resetPayData(t.prisma); // also puts the holiday pay basis back to BOTH
    await t.prisma.payEvaluationFailure.deleteMany();
    await t.prisma.bankHoliday.deleteMany();
    await resetIdentityData(t.prisma);
    const cards = await seedDefaultCards(t.prisma);
    payCardId = cards.payCardId;
    chargeCardId = cards.chargeCardId;
    await setPayRules([hourly('WEEKDAY', 14), hourly('SATURDAY', 16), hourly('SUNDAY', 18), hourly('BANK_HOLIDAY', 28)]);
    await t.prisma.chargeCardRule.deleteMany({ where: { chargeCardId } });
    await t.prisma.chargeCardRule.createMany({
      data: [hourly('WEEKDAY', 20), hourly('SATURDAY', 22), hourly('SUNDAY', 24), hourly('BANK_HOLIDAY', 40)].map((r) => ({ ...r, chargeCardId })) as never,
    });
    office = await createStaffUser(t.prisma, {
      permissions: ['billing.pay_cards.read', 'billing.pay_cards.manage', 'billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', 'payroll.scope.organisation'],
    });
    reader = await createStaffUser(t.prisma, { permissions: ['billing.pay_cards.read'] });
    carer = await createCarer(t.prisma);
    // Christmas 2027 falls on a weekend: substitute days on Monday 27 and Tuesday 28.
    expect((await holiday('2027-12-27', 'Christmas Day')).status).toBe(201);
    expect((await holiday('2027-12-28', 'Boxing Day')).status).toBe(201);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.prisma.bankHoliday.deleteMany();
    await resetPayData(t.prisma);
    await t.close();
  });

  it('the calendar records substitute days and the date each stands for', async () => {
    const list = await get(reader, '/billing/bank-holidays?region=UK&year=2027');
    expect(list.status).toBe(200);
    expect(list.body.data.map((h: { name: string; isSubstitute: boolean; substituteForDate: string | null; source: string }) => [h.name, h.isSubstitute, h.substituteForDate?.slice(0, 10), h.source])).toEqual([
      ['Christmas Day', true, '2027-12-25', 'MANUAL'],
      ['Boxing Day', true, '2027-12-26', 'MANUAL'],
    ]);
    // A day entered with an unhelpful name can be given the date it stands for afterwards.
    const extra = await holiday('2027-06-07', 'Jubilee (substitute day)');
    expect(extra.body.data).toMatchObject({ isSubstitute: true, substituteForDate: null });
    const fixed = await patch(office, `/billing/bank-holidays/${extra.body.data.id}`, { substituteForDate: '2027-06-05' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.substituteForDate.slice(0, 10)).toBe('2027-06-05');
  });

  it('default policy (BOTH): the date and its substitute day, exactly as before', async () => {
    expect((await get(reader, '/billing/bank-holidays/status')).body.data.basis).toBe('BOTH');
    expect(await pays(CHRISTMAS_2027)).toEqual([28, 28, 28, 28, 14]);
  });

  it('the policy is the organisation\'s to choose: it needs permission and a reason, and is audited', async () => {
    expect((await patch(reader, '/billing/bank-holidays/premium-basis', { basis: 'ACTUAL_DAY', reason: 'Synthetic test reason' })).status).toBe(403);
    expect((await patch(office, '/billing/bank-holidays/premium-basis', { basis: 'ACTUAL_DAY' })).status).toBe(400);
    expect((await patch(office, '/billing/bank-holidays/premium-basis', { basis: 'WHATEVER', reason: 'Synthetic test reason' })).status).toBe(400);
    expect((await get(reader, '/billing/bank-holidays/status')).body.data.basis).toBe('BOTH');

    const changed = await setBasis('ACTUAL_DAY');
    expect(changed.status).toBe(200);
    expect((await get(reader, '/billing/bank-holidays/status')).body.data.basis).toBe('ACTUAL_DAY');
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'holiday_premium_basis_changed' }, orderBy: { createdAt: 'desc' } });
    expect(audit).toMatchObject({ userId: office.id, oldValues: { holidayPremiumBasis: 'BOTH' }, newValues: { holidayPremiumBasis: 'ACTUAL_DAY' } });
    expect(audit!.metadata).toMatchObject({ reason: 'Synthetic test: decided by the test client' });
  });

  it('ACTUAL_DAY: the weekend date is the holiday, the substitute weekday is an ordinary day', async () => {
    await setBasis('ACTUAL_DAY');
    expect(await pays(CHRISTMAS_2027)).toEqual([28, 28, 14, 14, 14]);
  });

  it('STATUTORY_DAY: the substitute weekday is the holiday, the weekend date is an ordinary weekend day', async () => {
    await setBasis('STATUTORY_DAY');
    expect(await pays(CHRISTMAS_2027)).toEqual([16, 18, 28, 28, 14]);
  });

  it('the client charge does not move with the carer pay policy', async () => {
    const before = [(await price('2027-12-25')).charge, (await price('2027-12-27')).charge];
    await setBasis('ACTUAL_DAY');
    const actual = [(await price('2027-12-25')).charge, (await price('2027-12-27')).charge];
    await setBasis('STATUTORY_DAY');
    const statutory = [(await price('2027-12-25')).charge, (await price('2027-12-27')).charge];
    expect(before).toEqual([40, 40]);
    expect(actual).toEqual(before);
    expect(statutory).toEqual(before);
  });

  it('a visit approved before the policy changed keeps the pay it was approved at', async () => {
    const substitute = await price('2027-12-27');
    expect(substitute.pay).toBe(28);
    await setBasis('ACTUAL_DAY');
    expect((await post(office, `/billing/visit-reconciliations/${substitute.id}/evaluate`)).status).toBe(201);
    const row = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: substitute.id } });
    expect(Number(row.payableAmount)).toBe(28);
    // A visit priced after the change follows the new policy.
    expect((await price('2027-12-27')).pay).toBe(14);
  });

  it('Scotland: a card on the Scottish calendar, with 2 January on a Saturday', async () => {
    await t.prisma.payCard.update({ where: { id: payCardId }, data: { bankHolidayRegion: 'SCOTLAND' } });
    expect((await holiday('2027-01-01', 'New Year’s Day', 'SCOTLAND')).status).toBe(201);
    const sub = await holiday('2027-01-04', '2nd January', 'SCOTLAND');
    expect(sub.body.data).toMatchObject({ isSubstitute: true });
    expect(sub.body.data.substituteForDate.slice(0, 10)).toBe('2027-01-02');
    const days = ['2027-01-02', '2027-01-04'];
    expect(await pays(days)).toEqual([16, 28]); // BOTH: unchanged from before
    await setBasis('ACTUAL_DAY');
    expect(await pays(days)).toEqual([28, 14]);
    // The England & Wales substitute days are not holidays on a Scottish card.
    expect(await pays(['2027-12-27'])).toEqual([14]);
  });

  it('an organisation special day is paid only where the card has a rate for special days', async () => {
    const created = await holiday('2027-11-10', 'Founders day', 'ORGANISATION');
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ region: 'ORGANISATION', isSubstitute: false });
    // The calendar alone creates no premium: not the bank holiday rate, not anything.
    expect(await pays(['2027-11-10'])).toEqual([14]);
    await setPayRules([hourly('WEEKDAY', 14), hourly('BANK_HOLIDAY', 28), hourly('SPECIAL', 21)]);
    expect(await pays(['2027-11-10', '2027-11-11'])).toEqual([21, 14]);
    // The organisation's days are listed apart from the nations', and are not a card's calendar.
    const list = await get(reader, '/billing/bank-holidays?region=ORGANISATION&year=2027');
    expect(list.body.data.map((h: { name: string }) => h.name)).toEqual(['Founders day']);
    const asCalendar = await patch(office, `/billing/pay-cards/${payCardId}`, { bankHolidayRegion: 'ORGANISATION' });
    expect(asCalendar.status).toBe(400);
  });

  it('the status says which years cannot be priced from, and why', async () => {
    const status = await get(reader, '/billing/bank-holidays/status?years=2027,2028');
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ years: [2027, 2028], complete: false });
    const uk = status.body.data.regions.find((r: { region: string }) => r.region === 'UK');
    expect(uk.years[0]).toMatchObject({ year: 2027, count: 2, complete: false });
    expect(uk.years[0].issues).toEqual(['2 dates are recorded for 2027; a normal year has 8.', "New Year's Day (2027-01-01) is missing."]);
    expect(uk.years[1]).toEqual({ year: 2028, count: 0, complete: false, issues: ['No dates are recorded for 2028.'] });

    // The pay card preview says so too, instead of pricing a holiday as an ordinary day in silence.
    const preview = await post(office, '/billing/pay-cards/preview', {
      date: '2028-04-14',
      startTime: '10:00',
      endTime: '11:00',
      rules: [hourly('WEEKDAY', 14), hourly('BANK_HOLIDAY', 28), hourly('EASTER', 30)],
    });
    expect(preview.status).toBe(201);
    expect(preview.body.data.amount).toBe(14); // Good Friday 2028 is not in the calendar yet
    expect(preview.body.data.warnings).toEqual(
      expect.arrayContaining([
        'The England & Wales bank holiday calendar for 2028 is not complete: No dates are recorded for 2028.',
        expect.stringContaining('This card has an Easter rate, but no day is classified as Easter'),
      ]),
    );
  });

  it('import from GOV.UK: adds the official dates with their substitute days, and only marks what is already there', async () => {
    // Already recorded by hand, with a name that does not say what it is; and one switched off.
    await t.prisma.bankHoliday.deleteMany();
    await t.prisma.bankHoliday.create({ data: { holidayDate: new Date('2027-12-27'), name: 'Day off', region: 'UK', source: 'LEGACY' } });
    await t.prisma.bankHoliday.create({ data: { holidayDate: new Date('2027-05-03'), name: 'Early May bank holiday', region: 'UK', isActive: false, source: 'LEGACY' } });
    const event = (title: string, date: string, notes = '') => ({ title, date, notes, bunting: true });
    const dataset = {
      'england-and-wales': { division: 'england-and-wales', events: [
        event('New Year’s Day', '2027-01-01'), event('Good Friday', '2027-03-26'), event('Easter Monday', '2027-03-29'),
        event('Early May bank holiday', '2027-05-03'), event('Spring bank holiday', '2027-05-31'), event('Summer bank holiday', '2027-08-30'),
        event('Christmas Day', '2027-12-27', 'Substitute day'), event('Boxing Day', '2027-12-28', 'Substitute day'),
      ] },
      scotland: { division: 'scotland', events: [event('2nd January', '2027-01-04', 'Substitute day')] },
      'northern-ireland': { division: 'northern-ireland', events: [event('St Patrick’s Day', '2027-03-17')] },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => dataset } as never);

    const imported = await post(office, '/billing/bank-holidays/import-gov-uk');
    expect(imported.status).toBe(201);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://www.gov.uk/bank-holidays.json');
    expect(imported.body.data).toMatchObject({ added: 8, alreadyPresent: 2, markedAsSubstitute: 1 });

    const rows = await t.prisma.bankHoliday.findMany({ where: { region: 'UK' }, orderBy: { holidayDate: 'asc' } });
    const byDate = Object.fromEntries(rows.map((r) => [r.holidayDate.toISOString().slice(0, 10), r]));
    // The hand-entered row keeps its name and source; it is now known to be Christmas Day's substitute.
    expect(byDate['2027-12-27']).toMatchObject({ name: 'Day off', source: 'LEGACY', isSubstitute: true });
    expect(byDate['2027-12-27'].substituteForDate?.toISOString().slice(0, 10)).toBe('2027-12-25');
    // A date the office switched off is not switched back on.
    expect(byDate['2027-05-03']).toMatchObject({ isActive: false, source: 'LEGACY' });
    expect(byDate['2027-12-28']).toMatchObject({ name: 'Boxing Day', source: 'GOV_UK', isSubstitute: true });
    expect(byDate['2027-03-26']).toMatchObject({ source: 'GOV_UK', isSubstitute: false });
    const scotland = await t.prisma.bankHoliday.findFirstOrThrow({ where: { region: 'SCOTLAND' } });
    expect(scotland.substituteForDate?.toISOString().slice(0, 10)).toBe('2027-01-02');

    // England & Wales 2027 now lacks only the date that was switched off.
    const uk = (await get(reader, '/billing/bank-holidays/status?years=2027')).body.data.regions.find((r: { region: string }) => r.region === 'UK');
    expect(uk.years[0]).toEqual({ year: 2027, count: 7, complete: false, issues: ['7 dates are recorded for 2027; a normal year has 8.'] });
    // Importing again changes nothing.
    const again = await post(office, '/billing/bank-holidays/import-gov-uk');
    expect(again.body.data).toMatchObject({ added: 0, markedAsSubstitute: 0 });
  });
});
