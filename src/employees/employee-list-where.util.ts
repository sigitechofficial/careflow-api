import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmployeeQueryDto } from './dto/employee-query.dto';
import {
  UNASSIGNED_TO_BRANCH_EMPLOYEE_WHERE,
  buildEmployeeListEmploymentWhere,
  normalizeEmployeeListUuidIds,
} from './employee-list-filter.util';
import {
  findEmployeeIdsForBranchScopeKinds,
  findEmployeeIdsForComplianceFilter,
  intersectEmployeeIdFilters,
} from './employee-list-advanced-filter.util';

export type EmployeeListWhereBuildResult = {
  listWhere: Prisma.EmployeeWhereInput;
  wherePersonal: Prisma.EmployeePersonalDetailWhereInput;
  isEmpty: boolean;
};

export type EmployeeListWhereOptions = {
  /**
   * When the list is limited to branches, staff not assigned to any branch yet are still listed
   * if one of these office users added them (see `resolveUnassignedStaffCreatorIds`).
   */
  unassignedStaffCreatorIds?: string[];
};

export async function buildEmployeeListWhere(
  prisma: PrismaService,
  query: EmployeeQueryDto,
  options: EmployeeListWhereOptions = {},
): Promise<EmployeeListWhereBuildResult> {
  const wherePersonal: Prisma.EmployeePersonalDetailWhereInput = { deletedAt: null };
  const statusIds = normalizeEmployeeListUuidIds(query.statusId, query.statusIds);
  if (statusIds?.length) wherePersonal.statusId = { in: statusIds };

  // Every word must match some field, so "Wendy Clark" finds first "Wendy" + last "Clark".
  const searchTerms = query.search?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (searchTerms.length) {
    wherePersonal.AND = searchTerms.map((s): Prisma.EmployeePersonalDetailWhereInput => ({
      OR: [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { username: { contains: s, mode: 'insensitive' } },
      ],
    }));
  }

  const {
    whereEmployment,
    hasEmploymentFilters,
    whereEmploymentWithoutBranch,
    hasNonBranchEmploymentFilters,
  } = buildEmployeeListEmploymentWhere(query);

  const branchScopeIds = query.branchScopeKinds?.length
    ? await findEmployeeIdsForBranchScopeKinds(prisma, query.branchScopeKinds)
    : undefined;
  const complianceIds = query.complianceFilter
    ? await findEmployeeIdsForComplianceFilter(prisma, query.complianceFilter)
    : undefined;
  const intersectedEmployeeIds = intersectEmployeeIdFilters([branchScopeIds, complianceIds]);

  if (intersectedEmployeeIds !== undefined && intersectedEmployeeIds.length === 0) {
    return {
      listWhere: { id: { in: [] } },
      wherePersonal,
      isEmpty: true,
    };
  }

  const whereEmployee: Prisma.EmployeeWhereInput = { deletedAt: null };
  if (intersectedEmployeeIds?.length) {
    whereEmployee.id = { in: intersectedEmployeeIds };
  }

  const creatorIds = options.unassignedStaffCreatorIds?.filter(Boolean) ?? [];
  const branchLimited = Boolean(query.locationIds?.length);
  let employmentWhere: Prisma.EmployeeWhereInput;
  if (branchLimited && creatorIds.length) {
    // Branch-limited list: staff at these branches, plus staff not assigned to any branch yet
    // whom someone from these branches added (so a new starter is not invisible to their office).
    const unassigned: Prisma.EmployeeWhereInput = {
      AND: [
        UNASSIGNED_TO_BRANCH_EMPLOYEE_WHERE as Prisma.EmployeeWhereInput,
        { createdById: { in: creatorIds } },
        ...(hasNonBranchEmploymentFilters
          ? [{ employment: { is: whereEmploymentWithoutBranch } } as Prisma.EmployeeWhereInput]
          : []),
      ],
    };
    employmentWhere = { OR: [{ employment: { is: whereEmployment } }, unassigned] };
  } else {
    // A "branch type" filter alone is applied through the employee id list above, which may include
    // staff with no employment details yet (type "none"), so those rows must not be dropped here.
    const onlyBranchTypeFilter = !hasNonBranchEmploymentFilters && !branchLimited;
    employmentWhere = hasEmploymentFilters && !onlyBranchTypeFilter
      ? { employment: { is: whereEmployment } }
      : {
          OR: [{ employment: null }, { employment: { is: whereEmployment } }],
        };
  }

  const listWhere: Prisma.EmployeeWhereInput = {
    ...whereEmployee,
    personalDetail: { is: wherePersonal },
    ...employmentWhere,
  };

  return { listWhere, wherePersonal, isEmpty: false };
}

export function hasEmployeeListCohortFilters(query: EmployeeQueryDto): boolean {
  return Boolean(
    query.search?.trim() ||
      query.statusId ||
      query.statusIds?.length ||
      query.roleId ||
      query.roleIds?.length ||
      query.jobTitleId ||
      query.jobTitleIds?.length ||
      query.gradeId ||
      query.gradeIds?.length ||
      query.contractTypeId ||
      query.contractTypeIds?.length ||
      query.locationIds?.length ||
      query.visaTypeIds?.length ||
      query.isInCountry !== undefined ||
      query.branchScopeKinds?.length ||
      query.complianceFilter,
  );
}
