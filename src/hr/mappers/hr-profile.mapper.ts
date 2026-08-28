import type {
  CareWorkforceCategory,
  Employee,
  EmployeeEmergencyContact,
  EmployeeEmployment,
  EmployeeHRProfile,
  EmployeePersonalDetail,
  HrDeploymentStatus,
  EmployeeLifecycleStatus,
} from '@prisma/client';
import { deriveHrEmploymentTypeLabel } from '../utils/hr-employment-type.util';

type EmploymentWithLookups = EmployeeEmployment & {
  jobTitle?: { id: string; name: string } | null;
  contractType?: { id: string; name: string } | null;
  location?: { id: string; name: string } | null;
};

type PersonalWithLookups = EmployeePersonalDetail & {
  status?: { id: string; name: string } | null;
};

type HrProfileWithManager = EmployeeHRProfile & {
  reportingManager?: {
    id: string;
    personalDetail: { firstName: string; lastName: string } | null;
  } | null;
};

export type HrProfileAggregateInput = {
  employee: Pick<Employee, 'id' | 'isActive'>;
  personalDetail: PersonalWithLookups | null;
  employment: EmploymentWithLookups | null;
  hrProfile: HrProfileWithManager | null;
  emergencyContacts: EmployeeEmergencyContact[];
};

export function mapHrEmployeeListRow(input: HrProfileAggregateInput) {
  const pd = input.personalDetail;
  const employment = input.employment;
  const hr = input.hrProfile;
  const displayName = pd
    ? [pd.firstName, pd.lastName].filter(Boolean).join(' ').trim()
    : 'Unknown';

  return {
    employeeId: input.employee.id,
    employeeNumber: employment?.employeeNumber ?? null,
    name: displayName,
    jobTitle: employment?.jobTitle?.name ?? null,
    employmentType: deriveHrEmploymentTypeLabel(employment),
    employeeLifecycleStatus: hr?.employeeLifecycleStatus ?? 'ACTIVE',
    deploymentStatus: hr?.deploymentStatus ?? 'GREEN',
  };
}

export function mapHrProfileResponse(input: HrProfileAggregateInput) {
  const pd = input.personalDetail;
  const employment = input.employment;
  const hr = input.hrProfile;

  const manager = hr?.reportingManager?.personalDetail;
  const managerName = manager
    ? [manager.firstName, manager.lastName].filter(Boolean).join(' ').trim()
    : null;

  return {
    employeeId: input.employee.id,
    personal: {
      legalName: hr?.legalName ?? null,
      preferredName: hr?.preferredName ?? null,
      firstName: pd?.firstName ?? null,
      lastName: pd?.lastName ?? null,
      dateOfBirth: pd?.dateOfBirth ?? null,
      profilePhoto: pd?.photoUrl ?? null,
    },
    employment: {
      jobTitleId: employment?.jobTitleId ?? null,
      jobTitle: employment?.jobTitle?.name ?? null,
      employmentType: deriveHrEmploymentTypeLabel(employment),
      contractTypeId: employment?.contractTypeId ?? null,
      contractType: employment?.contractType?.name ?? null,
      careWorkforceCategory: (hr?.careWorkforceCategory ?? null) as CareWorkforceCategory | null,
      contractedHours: employment?.contractedWeeklyHours ?? null,
      branchTeam: hr?.branchTeam ?? null,
      branchLocationId: employment?.locationId ?? null,
      branchLocation: employment?.location?.name ?? null,
      reportingManagerId: hr?.reportingManagerId ?? null,
      reportingManagerName: managerName,
      employmentStartDate: employment?.startDate ?? null,
    },
    emergencyContacts: input.emergencyContacts.map((c) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(' ').trim(),
      relationship: c.relationship,
      phone: c.phone,
    })),
    hrStatus: {
      employeeLifecycleStatus: (hr?.employeeLifecycleStatus ?? 'ACTIVE') as EmployeeLifecycleStatus,
      deploymentStatus: (hr?.deploymentStatus ?? 'GREEN') as HrDeploymentStatus,
      operationalStatus: pd?.status?.name ?? null,
      operationalStatusId: pd?.statusId ?? null,
    },
    hrProfileId: hr?.id ?? null,
    hasHrProfile: Boolean(hr),
  };
}
