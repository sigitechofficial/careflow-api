/**
 * Gate B2 — one synthetic week and month, end to end, through the real application.
 *
 * People (all synthetic): Hana, hourly with overtime, travel, mileage and a bonus; Gus, hourly
 * with a guaranteed 14 hours; Sal, salaried with the salary covering visit work; Lou, paid below
 * the minimum wage; Cal, whose visit found nobody home. Every rate, agreement and rule is
 * SYNTHETIC POLICY: none of it is Allfor Care's.
 *
 * The steps run in order and share the data. Each is one of the fifteen Gate B2 validations
 * (V-nn in docs/…/09-end-to-end-validation.md). Tax and NI are a stand-in: statutory payroll is
 * outside this phase.
 */
import request from 'supertest';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createApprovedVisit, createUkRun, markStatutoryCalculated, resetPayData, uuid } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('Gate B2 end to end: employment wages for one synthetic period', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let preparer: { id: string };
  let preparer2: { id: string };
  let approver: { id: string };
  let payCardId: string;
  const people: Record<'hana' | 'gus' | 'sal' | 'lou' | 'cal', string> = { hana: '', gus: '', sal: '', lou: '', cal: '' };
  const visits: Record<string, string> = {};
  let weekRun = '';
  let lockedSnapshot = '';
  let bonusId = '';
  let ukRun = '';

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
  const linesOf = (payrollRunId: string, employeeId?: string) =>
    t.prisma.payrollRunLine.findMany({ where: { payrollRunId, ...(employeeId ? { employeeId } : {}) }, orderBy: [{ lineType: 'asc' }, { createdAt: 'asc' }] });
  const byType = (lines: Array<{ lineType: string; amount: unknown }>) => {
    const out: Record<string, number> = {};
    for (const l of lines) out[l.lineType] = Math.round(((out[l.lineType] ?? 0) + Number(l.amount)) * 100) / 100;
    return out;
  };
  const snapshot = async (payrollRunId: string) =>
    JSON.stringify(
      (await linesOf(payrollRunId)).map((l) => [l.id, l.lineType, String(l.amount), l.claimKey, l.minutes, l.description]).sort(),
    );
  const work = async (who: keyof typeof people, key: string, start: string, hours: number, hourly = 14, over: Record<string, unknown> = {}) => {
    const visit = await createApprovedVisit(t.prisma, { employeeId: people[who], start, minutes: hours * 60, amount: hours * hourly });
    await t.prisma.visitReconciliation.update({ where: { id: visit.id }, data: { payCardId, ...over } });
    visits[key] = visit.id;
  };
  const ukTotals = async (runId: string, who: keyof typeof people) => {
    const row = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId: people[who] } });
    return {
      visitPay: Number(row.visitPay),
      salaryPay: Number(row.salaryPay),
      travelPay: Number(row.travelPay),
      nmwTopUp: Number(row.nmwTopUp),
      otherPay: Number(row.otherPay),
      expenseTotal: Number(row.expenseTotal),
      totalGross: Number(row.totalGross),
    };
  };

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = buildUkPayrollRunsService(t.prisma).service;
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    payCardId = (await seedDefaultCards(t.prisma, 14)).payCardId;
    // Synthetic card rules: overtime at time and a half above 10 hours a week, travel time at £12.00.
    await t.prisma.payCardRule.createMany({
      data: [
        { payCardId, label: 'Overtime', dayType: 'ANY', rateType: 'OVERTIME', amount: 1.5, enhancementMethod: 'MULTIPLIER', minimumMinutes: 600 },
        { payCardId, label: 'Travel time', dayType: 'ANY', rateType: 'TRAVEL_TIME', amount: 12 },
      ] as never,
    });
    const org = 'payroll.scope.organisation';
    const prepare = ['billing.payroll_runs.read', 'billing.payroll_runs.manage', 'billing.pay_cards.manage', 'billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', org];
    preparer = await createStaffUser(t.prisma, { permissions: prepare });
    preparer2 = await createStaffUser(t.prisma, { permissions: prepare });
    approver = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', org] });
    for (const who of Object.keys(people) as Array<keyof typeof people>) people[who] = (await createCarer(t.prisma)).employeeId;

    const approved = { approvedById: uuid(), approvedAt: new Date('2026-01-01T09:00:00Z') };
    await t.prisma.employeePayAgreement.create({
      data: { employeeId: people.gus, basis: 'HOURLY_CARE', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), guaranteedWeeklyHours: 14, guaranteeTopUp: 'PAY_SHORTFALL', guaranteeQualifyingTime: 'VISITS', ...approved } as never,
    });
    await t.prisma.employeePayAgreement.create({
      data: { employeeId: people.sal, basis: 'SALARIED', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), annualSalary: 24_000, contractedHours: 30, salaryEntryPeriod: 'MONTHLY', salaryEntryAmount: 2_000, salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS', salaryCoverage: 'ALL_VISIT_WORK', termsChangedAt: approved.approvedAt, ...approved } as never,
    });

    // The week of Monday 2 November 2026.
    await work('hana', 'hanaMon', '2026-11-02T09:00:00Z', 6);
    await work('hana', 'hanaTueA', '2026-11-03T09:00:00Z', 3);
    await work('hana', 'hanaTueB', '2026-11-03T12:40:00Z', 3, 14, { travelMiles: 10 }); // 40 minutes after the first, 10 miles
    await work('gus', 'gusWed', '2026-11-04T08:00:00Z', 10);
    await work('sal', 'salThu', '2026-11-05T09:00:00Z', 2);
    await work('lou', 'louFri', '2026-11-06T08:00:00Z', 10, 12);
    const bonus = await t.prisma.employeePayItem.create({
      data: { employeeId: people.hana, wageTypeCode: 'BONUS', workDate: new Date('2026-11-03'), unit: 'AMOUNT', amount: 25, reason: 'Synthetic bonus', status: 'APPROVED', createdById: preparer.id, approvedById: preparer2.id, approvedAt: new Date() } as never,
    });
    bonusId = bonus.id;
  }, 300_000);
  afterAll(async () => {
    await t.close();
  });

  it('V-06: a cancelled visit follows the approved rule, not zero by default', async () => {
    const rule = await post(preparer, '/billing/visit-disruptions/rules', { eventType: 'NOBODY_HOME', outcome: 'FULL_SCHEDULED', effectiveFrom: '2026-01-01', isSynthetic: true });
    expect((await post(preparer2, `/billing/visit-disruptions/rules/${rule.body.data.id}/approve`)).status).toBe(201);
    const event = await post(preparer, '/billing/visit-disruptions', {
      employeeId: people.cal,
      scheduledJobId: uuid(),
      eventType: 'NOBODY_HOME',
      eventAt: '2026-11-04T09:00:00Z',
      scheduledMinutes: 60,
      reason: 'Synthetic: no answer at the door',
    });
    expect(event.body.data).toMatchObject({ status: 'PENDING_APPROVAL', amount: 14 });
    expect((await post(preparer2, `/billing/visit-disruptions/${event.body.data.id}/approve`)).status).toBe(201);
  });

  it('V-01, V-03, V-04, V-05, V-08, V-09: the week pay run pays each kind of earning once and shows what it cannot work out', async () => {
    // A training activity on a card with no training rate: it must be shown, not dropped (V-09).
    const training = await t.prisma.employeeNonCoreActivity.create({
      data: { employeeId: people.hana, dateFrom: new Date('2026-11-05T10:00:00Z'), dateTo: new Date('2026-11-05T12:00:00Z'), includeInPayroll: true },
    });
    weekRun = await newRun('2026-11-02', '2026-11-08');
    await calculate(weekRun);

    // V-01 hourly carer: 12 hours of visits at £14.00, the bonus, and nothing else as wages.
    const hana = await linesOf(weekRun, people.hana);
    expect(byType(hana.filter((l) => l.sourceType !== 'HELD_EARNING'))).toMatchObject({ VISIT_PAY: 168, BONUS: 25, OVERTIME: 14, TRAVEL_TIME: 8 });
    // V-04 overtime: 2 hours above the 10-hour week, premium only.
    expect(hana.find((l) => l.lineType === 'OVERTIME')).toMatchObject({ minutes: 120, claimKey: `OVERTIME:${people.hana}:2026-11-02:1` });
    // V-05 travel pay and mileage are separate lines: time on one, miles on the other.
    const travel = hana.find((l) => l.lineType === 'TRAVEL_TIME');
    const mileage = hana.find((l) => l.lineType === 'MILEAGE');
    expect(travel).toMatchObject({ minutes: 40, quantity: null });
    expect(Number(mileage?.quantity)).toBe(10);
    expect(mileage?.minutes).toBeNull();
    expect(Number(mileage?.amount)).toBeGreaterThan(0);
    // V-09 a missing pay rule is a visible exception.
    const held = hana.find((l) => l.sourceType === 'HELD_EARNING');
    expect(held).toMatchObject({ sourceRef: `HELD:ACTIVITY:${training.id}`, claimKey: null });
    expect(held?.exceptionMessage).toMatch(/has no training rate/);

    // V-03 guarantee top-up: 10 of 14 hours worked.
    expect(byType(await linesOf(weekRun, people.gus))).toEqual({ VISIT_PAY: 140, GUARANTEED_HOURS: 56 });
    // V-08 minimum wage: 10 hours at £12.00 against £12.71, on the period, topped up once.
    const lou = await linesOf(weekRun, people.lou);
    expect(byType(lou)).toEqual({ VISIT_PAY: 120, NMW_TOP_UP: 7.1 });
    expect(lou.find((l) => l.lineType === 'NMW_TOP_UP')?.claimKey).toBe(`NMW:${people.lou}:2026-11-02:1`);
    // V-06 the approved cancellation payment.
    expect(byType(await linesOf(weekRun, people.cal))).toEqual({ CANCELLATION: 14 });
    // The salaried worker's visit is a visit line here; UK payroll decides what the salary covers.
    expect(byType(await linesOf(weekRun, people.sal))).toEqual({ VISIT_PAY: 28 });

    // The activity is given a pay item instead, so the run can be completed.
    await t.prisma.employeeNonCoreActivity.update({ where: { id: training.id }, data: { includeInPayroll: false } });
    await calculate(weekRun);
    expect((await linesOf(weekRun)).filter((l) => l.sourceType === 'HELD_EARNING')).toEqual([]);
  });

  it('V-15: every source earning reconciles to exactly one pay-run line, and the run total is the sum of its lines', async () => {
    const lines = await linesOf(weekRun);
    // Each approved visit: one visit pay line, claimed by the visit, for the approved amount.
    for (const visitId of Object.values(visits)) {
      const visit = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visitId } });
      const own = lines.filter((l) => l.visitReconciliationId === visitId && l.lineType === 'VISIT_PAY');
      expect(own).toHaveLength(1);
      expect(own[0].claimKey).toBe(`VISIT:${visitId}:VISIT_PAY`);
      expect(Number(own[0].amount)).toBe(Number(visit.payableAmount));
    }
    // Each approved pay item: one line, claimed by the item.
    const items = await t.prisma.employeePayItem.findMany({ where: { status: 'APPROVED' } });
    expect(items).toHaveLength(2); // the bonus and the cancellation payment
    for (const item of items) {
      const own = lines.filter((l) => l.employeePayItemId === item.id);
      expect(own).toHaveLength(1);
      expect(own[0].claimKey).toBe(`PAY_ITEM:${item.id}`);
      expect(Number(own[0].amount)).toBe(Number(item.amount));
    }
    // Every line has an identity: no line is paid without a claim.
    expect(lines.filter((l) => !l.claimKey)).toEqual([]);
    expect(new Set(lines.map((l) => l.claimKey)).size).toBe(lines.length);

    const run = await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: weekRun } });
    const isExpense = (type: string) => type === 'MILEAGE' || type === 'PASSENGER_MILEAGE' || type === 'EXPENSE';
    const wages = lines.filter((l) => !isExpense(l.lineType)).reduce((sum, l) => sum + Number(l.amount), 0);
    expect(Number(run.grossPay)).toBeCloseTo(wages, 2);
    expect(Number(run.nmwTopUp)).toBe(7.1);
  });

  it('V-12: locking fixes the history; a further run over the same dates finds nothing left', async () => {
    await lock(weekRun);
    lockedSnapshot = await snapshot(weekRun);
    expect((await post(preparer, `/billing/payroll-runs/${weekRun}/calculate`)).status).toBe(400);
    const again = await newRun('2026-11-02', '2026-11-08');
    await calculate(again);
    expect(await linesOf(again)).toEqual([]);
  });

  it('V-11: a corrected earning enters a later run once', async () => {
    const correction = await post(preparer, '/billing/pay-items/visit-corrections', {
      visitReconciliationId: visits.hanaMon,
      correctedAmount: 91,
      reason: 'Synthetic: visit ran thirty minutes over',
    });
    expect(correction.status).toBe(201);
    const pending = await t.prisma.employeePayItem.findFirstOrThrow({ where: { sourceType: 'VISIT_CORRECTION', sourceId: visits.hanaMon } });
    expect((await post(preparer2, `/billing/pay-items/${pending.id}/approve`)).status).toBe(201);

    const later = await newRun('2026-11-09', '2026-11-15');
    await calculate(later);
    expect((await linesOf(later, people.hana)).map((l) => [l.lineType, Number(l.amount)])).toEqual([['ADJUSTMENT', 7]]);
    await lock(later);
    const afterThat = await newRun('2026-11-16', '2026-11-22');
    await calculate(afterThat);
    expect(await linesOf(afterThat, people.hana)).toEqual([]);
    // The locked week is exactly as it was.
    expect(await snapshot(weekRun)).toBe(lockedSnapshot);
  });

  it('V-02, V-14: UK payroll gross — the salaried worker is not paid visit wages again; expenses come in once, apart from wages', async () => {
    ukRun = await createUkRun(t.prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: Object.values(people), createdById: preparer.id });
    await ukRuns.calculateGross(preparer.id, ukRun);

    // V-02 salary once; the visit the salary already pays for is settled at nothing, with its value recorded.
    expect(await ukTotals(ukRun, 'sal')).toMatchObject({ salaryPay: 2_000, visitPay: 0, totalGross: 2_000 });
    const covered = await t.prisma.ukPayrollInputLine.findFirstOrThrow({ where: { runId: ukRun, employeeId: people.sal, lineType: 'VISIT_PAY' } });
    expect(covered).toMatchObject({ unpaidReason: 'COVERED_BY_SALARY' });
    expect(Number(covered.unpaidAmount)).toBe(28);

    // V-01 / V-04 / V-05 the hourly carer: wages by kind, with the correction of the later run.
    const hana = await ukTotals(ukRun, 'hana');
    expect(hana).toMatchObject({ visitPay: 168, travelPay: 8, otherPay: 46 }); // overtime 14 + bonus 25 + correction 7
    // V-14 the mileage is a reimbursement: in expenses, not in gross.
    expect(hana.expenseTotal).toBeGreaterThan(0);
    expect(hana.totalGross).toBe(222);
    // V-03 the guarantee: £56.00 for the week worked short, and the whole 14 hours (£196.00) for the
    // following week, in which nothing was scheduled (settled by the later, locked run).
    expect(await ukTotals(ukRun, 'gus')).toMatchObject({ visitPay: 140, otherPay: 252, totalGross: 392 });
    expect(await ukTotals(ukRun, 'lou')).toMatchObject({ visitPay: 120, nmwTopUp: 7.1, totalGross: 127.1 });
    expect(await ukTotals(ukRun, 'cal')).toMatchObject({ otherPay: 14, totalGross: 14 });

    // V-15 every locked pay line of these people is brought in once.
    const lockedLines = await t.prisma.payrollRunLine.findMany({ where: { employeeId: { in: Object.values(people) }, payrollRun: { status: 'LOCKED' } } });
    const inputs = await t.prisma.ukPayrollInputLine.findMany({ where: { runId: ukRun, sourcePayrollRunLineId: { not: null } } });
    expect(inputs.map((i) => i.sourcePayrollRunLineId).sort()).toEqual(lockedLines.map((l) => l.id).sort());
  });

  it('V-13: cancelling the UK run does not strand the earnings; the replacement collects the same', async () => {
    const before = Object.fromEntries(await Promise.all((Object.keys(people) as Array<keyof typeof people>).map(async (who) => [who, await ukTotals(ukRun, who)])));
    await ukRuns.cancel(preparer.id, ukRun, undefined, 'Synthetic: wrong payment date');
    expect(await t.prisma.ukPayrollInputLine.count({ where: { runId: ukRun, claimKey: { not: null } } })).toBe(0);

    const replacement = await createUkRun(t.prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: Object.values(people), createdById: preparer.id });
    await ukRuns.calculateGross(preparer.id, replacement);
    for (const who of Object.keys(people) as Array<keyof typeof people>) {
      // The salary claim belongs to the pay period of each run; everything else is identical.
      expect({ ...(await ukTotals(replacement, who)), salaryPay: 0, totalGross: 0 }).toEqual({ ...before[who], salaryPay: 0, totalGross: 0 });
    }
    expect(await ukTotals(replacement, 'sal')).toMatchObject({ salaryPay: 2_000, totalGross: 2_000 });
    ukRun = replacement;
  });

  it('V-12, V-14: closing settles everything once; a later run in the period pays no salary and no expense again', async () => {
    await markStatutoryCalculated(t.prisma, ukRun);
    await ukRuns.close(approver.id, ukRun);
    const base = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: ukRun } });
    const supplementary = await t.prisma.ukPayrollRun.create({
      data: {
        periodId: base.periodId,
        taxYearId: base.taxYearId,
        scheduleId: base.scheduleId,
        runNumber: 2,
        label: 'Synthetic supplementary',
        status: 'EMPLOYEES_ENROLLED',
        employeeCount: Object.values(people).length,
        createdById: preparer.id,
        employees: { create: Object.values(people).map((employeeId) => ({ employeeId })) },
      },
    });
    await expect(ukRuns.calculateGross(preparer.id, supplementary.id)).rejects.toThrow(/No visit-pay or salary inputs/);
    expect(await t.prisma.ukPayrollInputLine.count({ where: { employeeId: people.sal, lineType: 'SALARY', claimKey: { not: null } } })).toBe(1);
    expect(await t.prisma.ukPayrollInputLine.count({ where: { employeeId: people.hana, isExpense: true, claimKey: { not: null } } })).toBe(1);
    // After everything above, the locked week is still exactly as it was locked.
    expect(await snapshot(weekRun)).toBe(lockedSnapshot);
  });

  it('V-10: an incomplete bank holiday calendar is a visible hold, not an ordinary-rate payment', async () => {
    await t.prisma.payCardRule.create({ data: { payCardId, label: 'Bank holiday', dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 28 } as never });
    // Easter Monday 2027 is normally a bank holiday; the calendar is given no entry for it.
    await t.prisma.bankHoliday.deleteMany();
    await work('hana', 'hanaEaster', '2027-03-29T09:00:00Z', 2);
    const easter = await newRun('2027-03-29', '2027-04-04');
    await calculate(easter);
    const [line] = (await linesOf(easter, people.hana)).filter((l) => l.lineType === 'VISIT_PAY');
    expect(line).toMatchObject({ sourceType: 'HELD_EARNING', sourceRef: `HELD:VISIT:${visits.hanaEaster}`, claimKey: null });
    expect(Number(line.amount)).toBe(0);
    expect(line.exceptionMessage).toMatch(/Carer pay is held: 2027-03-29 is normally Easter Monday/);
  });

  it('V-07: holiday pay follows the worker category, not one method for everyone', async () => {
    const officer = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.employees.manage', 'payroll.scope.organisation'] });
    const leaveApprover = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.pay_agreements.approve', 'payroll.scope.organisation'] });
    const terms = async (employeeId: string, body: Record<string, unknown>) => {
      const created = await post(officer, `/payroll/employees/${employeeId}/leave-terms`, { leaveYearStartMonth: 4, effectiveFrom: '2026-04-01', ...body });
      expect((await post(leaveApprover, `/payroll/leave-terms/${created.body.data.id}/approve`)).status).toBe(201);
    };
    // The normal week is the contracted weekly hours on the employee's record.
    await t.prisma.employeeEmployment.updateMany({ where: { employeeId: people.gus }, data: { contractedWeeklyHours: 14 } });
    await terms(people.gus, { workerCategory: 'REGULAR_HOURS', payMethod: 'NORMAL_REMUNERATION_52_WEEKS' });
    await terms(people.hana, { workerCategory: 'IRREGULAR_HOURS', payMethod: 'ROLLED_UP_12_07' });
    const position = async (employeeId: string) =>
      (await request(server()).get(`/payroll/employees/${employeeId}/leave?asOf=2026-11-30`).set(bearer(t.staffToken(officer.id)))).body.data;

    const gus = await position(people.gus);
    expect(gus.statutory.fullYearEntitlement).toBe(78.4); // 5.6 weeks of 14 hours
    expect(gus.holidayPay).toMatchObject({ method: 'NORMAL_REMUNERATION_52_WEEKS', weeksUsed: 1, averageHourlyPay: 14 });
    const hana = await position(people.hana);
    expect(hana.statutory.entitlement).toBe(1); // 12.07% of 12 hours worked in November
    expect(hana.holidayPay.method).toBe('ROLLED_UP_12_07');
    expect((await position(people.lou)).terms).toBeNull(); // no terms: nothing assumed
  });
});
