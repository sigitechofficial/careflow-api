import type { ComplianceRequirement } from '@prisma/client';

export type EmploymentDims = {
  roleId: string | null;
  workAreaId: string | null;
  jobTitleId: string | null;
  contractTypeId: string | null;
  /** Prefer `locationId`, else `baseLocationId` from employment. */
  locationId: string | null;
};

export function employmentDimsFromEmployment(e: {
  roleId: string | null;
  workAreaId: string | null;
  jobTitleId: string | null;
  contractTypeId: string | null;
  locationId: string | null;
  baseLocationId: string | null;
}): EmploymentDims {
  return {
    roleId: e.roleId,
    workAreaId: e.workAreaId,
    jobTitleId: e.jobTitleId,
    contractTypeId: e.contractTypeId,
    locationId: e.locationId ?? e.baseLocationId ?? null,
  };
}

/**
 * Each non-null dimension on the requirement must equal the employee's employment value.
 * All-null dimensions ⇒ global requirement.
 * Requirements with `zoneId` set do not match any employee in v1 (no employment zone field).
 */
export function requirementMatchesEmployment(
  req: Pick<
    ComplianceRequirement,
    'roleId' | 'workAreaId' | 'jobTitleId' | 'contractTypeId' | 'locationId' | 'zoneId'
  >,
  dims: EmploymentDims,
): boolean {
  if (req.zoneId != null) return false;
  const pairs: [string | null, string | null][] = [
    [req.roleId, dims.roleId],
    [req.workAreaId, dims.workAreaId],
    [req.jobTitleId, dims.jobTitleId],
    [req.contractTypeId, dims.contractTypeId],
    [req.locationId, dims.locationId],
  ];
  for (const [want, have] of pairs) {
    if (want != null && want !== have) return false;
  }
  return true;
}

export function requirementSpecificity(
  req: Pick<
    ComplianceRequirement,
    'roleId' | 'workAreaId' | 'jobTitleId' | 'contractTypeId' | 'locationId' | 'zoneId'
  >,
): number {
  let n = 0;
  if (req.roleId) n++;
  if (req.workAreaId) n++;
  if (req.jobTitleId) n++;
  if (req.contractTypeId) n++;
  if (req.locationId) n++;
  if (req.zoneId) n++;
  return n;
}

/** For each compliance type id, pick the single best-matching requirement row. */
export function pickBestRequirementsPerType(
  requirements: ComplianceRequirement[],
  dims: EmploymentDims,
): Map<string, ComplianceRequirement> {
  const matched = requirements.filter((r) => requirementMatchesEmployment(r, dims));
  const byType = new Map<string, ComplianceRequirement[]>();
  for (const r of matched) {
    const list = byType.get(r.complianceTypeId) ?? [];
    list.push(r);
    byType.set(r.complianceTypeId, list);
  }
  const best = new Map<string, ComplianceRequirement>();
  for (const [typeId, arr] of byType) {
    arr.sort((a, b) => {
      const sb = requirementSpecificity(b);
      const sa = requirementSpecificity(a);
      if (sb !== sa) return sb - sa;
      if (a.renewalBeforeDays !== b.renewalBeforeDays) return a.renewalBeforeDays - b.renewalBeforeDays;
      return (b.isMandatory ? 1 : 0) - (a.isMandatory ? 1 : 0);
    });
    const first = arr[0];
    if (first) best.set(typeId, first);
  }
  return best;
}
