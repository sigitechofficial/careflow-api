import {
  FINANCIAL_POWERS,
  summariseFinancialAuthority,
  userHoldsPower,
  type AuthorityUser,
} from './financial-authority.util';

const power = (key: string) => FINANCIAL_POWERS.find((p) => p.key === key)!;
const user = (name: string, ...roles: Array<[string, string[]]>): AuthorityUser => ({
  id: name,
  name,
  roles: roles.map(([roleName, permissions]) => ({ name: roleName, permissions })),
});
const ORG = 'payroll.scope.organisation';
const PREPARE = ['billing.payroll_runs.manage', 'payroll.runs.manage', 'billing.employee_payouts.manage'];
const APPROVE = [
  'billing.payroll_runs.approve',
  'payroll.runs.close',
  'payroll.runs.reopen',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
];

describe('financial authority (R-12)', () => {
  it('a Super Admin prepares pay but does not approve it without an explicit grant', () => {
    const admin = user('Sam', ['Super Admin', []]);
    expect(userHoldsPower(admin, power('prepare-pay-runs'))).toBe(true);
    expect(userHoldsPower(admin, power('view-payroll-audit'))).toBe(true);
    for (const key of ['approve-pay-runs', 'close-uk-payroll', 'reopen-uk-payroll', 'approve-payouts', 'record-settlement']) {
      expect(userHoldsPower(admin, power(key))).toBe(false);
    }
  });

  it('a Super Admin who is also given the approver role does approve', () => {
    const admin = user('Sam', ['Super Admin', []], ['Payroll Approver', [...APPROVE, ORG]]);
    expect(userHoldsPower(admin, power('approve-pay-runs'))).toBe(true);
    expect(userHoldsPower(admin, power('record-settlement'))).toBe(true);
  });

  it('a branch role with the permission but without organisation-wide pay access does not hold the power', () => {
    expect(userHoldsPower(user('Bo', ['Manager', APPROVE]), power('approve-pay-runs'))).toBe(false);
    expect(userHoldsPower(user('Bo', ['Manager', [...APPROVE, ORG]]), power('approve-pay-runs'))).toBe(true);
    // Admin is company-wide by role, but still needs the approval permission itself.
    expect(userHoldsPower(user('Al', ['Admin', APPROVE]), power('approve-pay-runs'))).toBe(true);
    expect(userHoldsPower(user('Al', ['Admin', PREPARE]), power('approve-pay-runs'))).toBe(false);
  });

  it('warns for every required power nobody holds, and not for optional ones', () => {
    const { warnings, powers } = summariseFinancialAuthority([user('Sam', ['Super Admin', []])]);
    const keys = warnings.filter((w) => w.kind === 'NO_HOLDER').map((w) => w.powerKey);
    expect(keys).toEqual(['approve-pay-runs', 'close-uk-payroll', 'approve-payouts', 'record-settlement']);
    expect(keys).not.toContain('reopen-uk-payroll');
    expect(warnings[0].message).toMatch(/No active user can approve and lock visit pay runs/);
    expect(powers.find((p) => p.key === 'prepare-pay-runs')!.users).toEqual([
      { id: 'Sam', name: 'Sam', roles: ['Super Admin'] },
    ]);
  });

  it('warns when the only approver is also the only preparer', () => {
    const solo = user('Sam', ['Super Admin', []], ['Payroll Approver', [...APPROVE, ORG]]);
    const { warnings } = summariseFinancialAuthority([solo]);
    expect(warnings.filter((w) => w.kind === 'NO_HOLDER')).toEqual([]);
    expect(warnings.filter((w) => w.kind === 'SAME_PERSON').map((w) => w.powerKey)).toEqual([
      'approve-pay-runs',
      'approve-corrections',
      'close-uk-payroll',
      'approve-payouts',
    ]);
    expect(warnings[0].message).toMatch(/Only Sam can approve and lock visit pay runs/);
  });

  it('no warning once a second person can prepare or approve', () => {
    const preparer = user('Pat', ['Payroll Clerk', [...PREPARE, ORG]]);
    const approver = user('Ann', ['Payroll Approver', [...APPROVE, ORG, 'billing.payroll_runs.manage']]);
    const { warnings, powers } = summariseFinancialAuthority([preparer, approver]);
    expect(warnings).toEqual([]);
    expect(powers.find((p) => p.key === 'approve-pay-runs')!.users.map((u) => u.name)).toEqual(['Ann']);
    expect(powers.find((p) => p.key === 'prepare-pay-runs')!.users.map((u) => u.name)).toEqual(['Pat', 'Ann']);
  });
});
