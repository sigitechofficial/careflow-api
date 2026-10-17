import {
  planResponsibilityChange,
  ROLE_RESPONSIBILITIES,
  scopeKeysToRevoke,
} from './role-responsibilities.catalog';

describe('scope keys of a job (R-12)', () => {
  const ORG = 'payroll.scope.organisation';
  const job = (key: string) => ROLE_RESPONSIBILITIES.find((x) => x.key === key)!;

  it('the pay jobs need organisation-wide pay access, and give it with the job', () => {
    for (const key of ['approve-pay', 'payroll', 'carer-pay']) {
      expect(job(key).scope).toEqual([ORG]);
      expect(job(key).act).not.toContain(ORG);
      expect(job(key).description).toMatch(/every branch/);
    }
    const plan = planResponsibilityChange(job('payroll'), ['clerk', 'manager'], ['clerk'], []);
    expect(plan.grant[0].keys).toContain(ORG);
    // The planner itself never removes scope: that depends on the other jobs of the role.
    expect(plan.revoke[0].keys).not.toContain(ORG);
  });

  it('a role that loses its only pay job loses the access with it', () => {
    expect(scopeKeysToRevoke(job('approve-pay'), new Set(['billing.payroll_runs.read', ORG]))).toEqual([ORG]);
  });

  it('a role that still prepares pay keeps the access when it stops approving', () => {
    const stillPrepares = new Set([...job('carer-pay').act, ORG]);
    expect(scopeKeysToRevoke(job('approve-pay'), stillPrepares)).toEqual([]);
    // Part of another pay job is enough: a working set-up is not broken by saving this one.
    expect(scopeKeysToRevoke(job('approve-pay'), new Set(['billing.payroll_runs.manage', ORG]))).toEqual([]);
  });

  it('a job without scope keys has nothing to take away', () => {
    expect(scopeKeysToRevoke(job('office-salaries'), new Set([ORG]))).toEqual([]);
  });
});

describe('planResponsibilityChange', () => {
  const r = { view: ['payroll.runs.read'], act: ['payroll.runs.manage'] };

  it('gives view + act to the chosen role and the admins', () => {
    const plan = planResponsibilityChange(
      r,
      ['hr', 'manager', 'admin'],
      ['hr'],
      ['admin'],
    );
    expect(plan.grant).toEqual([
      { roleId: 'hr', keys: ['payroll.runs.read', 'payroll.runs.manage'] },
      { roleId: 'admin', keys: ['payroll.runs.read', 'payroll.runs.manage'] },
    ]);
  });

  it('removes only the act keys from everyone else, never from admins', () => {
    const plan = planResponsibilityChange(
      r,
      ['hr', 'manager', 'admin'],
      ['hr'],
      ['admin'],
    );
    expect(plan.revoke).toEqual([
      { roleId: 'manager', keys: ['payroll.runs.manage'] },
    ]);
  });

  it('with no role chosen only the admins keep it', () => {
    const plan = planResponsibilityChange(r, ['hr', 'admin'], [], ['admin']);
    expect(plan.grant.map((g) => g.roleId)).toEqual(['admin']);
    expect(plan.revoke.map((g) => g.roleId)).toEqual(['hr']);
  });

  it('catalog keys are unique and every job has something to do', () => {
    const keys = ROLE_RESPONSIBILITIES.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const x of ROLE_RESPONSIBILITIES)
      expect(x.act.length).toBeGreaterThan(0);
  });
});
