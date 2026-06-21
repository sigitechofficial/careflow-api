import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export const EMPLOYEE_BRANCH_SCOPE_KINDS = [
  'all-zones',
  'single',
  'multiple',
  'none',
] as const;

export type EmployeeBranchScopeKind = (typeof EMPLOYEE_BRANCH_SCOPE_KINDS)[number];

export const EMPLOYEE_COMPLIANCE_FILTER_VALUES = ['needs_attention', 'up_to_date'] as const;

export type EmployeeComplianceFilter = (typeof EMPLOYEE_COMPLIANCE_FILTER_VALUES)[number];

const COMPLIANCE_ATTENTION_HORIZON_DAYS = 30;

export function complianceAttentionHorizonDate(): Date {
  return new Date(Date.now() + COMPLIANCE_ATTENTION_HORIZON_DAYS * 24 * 60 * 60 * 1000);
}

export async function findEmployeeIdsForBranchScopeKinds(
  prisma: PrismaService,
  kinds: EmployeeBranchScopeKind[],
): Promise<string[]> {
  if (!kinds.length) return [];

  const includeAllZones = kinds.includes('all-zones');
  const includeNone = kinds.includes('none');
  const includeSingle = kinds.includes('single');
  const includeMultiple = kinds.includes('multiple');

  const rows = await prisma.$queryRaw<{ employeeId: string }[]>(Prisma.sql`
    WITH scoped AS (
      SELECT
        emp."employeeId" AS employee_id,
        emp."accessAllZones" AS access_all_zones,
        COUNT(DISTINCT loc.loc_id)::int AS branch_count
      FROM employees."EmployeeEmployment" emp
      LEFT JOIN LATERAL (
        SELECT emp."locationId" AS loc_id
        WHERE emp."locationId" IS NOT NULL
        UNION
        SELECT fl."locationId" AS loc_id
        FROM employees."EmployeeEmploymentFloorLocation" fl
        WHERE fl."employmentId" = emp."id"
      ) loc ON TRUE
      WHERE emp."deletedAt" IS NULL
      GROUP BY emp."employeeId", emp."accessAllZones"
    )
    SELECT scoped.employee_id AS "employeeId"
    FROM scoped
  WHERE
    (${includeAllZones} AND scoped.access_all_zones = true)
    OR (${includeNone} AND scoped.access_all_zones = false AND scoped.branch_count = 0)
    OR (${includeSingle} AND scoped.access_all_zones = false AND scoped.branch_count = 1)
    OR (${includeMultiple} AND scoped.access_all_zones = false AND scoped.branch_count > 1)
  `);

  return rows.map((row) => row.employeeId);
}

export async function findEmployeeIdsForComplianceFilter(
  prisma: PrismaService,
  filter: EmployeeComplianceFilter,
): Promise<string[]> {
  const horizon = complianceAttentionHorizonDate();

  if (filter === 'needs_attention') {
    const rows = await prisma.$queryRaw<{ employeeId: string }[]>(Prisma.sql`
      SELECT DISTINCT c."employeeId" AS "employeeId"
      FROM employees."EmployeeCompliance" c
      INNER JOIN employees."Employee" e ON e."id" = c."employeeId" AND e."deletedAt" IS NULL
      WHERE c."deletedAt" IS NULL
        AND COALESCE(c."isNoLongerRequired", false) = false
        AND c."expiryDate" IS NOT NULL
        AND c."expiryDate" <= ${horizon}
    `);
    return rows.map((row) => row.employeeId);
  }

  const rows = await prisma.$queryRaw<{ employeeId: string }[]>(Prisma.sql`
    SELECT e."id" AS "employeeId"
    FROM employees."Employee" e
    WHERE e."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1
        FROM employees."EmployeeCompliance" c
        WHERE c."employeeId" = e."id"
          AND c."deletedAt" IS NULL
          AND COALESCE(c."isNoLongerRequired", false) = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM employees."EmployeeCompliance" c
        WHERE c."employeeId" = e."id"
          AND c."deletedAt" IS NULL
          AND COALESCE(c."isNoLongerRequired", false) = false
          AND c."expiryDate" IS NOT NULL
          AND c."expiryDate" <= ${horizon}
      )
  `);
  return rows.map((row) => row.employeeId);
}

export function intersectEmployeeIdFilters(filters: (string[] | undefined)[]): string[] | undefined {
  const active = filters.filter((ids): ids is string[] => ids !== undefined);
  if (!active.length) return undefined;
  let result = new Set(active[0]);
  for (let i = 1; i < active.length; i++) {
    const next = new Set(active[i]);
    result = new Set([...result].filter((id) => next.has(id)));
  }
  return [...result];
}
