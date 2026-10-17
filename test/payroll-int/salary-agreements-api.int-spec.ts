/**
 * Gate B2, Stage 2 — salary agreements through the API (WM-02 / WM-03): entry per year, month or
 * week, effective dates, history, and approval by a second person. Real controllers and guards.
 * The agreements are synthetic policy (decision Q22 is open).
 */
import request from 'supertest';
import { resetPayData } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

const ORG = 'payroll.scope.organisation';
const MANAGE = ['payroll.employees.read', 'payroll.employees.manage', ORG];
const APPROVE = ['payroll.employees.read', 'payroll.pay_agreements.approve', ORG];

describe('salary agreements API (HTTP)', () => {
  let t: TestApp;
  let officer: { id: string };
  let officer2: { id: string };
  let approver: { id: string };
  let superAdmin: { id: string };
  let employeeId: string;
  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const patch = (user: { id: string }, path: string, body: Record<string, unknown>) =>
    request(server()).patch(path).set(as(user)).send(body);
  const list = async (user = officer) =>
    (await request(server()).get(`/payroll/employees/${employeeId}/pay-agreements`).set(as(user))).body.data as Array<Record<string, unknown>>;

  const SALARY = {
    basis: 'SALARIED',
    effectiveFrom: '2026-11-01',
    salaryEntryPeriod: 'MONTHLY',
    salaryEntryAmount: 2000,
    contractedHours: 37.5,
    salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
    salaryCoverage: 'ALL_VISIT_WORK',
  };
  const create = (body: Record<string, unknown>, by = officer) =>
    post(by, `/payroll/employees/${employeeId}/pay-agreements`, body);

  beforeAll(async () => {
    t = await createTestApp();
    // The built-in roles outlive every test: none of them may hold the approval power here.
    await t.prisma.rolePermission.deleteMany({
      where: { permission: { key: 'payroll.pay_agreements.approve' }, role: { name: { not: { startsWith: 'TEST ' } } } },
    });
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    officer = await createStaffUser(t.prisma, { permissions: MANAGE });
    officer2 = await createStaffUser(t.prisma, { permissions: MANAGE });
    approver = await createStaffUser(t.prisma, { permissions: APPROVE });
    superAdmin = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.close();
  });

  it('a salary can be entered per month, per week or per year; the yearly figure is stored', async () => {
    const monthly = await create(SALARY);
    expect(monthly.status).toBe(201);
    expect(monthly.body.data).toMatchObject({ annualSalary: 24000, salaryEntryPeriod: 'MONTHLY', salaryEntryAmount: 2000 });
    const weekly = await create({ ...SALARY, salaryEntryPeriod: 'WEEKLY', salaryEntryAmount: 500 });
    expect(weekly.body.data.annualSalary).toBe(26000);
    const yearly = await create({ ...SALARY, salaryEntryPeriod: undefined, salaryEntryAmount: undefined, annualSalary: 30000 });
    expect(yearly.body.data).toMatchObject({ annualSalary: 30000, salaryEntryPeriod: 'ANNUAL', salaryEntryAmount: 30000 });
  });

  it('a salary agreement must say how a part period is paid and what the salary pays for', async () => {
    expect((await create({ ...SALARY, salaryEntryAmount: undefined })).body.message).toMatch(/Enter the salary/);
    expect((await create({ ...SALARY, salaryProrationMethod: undefined })).body.message).toMatch(/how a part period is paid/);
    expect((await create({ ...SALARY, salaryCoverage: undefined })).body.message).toMatch(/what work the salary already pays for/);
    expect(
      (await create({ ...SALARY, salaryCoverage: 'CONTRACTED_HOURS', contractedHours: undefined })).body.message,
    ).toMatch(/contracted weekly hours/);
    expect((await create({ ...SALARY, salaryCoverage: 'EVERYTHING' })).status).toBe(400);
    expect((await create({ basis: 'HOURLY_CARE', effectiveFrom: '2026-11-01', annualSalary: 24000 })).body.message).toMatch(
      /hourly agreement does not carry a salary/,
    );
    expect(await list()).toHaveLength(0);
  });

  it('a salary takes effect only when a second person approves it', async () => {
    // Asked for ACTIVE, saved as a draft awaiting approval.
    const created = await create({ ...SALARY, status: 'ACTIVE' });
    expect(created.body.data).toMatchObject({ status: 'DRAFT', awaitingApproval: true });
    expect(created.body.message).toMatch(/second person approves/);
    const id = created.body.data.id as string;

    // It cannot be put into effect by editing it, by its author, or without the approval power.
    expect((await patch(officer, `/payroll/pay-agreements/${id}`, { status: 'ACTIVE' })).status).toBe(400);
    expect((await post(officer, `/payroll/pay-agreements/${id}/approve`)).status).toBe(403);
    expect((await post(officer2, `/payroll/pay-agreements/${id}/approve`)).status).toBe(403);
    // Super Admin does not carry the power either: it is granted by name.
    expect((await post(superAdmin, `/payroll/pay-agreements/${id}/approve`)).status).toBe(403);

    const approved = await post(approver, `/payroll/pay-agreements/${id}/approve`);
    expect(approved.status).toBe(201);
    expect(approved.body.data).toMatchObject({ status: 'ACTIVE', approvedById: approver.id });
    expect((await post(approver, `/payroll/pay-agreements/${id}/approve`)).status).toBe(400);

    const [row] = await list();
    expect(row).toMatchObject({ status: 'ACTIVE', awaitingApproval: false });
    expect(row.createdByName).toMatch(/^Test User/);
    expect(row.approvedByName).toMatch(/^Test User/);
    const actions = (await t.prisma.auditLog.findMany({ where: { recordId: id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['payroll_pay_agreement_created', 'payroll_pay_agreement_approved']));
  });

  it('the person who last changed a draft cannot approve it', async () => {
    const both = await createStaffUser(t.prisma, { permissions: [...MANAGE, 'payroll.pay_agreements.approve'] });
    const id = (await create(SALARY)).body.data.id as string;
    expect((await patch(both, `/payroll/pay-agreements/${id}`, { salaryEntryAmount: 2100 })).status).toBe(200);
    const refused = await post(both, `/payroll/pay-agreements/${id}/approve`);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/different person/);
    expect((await post(approver, `/payroll/pay-agreements/${id}/approve`)).body.data.annualSalary).toBe(25200);
  });

  it('a change of salary is a new agreement from its date; the earlier one stays as history', async () => {
    const first = (await create({ ...SALARY, effectiveFrom: '2026-01-01' })).body.data.id as string;
    await post(approver, `/payroll/pay-agreements/${first}/approve`);

    // Pay terms in effect are not rewritten.
    const edit = await patch(officer, `/payroll/pay-agreements/${first}`, { salaryEntryAmount: 2500 });
    expect(edit.status).toBe(400);
    expect(edit.body.message).toMatch(/not edited/);
    expect((await patch(officer, `/payroll/pay-agreements/${first}`, { status: 'DRAFT' })).status).toBe(400);

    const rise = (await create({ ...SALARY, effectiveFrom: '2026-11-16', salaryEntryAmount: 2500 })).body.data.id as string;
    // Until it is approved the earlier salary still applies.
    expect((await list()).find((a) => a.id === first)).toMatchObject({ status: 'ACTIVE' });
    await post(approver, `/payroll/pay-agreements/${rise}/approve`);
    const rows = await list();
    expect(rows.map((a) => [a.effectiveFrom, a.status, a.annualSalary])).toEqual([
      ['2026-11-16', 'ACTIVE', 30000],
      ['2026-01-01', 'SUPERSEDED', 24000],
    ]);
  });

  it('an agreement approved for a later date leaves the current one in effect until then', async () => {
    const later = (await create({ ...SALARY, effectiveFrom: '2027-04-01', salaryEntryAmount: 2500 })).body.data.id as string;
    await post(approver, `/payroll/pay-agreements/${later}/approve`);
    const now = (await create({ ...SALARY, effectiveFrom: '2026-11-01' })).body.data.id as string;
    await post(approver, `/payroll/pay-agreements/${now}/approve`);
    expect((await list()).map((a) => [a.effectiveFrom, a.status])).toEqual([
      ['2027-04-01', 'ACTIVE'],
      ['2026-11-01', 'ACTIVE'],
    ]);
  });

  it('a leaver: the agreement is ended on its last day, with the date required', async () => {
    const id = (await create({ ...SALARY, effectiveFrom: '2026-01-01' })).body.data.id as string;
    await post(approver, `/payroll/pay-agreements/${id}/approve`);
    expect((await patch(officer, `/payroll/pay-agreements/${id}`, { status: 'TERMINATED' })).body.message).toMatch(/last day/);
    const ended = await patch(officer, `/payroll/pay-agreements/${id}`, { status: 'TERMINATED', effectiveTo: '2026-11-10' });
    expect(ended.status).toBe(200);
    expect(ended.body.data).toMatchObject({ status: 'TERMINATED', effectiveTo: '2026-11-10' });
    const stored = await t.prisma.employeePayAgreement.findUniqueOrThrow({ where: { id } });
    expect(stored.termsChangedAt).not.toBeNull();
  });

  it('replacing a salary with hourly pay also needs the second person; plain hourly agreements work as before', async () => {
    const hourlyOnly = await create({ basis: 'HOURLY_CARE', effectiveFrom: '2026-01-01', status: 'ACTIVE' });
    expect(hourlyOnly.body.data).toMatchObject({ status: 'ACTIVE', awaitingApproval: false });

    const salary = (await create(SALARY)).body.data.id as string;
    await post(approver, `/payroll/pay-agreements/${salary}/approve`);
    const backToHourly = await create({ basis: 'HOURLY_CARE', effectiveFrom: '2026-12-01', status: 'ACTIVE' });
    expect(backToHourly.body.data).toMatchObject({ status: 'DRAFT', awaitingApproval: true });
  });

  it('requires the manage permission to enter an agreement', async () => {
    expect((await create(SALARY, approver)).status).toBe(403);
    expect((await request(server()).post(`/payroll/employees/${employeeId}/pay-agreements`).send(SALARY)).status).toBe(401);
  });
});
