import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmployeeQueryDto } from './dto/employee-query.dto';
import { buildEmployeeListWhere } from './employee-list-where.util';

export type EmployeeListFacetCount = {
  id: string;
  count: number;
};

export type EmployeeListFacets = {
  branches: EmployeeListFacetCount[];
  roles: EmployeeListFacetCount[];
  jobTitles: EmployeeListFacetCount[];
  grades: EmployeeListFacetCount[];
  contractTypes: EmployeeListFacetCount[];
  visaTypes: EmployeeListFacetCount[];
  statuses: EmployeeListFacetCount[];
  cohortTotal: number;
  branchCohortTotal: number;
};

type EmploymentBranchSlice = {
  accessAllZones: boolean;
  locationId: string | null;
  floorLocations: { locationId: string }[];
};

export function employeeEmploymentMatchesBranch(
  employment: EmploymentBranchSlice | null | undefined,
  locationId: string,
): boolean {
  if (!employment) return false;
  if (employment.accessAllZones) return true;
  if (employment.locationId === locationId) return true;
  return employment.floorLocations.some((row) => row.locationId === locationId);
}

function incrementCount(map: Map<string, number>, id: string | null | undefined) {
  if (!id) return;
  map.set(id, (map.get(id) ?? 0) + 1);
}

function toSortedFacetRows(map: Map<string, number>): EmployeeListFacetCount[] {
  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

const EMPTY_FACETS: EmployeeListFacets = {
  branches: [],
  roles: [],
  jobTitles: [],
  grades: [],
  contractTypes: [],
  visaTypes: [],
  statuses: [],
  cohortTotal: 0,
  branchCohortTotal: 0,
};

export async function buildEmployeeListFacets(
  prisma: PrismaService,
  query: EmployeeQueryDto,
  locationCatalogIds: string[],
): Promise<EmployeeListFacets> {
  const queryForBranchCounts: EmployeeQueryDto = { ...query, locationIds: undefined };

  const { listWhere: branchCohortWhere, isEmpty: branchCohortEmpty } = await buildEmployeeListWhere(
    prisma,
    queryForBranchCounts,
  );
  const { listWhere: facetCohortWhere, isEmpty: facetCohortEmpty } = await buildEmployeeListWhere(
    prisma,
    query,
  );

  if (branchCohortEmpty && facetCohortEmpty) {
    return { ...EMPTY_FACETS };
  }

  const [branchCohortRows, facetCohortRows, cohortTotal, branchCohortTotal] = await Promise.all([
    branchCohortEmpty
      ? Promise.resolve([])
      : prisma.employee.findMany({
          where: branchCohortWhere,
          select: {
            employment: {
              select: {
                accessAllZones: true,
                locationId: true,
                floorLocations: { select: { locationId: true } },
              },
            },
          },
        }),
    facetCohortEmpty
      ? Promise.resolve([])
      : prisma.employee.findMany({
          where: facetCohortWhere,
          select: {
            personalDetail: { select: { statusId: true } },
            employment: {
              select: {
                roleId: true,
                jobTitleId: true,
                gradeId: true,
                contractTypeId: true,
                visaTypeId: true,
              },
            },
          },
        }),
    facetCohortEmpty
      ? Promise.resolve(0)
      : prisma.employee.count({ where: facetCohortWhere }),
    branchCohortEmpty
      ? Promise.resolve(0)
      : prisma.employee.count({ where: branchCohortWhere }),
  ]);

  const branchCounts = new Map<string, number>();
  for (const locationId of locationCatalogIds) {
    branchCounts.set(locationId, 0);
  }
  for (const row of branchCohortRows) {
    for (const locationId of locationCatalogIds) {
      if (employeeEmploymentMatchesBranch(row.employment, locationId)) {
        branchCounts.set(locationId, (branchCounts.get(locationId) ?? 0) + 1);
      }
    }
  }

  const roles = new Map<string, number>();
  const jobTitles = new Map<string, number>();
  const grades = new Map<string, number>();
  const contractTypes = new Map<string, number>();
  const visaTypes = new Map<string, number>();
  const statuses = new Map<string, number>();

  for (const row of facetCohortRows) {
    incrementCount(statuses, row.personalDetail?.statusId);
    const employment = row.employment;
    if (!employment) continue;
    incrementCount(roles, employment.roleId);
    incrementCount(jobTitles, employment.jobTitleId);
    incrementCount(grades, employment.gradeId);
    incrementCount(contractTypes, employment.contractTypeId);
    incrementCount(visaTypes, employment.visaTypeId);
  }

  const branches = [...branchCounts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  return {
    branches,
    roles: toSortedFacetRows(roles),
    jobTitles: toSortedFacetRows(jobTitles),
    grades: toSortedFacetRows(grades),
    contractTypes: toSortedFacetRows(contractTypes),
    visaTypes: toSortedFacetRows(visaTypes),
    statuses: toSortedFacetRows(statuses),
    cohortTotal,
    branchCohortTotal,
  };
}

export async function loadEmployeeListFacetLocationIds(
  prisma: PrismaService,
): Promise<string[]> {
  const rows = await prisma.location.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((row) => row.id);
}
