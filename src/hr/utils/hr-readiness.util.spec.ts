import { complianceReadiness, worstDeployment } from './hr-compliance-readiness.util';
import { hrDeploymentAllocationIssue } from './hr-deployment-allocation.util';

const issue = (status: string, label: string) => ({ source: 'EMPLOYEE_COMPLIANCE' as const, status, label });

describe('complianceReadiness', () => {
  it('is Green with no issues', () => {
    expect(complianceReadiness({ blockingIssues: [], warningIssues: [], attentionCount: 0, blocksAllocation: false })).toEqual({
      level: 'GREEN',
      issues: [],
    });
  });

  it('is Red for an expired item even in Warn mode, listing it first', () => {
    const r = complianceReadiness({
      blockingIssues: [],
      warningIssues: [issue('EXPIRING_SOON', 'Training (EXPIRING_SOON)'), issue('EXPIRED', 'DBS (EXPIRED)')],
      attentionCount: 2,
      blocksAllocation: false,
    });
    expect(r).toEqual({ level: 'RED', issues: ['DBS (EXPIRED)', 'Training (EXPIRING_SOON)'] });
  });

  it('is Amber when something is only expiring soon or waiting for review', () => {
    const r = complianceReadiness({
      blockingIssues: [issue('PENDING_REVIEW', 'Right to work (PENDING_REVIEW)')],
      warningIssues: [],
      attentionCount: 1,
      blocksAllocation: true,
    });
    expect(r.level).toBe('AMBER');
  });
});

describe('worstDeployment', () => {
  it('takes the worse of the two', () => {
    expect(worstDeployment('GREEN', 'RED')).toBe('RED');
    expect(worstDeployment('AMBER', 'GREEN')).toBe('AMBER');
    expect(worstDeployment('RED', 'AMBER')).toBe('RED');
  });
});

describe('hrDeploymentAllocationIssue', () => {
  it('blocks Red and people who have left, warns on Amber, ignores Green and no profile', () => {
    expect(hrDeploymentAllocationIssue({ deploymentStatus: 'RED', employeeLifecycleStatus: 'ACTIVE' }).block).toMatch(/Red/);
    expect(hrDeploymentAllocationIssue({ deploymentStatus: 'GREEN', employeeLifecycleStatus: 'LEFT' }).block).toMatch(/left/);
    expect(hrDeploymentAllocationIssue({ deploymentStatus: 'AMBER', employeeLifecycleStatus: 'ACTIVE' })).toEqual({
      block: null,
      warn: expect.stringMatching(/Amber/),
    });
    expect(hrDeploymentAllocationIssue({ deploymentStatus: 'GREEN', employeeLifecycleStatus: 'ACTIVE' })).toEqual({ block: null, warn: null });
    expect(hrDeploymentAllocationIssue(null)).toEqual({ block: null, warn: null });
  });
});
