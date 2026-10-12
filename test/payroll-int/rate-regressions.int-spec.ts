/**
 * Gate A sprint — regression check of PC-21 through the real reconciliation service and the bank
 * holiday calendar in the database: all-day bands, midnight, actual and substitute holidays, fixed
 * and hourly rates, for carer pay and for the client charge.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { buildReconciliationService, createCompletedVisit, createTestPrisma, resetPayData } from './harness';

describe('PC-21: all-day rates and holidays, priced from stored cards and calendar', () => {
  let prisma: PrismaService;
  let recons: VisitReconciliationsService;
  let payCardId: string;
  let chargeCardId: string;

  const band = { startTime: '00:00', endTime: '23:59' };
  const hourly = (dayType: string, amount: number, allDay = true) => ({
    label: dayType,
    dayType,
    rateType: 'HOURLY',
    amount,
    ...(allDay ? band : {}),
  });
  const setRules = async (pay: object[], charge: object[]) => {
    await prisma.payCardRule.deleteMany({ where: { payCardId } });
    await prisma.payCardRule.createMany({ data: pay.map((r) => ({ ...r, payCardId })) as never });
    await prisma.chargeCardRule.deleteMany({ where: { chargeCardId } });
    await prisma.chargeCardRule.createMany({ data: charge.map((r) => ({ ...r, chargeCardId })) as never });
  };
  const holiday = (date: string, name: string) =>
    prisma.bankHoliday.create({ data: { holidayDate: new Date(`${date}T00:00:00.000Z`), name: `TEST ${name}`, region: 'UK' } });
  /** Prices a completed visit and returns what the carer is paid and the client is charged. */
  const price = async (start: string, minutes: number) => {
    const visit = await createCompletedVisit(prisma, { start, plannedMinutes: minutes });
    const id = (await recons.ensureForVisit(visit.visitId))!;
    const row = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
    return { pay: Number(row.payableAmount), charge: Number(row.billableAmount) };
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
  });
  beforeEach(async () => {
    await resetPayData(prisma);
    await prisma.bankHoliday.deleteMany({ where: { name: { startsWith: 'TEST ' } } });
    const built = await buildReconciliationService(prisma);
    recons = built.service;
    payCardId = built.card.id;
    chargeCardId = built.chargeCard.id;
    await setRules(
      [hourly('WEEKDAY', 14, false), hourly('SATURDAY', 16), hourly('SUNDAY', 18), hourly('BANK_HOLIDAY', 28)],
      [hourly('WEEKDAY', 20, false), hourly('SATURDAY', 22), hourly('SUNDAY', 24), hourly('BANK_HOLIDAY', 40)],
    );
  });
  afterAll(async () => {
    await prisma.bankHoliday.deleteMany({ where: { name: { startsWith: 'TEST ' } } });
    await prisma.$disconnect();
  });

  it('the last minute of Sunday, and a visit across Sunday midnight, for pay and for charge', async () => {
    // Sun 15 Nov 2026 23:00 to Mon 00:00: one hour of Sunday.
    expect(await price('2026-11-15T23:00:00Z', 60)).toEqual({ pay: 18, charge: 24 });
    // Sun 22:00 to Mon 00:30: 2h Sunday + 0.5h weekday.
    expect(await price('2026-11-15T22:00:00Z', 150)).toEqual({ pay: 43, charge: 58 });
  });

  it('clock change: a visit over the repeated hour is paid and charged for the time worked', async () => {
    // Sun 25 Oct 2026 00:30 BST to 02:30 GMT is three hours of Sunday.
    expect(await price('2026-10-24T23:30:00Z', 180)).toEqual({ pay: 54, charge: 72 });
  });

  it('a substitute bank holiday in the calendar is priced as a bank holiday', async () => {
    // Christmas Day 2027 is a Saturday; the bank holiday is given on Monday 27 December.
    await holiday('2027-12-27', 'Christmas Day (substitute day)');
    await holiday('2027-12-28', 'Boxing Day (substitute day)');
    expect(await price('2027-12-27T10:00:00Z', 60)).toEqual({ pay: 28, charge: 40 });
    expect(await price('2027-12-28T10:00:00Z', 60)).toEqual({ pay: 28, charge: 40 });
    // The day after the holidays is an ordinary weekday again.
    expect(await price('2027-12-29T10:00:00Z', 60)).toEqual({ pay: 14, charge: 20 });

    // New Year's Day 2028 is a Saturday; the bank holiday is Monday 3 January.
    await holiday('2028-01-03', 'New Year (substitute day)');
    // An ordinary Sunday into the substitute Monday: 1h Sunday + 0.5h bank holiday.
    expect(await price('2028-01-02T23:00:00Z', 90)).toEqual({ pay: 32, charge: 44 });
  });

  it('25 and 26 December and 1 January are premium days by date, whether or not the calendar lists them', async () => {
    // Existing behaviour, recorded so that a change is deliberate: with no rule of their own these
    // days use the bank holiday rate. In a year with substitute days the actual day and the
    // substitute day are therefore both paid at the premium (policy decision D-13).
    await holiday('2027-12-27', 'Christmas Day (substitute day)');
    expect(await price('2027-12-25T10:00:00Z', 60)).toEqual({ pay: 28, charge: 40 }); // Saturday
    expect(await price('2027-12-26T10:00:00Z', 60)).toEqual({ pay: 28, charge: 40 }); // Sunday
    expect(await price('2028-01-01T10:00:00Z', 60)).toEqual({ pay: 28, charge: 40 }); // Saturday
    // Sunday 26 December into the substitute Monday: premium on both sides of midnight.
    expect(await price('2027-12-26T23:00:00Z', 90)).toEqual({ pay: 42, charge: 60 });
    // Adding the actual day to the calendar changes nothing.
    await holiday('2027-12-25', 'Christmas Day');
    expect(await price('2027-12-25T14:00:00Z', 60)).toEqual({ pay: 28, charge: 40 });
  });

  it('a card with its own Christmas rate uses it on the actual day only', async () => {
    await holiday('2027-12-27', 'Christmas Day (substitute day)');
    await prisma.payCardRule.create({ data: { ...hourly('CHRISTMAS', 35), payCardId } as never });
    expect((await price('2027-12-25T10:00:00Z', 60)).pay).toBe(35);
    expect((await price('2027-12-27T10:00:00Z', 60)).pay).toBe(28);
  });

  it('PC-19: just after midnight in summer time, a fixed fee is the fee of the local day', async () => {
    const fixedFee = (dayType: string, amount: number) => ({
      label: `${dayType} 30 min`,
      dayType,
      rateType: 'FIXED',
      amount,
      minimumMinutes: 30,
    });
    await setRules(
      [fixedFee('WEEKDAY', 8), fixedFee('SATURDAY', 10), { label: 'Hourly', dayType: 'ANY', rateType: 'HOURLY', amount: 14 }],
      [fixedFee('WEEKDAY', 13), fixedFee('SATURDAY', 16), { label: 'Hourly', dayType: 'ANY', rateType: 'HOURLY', amount: 24 }],
    );
    // Saturday 6 June 2026, 00:15 local (BST) is still Friday 23:15 in UTC.
    expect(await price('2026-06-05T23:15:00Z', 30)).toEqual({ pay: 10, charge: 16 });
    // Friday 5 June, 20:00 local, is a weekday.
    expect(await price('2026-06-05T19:00:00Z', 30)).toEqual({ pay: 8, charge: 13 });
    // In winter local time and UTC agree.
    expect(await price('2026-11-07T00:15:00Z', 30)).toEqual({ pay: 10, charge: 16 });
  });

  it('a fixed visit fee and an hourly rate on the same card: short visit fixed, long visit hourly', async () => {
    const fixed = (minutes: number, amount: number) => ({
      label: `${minutes} min`,
      dayType: 'ANY',
      rateType: 'FIXED',
      amount,
      minimumMinutes: minutes,
    });
    await setRules(
      [fixed(30, 8), fixed(60, 15), { label: 'Hourly', dayType: 'ANY', rateType: 'HOURLY', amount: 14 }],
      [fixed(30, 13), fixed(60, 25), { label: 'Hourly', dayType: 'ANY', rateType: 'HOURLY', amount: 24 }],
    );
    expect(await price('2026-11-03T09:00:00Z', 30)).toEqual({ pay: 8, charge: 13 });
    expect(await price('2026-11-03T11:00:00Z', 60)).toEqual({ pay: 15, charge: 25 });
    // Longer than an hour: hourly rate for the whole visit.
    expect(await price('2026-11-03T13:00:00Z', 90)).toEqual({ pay: 21, charge: 36 });
    // Across midnight the fixed fee is still one fee, not one per day.
    expect(await price('2026-11-03T23:45:00Z', 30)).toEqual({ pay: 8, charge: 13 });
  });
});
