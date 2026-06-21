import type { EmployeeQueryDto } from './dto/employee-query.dto';

export function normalizeEmployeeListUuidIds(
  single?: string,
  many?: string[],
): string[] | undefined {
  const ids = new Set<string>();
  if (single?.trim()) ids.add(single.trim());
  for (const id of many ?? []) {
    if (id?.trim()) ids.add(id.trim());
  }
  return ids.size ? [...ids] : undefined;
}

export function buildEmployeeListEmploymentWhere(query: EmployeeQueryDto): {
  whereEmployment: Record<string, unknown>;
  hasEmploymentFilters: boolean;
} {
  const whereEmployment: Record<string, unknown> = { deletedAt: null };

  const roleIds = normalizeEmployeeListUuidIds(query.roleId, query.roleIds);
  const jobTitleIds = normalizeEmployeeListUuidIds(query.jobTitleId, query.jobTitleIds);
  const gradeIds = normalizeEmployeeListUuidIds(query.gradeId, query.gradeIds);
  const contractTypeIds = normalizeEmployeeListUuidIds(
    query.contractTypeId,
    query.contractTypeIds,
  );
  const locationIds = query.locationIds?.length ? query.locationIds : undefined;
  const visaTypeIds = query.visaTypeIds?.length ? query.visaTypeIds : undefined;

  if (roleIds?.length) whereEmployment.roleId = { in: roleIds };
  if (jobTitleIds?.length) whereEmployment.jobTitleId = { in: jobTitleIds };
  if (gradeIds?.length) whereEmployment.gradeId = { in: gradeIds };
  if (contractTypeIds?.length) whereEmployment.contractTypeId = { in: contractTypeIds };
  if (visaTypeIds?.length) whereEmployment.visaTypeId = { in: visaTypeIds };
  if (query.isInCountry !== undefined) whereEmployment.isInCountry = query.isInCountry;

  if (locationIds?.length) {
    const locationClause = {
      OR: [
        { accessAllZones: true },
        { locationId: { in: locationIds } },
        { floorLocations: { some: { locationId: { in: locationIds } } } },
      ],
    };
    const existingAnd = whereEmployment.AND;
    whereEmployment.AND = Array.isArray(existingAnd)
      ? [...existingAnd, locationClause]
      : [locationClause];
  }

  const hasEmploymentFilters = Boolean(
    roleIds?.length ||
      jobTitleIds?.length ||
      gradeIds?.length ||
      contractTypeIds?.length ||
      locationIds?.length ||
      visaTypeIds?.length ||
      query.isInCountry !== undefined ||
      query.branchScopeKinds?.length,
  );

  return { whereEmployment, hasEmploymentFilters };
}
