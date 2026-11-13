import { EmployeeLifecycleStatus, HrDeploymentStatus } from '@prisma/client';

export type HrStatusForAllocation = {
  deploymentStatus: HrDeploymentStatus;
  employeeLifecycleStatus: EmployeeLifecycleStatus;
} | null;

const LEFT: EmployeeLifecycleStatus[] = [EmployeeLifecycleStatus.LEFT, EmployeeLifecycleStatus.ALUMNI];

/**
 * What the HR profile says about giving this person visits. Red (suspension, investigation, ...)
 * and people who have left are blocked, and a manager cannot override it: HR changes the status first.
 * Amber is a warning. No HR profile = Active / Green, so nothing.
 */
export function hrDeploymentAllocationIssue(hr: HrStatusForAllocation): { block: string | null; warn: string | null } {
  if (!hr) return { block: null, warn: null };
  if (LEFT.includes(hr.employeeLifecycleStatus)) {
    return { block: 'Has left (HR profile): cannot be given visits', warn: null };
  }
  if (hr.deploymentStatus === HrDeploymentStatus.RED) {
    return { block: 'HR status is Red (not deployable): HR must change it before visits are given', warn: null };
  }
  if (hr.deploymentStatus === HrDeploymentStatus.AMBER) {
    return { block: null, warn: 'HR status is Amber (at risk): check the HR profile' };
  }
  return { block: null, warn: null };
}
