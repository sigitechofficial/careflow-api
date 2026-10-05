import {
  planResponsibilityChange,
  ROLE_RESPONSIBILITIES,
} from './role-responsibilities.catalog';

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
