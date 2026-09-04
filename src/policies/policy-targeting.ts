import { PolicyAudienceTargetType, PolicyLinkModuleType, PolicyLinkScope } from '@prisma/client';

/**
 * Policy visibility is:
 *   organisation (this database)
 *   AND permission
 *   AND branch ACL (assignedLocationIds)
 *   AND applicability
 *   AND audience
 *
 * Applicability rows: OR across rows. Within a row, set fields AND.
 * organisationWide = true matches every location/service type.
 *
 * Audience rows: dimensions AND. Values within a dimension OR.
 * Empty audience (no rows) = all employees.
 * ALL_EMPLOYEES is a dimension that always matches.
 *
 * assignedLocationIds is ACL ("which branches may this user access?").
 * PolicyApplicability is targeting ("which branches/service types does this policy apply to?").
 */

export type PolicyApplicabilityRow = {
  organisationWide: boolean;
  locationId: string | null;
  serviceTypeCode: string | null;
};

export type PolicyAudienceRow = {
  targetType: PolicyAudienceTargetType;
  roleId: string | null;
  jobTitleId: string | null;
  workAreaId: string | null;
  locationId: string | null;
};

export type PolicyLinkRow = {
  moduleType: PolicyLinkModuleType;
  scope: PolicyLinkScope;
  recordId: string | null;
  sectionKey: string | null;
};

export type PolicyMatchContext = {
  /** null = unrestricted branch ACL */
  assignedLocationIds: string[] | null;
  roleIds: string[];
  jobTitleId: string | null;
  workAreaId: string | null;
  /** Discovery/work context; omit for library browse of service-type-only policies */
  serviceTypeCode?: string | null;
  /** When set, location-specific rows must intersect this context as well as ACL */
  locationId?: string | null;
};

export type PolicyLinkQuery = {
  moduleType?: PolicyLinkModuleType;
  scope?: PolicyLinkScope;
  recordId?: string;
  sectionKey?: string;
  /** Resolved form/course/template id when the client sent a record instance id. */
  formTemplateId?: string;
};

export const POLICY_LINK_ALLOWED_SCOPES: Record<PolicyLinkModuleType, readonly PolicyLinkScope[]> = {
  [PolicyLinkModuleType.CARE_PLAN]: [
    PolicyLinkScope.MODULE,
    PolicyLinkScope.FORM_TEMPLATE,
    PolicyLinkScope.RECORD,
  ],
  [PolicyLinkModuleType.INITIAL_ASSESSMENT]: [
    PolicyLinkScope.MODULE,
    PolicyLinkScope.SECTION,
    PolicyLinkScope.RECORD,
  ],
  [PolicyLinkModuleType.MEDICATION]: [PolicyLinkScope.MODULE, PolicyLinkScope.RECORD],
  [PolicyLinkModuleType.INCIDENT]: [PolicyLinkScope.MODULE, PolicyLinkScope.RECORD],
  [PolicyLinkModuleType.VISIT]: [PolicyLinkScope.MODULE, PolicyLinkScope.RECORD],
  [PolicyLinkModuleType.EMPLOYEE]: [PolicyLinkScope.MODULE, PolicyLinkScope.RECORD],
  [PolicyLinkModuleType.HR]: [PolicyLinkScope.MODULE, PolicyLinkScope.RECORD],
  [PolicyLinkModuleType.TRAINING]: [
    PolicyLinkScope.MODULE,
    PolicyLinkScope.FORM_TEMPLATE,
    PolicyLinkScope.RECORD,
  ],
  [PolicyLinkModuleType.RISK_ASSESSMENT]: [PolicyLinkScope.MODULE],
  [PolicyLinkModuleType.INFECTION_CONTROL]: [PolicyLinkScope.MODULE],
  [PolicyLinkModuleType.SAFEGUARDING]: [PolicyLinkScope.MODULE],
  [PolicyLinkModuleType.RECRUITMENT]: [PolicyLinkScope.MODULE],
  [PolicyLinkModuleType.AUDIT]: [PolicyLinkScope.MODULE],
  [PolicyLinkModuleType.BRANCH]: [PolicyLinkScope.MODULE],
  [PolicyLinkModuleType.EQUIPMENT]: [PolicyLinkScope.MODULE],
  [PolicyLinkModuleType.BUSINESS_CONTINUITY]: [PolicyLinkScope.MODULE],
};

export function policyLinkIdentity(row: PolicyLinkRow): string {
  return `${row.moduleType}|${row.scope}|${row.recordId ?? ''}|${row.sectionKey ?? ''}`;
}

export function findDuplicatePolicyLink(rows: PolicyLinkRow[]): PolicyLinkRow | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = policyLinkIdentity(row);
    if (seen.has(key)) return row;
    seen.add(key);
  }
  return null;
}

export function assertLinkScopeAllowed(row: PolicyLinkRow): string | null {
  const allowed = POLICY_LINK_ALLOWED_SCOPES[row.moduleType];
  if (!allowed?.includes(row.scope)) {
    return `${row.moduleType} does not support ${row.scope} links`;
  }
  return null;
}

export function isUnrestrictedLocations(assignedLocationIds: string[] | null | undefined): boolean {
  return assignedLocationIds == null;
}

export function locationAclAllows(
  assignedLocationIds: string[] | null | undefined,
  locationId: string,
): boolean {
  if (isUnrestrictedLocations(assignedLocationIds)) return true;
  return (assignedLocationIds ?? []).includes(locationId);
}

/** Targeted row with neither a branch nor a care service — persistable on drafts only. */
export function isIncompleteApplicabilityRow(row: PolicyApplicabilityRow): boolean {
  return !row.organisationWide && !row.locationId && !row.serviceTypeCode;
}

export function isIncompleteAudienceRow(row: PolicyAudienceRow): boolean {
  switch (row.targetType) {
    case PolicyAudienceTargetType.ROLE:
      return !row.roleId;
    case PolicyAudienceTargetType.JOB_TITLE:
      return !row.jobTitleId;
    case PolicyAudienceTargetType.WORK_AREA:
      return !row.workAreaId;
    case PolicyAudienceTargetType.LOCATION:
      return !row.locationId;
    default:
      return false;
  }
}

export function isIncompleteLinkRow(row: PolicyLinkRow): boolean {
  if (row.scope === PolicyLinkScope.MODULE) return false;
  if (row.scope === PolicyLinkScope.SECTION) return !row.sectionKey?.trim();
  if (row.scope === PolicyLinkScope.FORM_TEMPLATE || row.scope === PolicyLinkScope.RECORD) {
    return !row.recordId;
  }
  return false;
}

/** Structural applicability rules (DB lookups happen in the service). */
export function assertApplicabilityShape(row: PolicyApplicabilityRow): string | null {
  if (row.organisationWide) {
    if (row.locationId || row.serviceTypeCode) {
      return 'Organisation-wide applicability cannot include locationId or serviceTypeCode';
    }
    return null;
  }
  if (!row.locationId && !row.serviceTypeCode) {
    return 'Targeted applicability requires locationId and/or serviceTypeCode';
  }
  return null;
}

export function assertAudienceShape(row: PolicyAudienceRow): string | null {
  switch (row.targetType) {
    case PolicyAudienceTargetType.ALL_EMPLOYEES:
      if (row.roleId || row.jobTitleId || row.workAreaId || row.locationId) {
        return 'ALL_EMPLOYEES audience cannot include role, job title, work area, or location';
      }
      return null;
    case PolicyAudienceTargetType.ROLE:
      return row.roleId ? null : 'ROLE audience requires roleId';
    case PolicyAudienceTargetType.JOB_TITLE:
      return row.jobTitleId ? null : 'JOB_TITLE audience requires jobTitleId';
    case PolicyAudienceTargetType.WORK_AREA:
      return row.workAreaId ? null : 'WORK_AREA audience requires workAreaId';
    case PolicyAudienceTargetType.LOCATION:
      return row.locationId ? null : 'LOCATION audience requires locationId';
    default:
      return 'Unsupported audience target type';
  }
}

export function assertLinkShape(row: PolicyLinkRow): string | null {
  if (row.scope === PolicyLinkScope.MODULE) {
    return null;
  }
  if (row.scope === PolicyLinkScope.SECTION) {
    return row.sectionKey?.trim() ? null : 'SECTION links require sectionKey';
  }
  if (row.scope === PolicyLinkScope.FORM_TEMPLATE || row.scope === PolicyLinkScope.RECORD) {
    return row.recordId ? null : `${row.scope} links require recordId`;
  }
  return 'Unsupported policy link scope';
}

/**
 * True when at least one applicability row matches.
 * No rows = organisation-wide (Phase 2 documents created before targeting).
 */
export function applicabilityMatches(
  rows: PolicyApplicabilityRow[],
  ctx: PolicyMatchContext,
  options?: { requireServiceContext?: boolean },
): boolean {
  const requireService = options?.requireServiceContext === true;
  const effective = rows.length
    ? rows
    : [{ organisationWide: true, locationId: null, serviceTypeCode: null }];

  return effective.some((row) => applicabilityRowMatches(row, ctx, requireService));
}

function applicabilityRowMatches(
  row: PolicyApplicabilityRow,
  ctx: PolicyMatchContext,
  requireServiceContext: boolean,
): boolean {
  if (row.organisationWide) {
    return branchAclAllowsOrgWide(ctx);
  }

  if (row.locationId) {
    if (!locationAclAllows(ctx.assignedLocationIds, row.locationId)) return false;
    if (ctx.locationId && ctx.locationId !== row.locationId) return false;
  } else if (ctx.locationId && !isUnrestrictedLocations(ctx.assignedLocationIds)) {
    // Service-type-only (no location on the row) still requires the caller to have some branch ACL,
    // which they do; an explicit location context is allowed — it does not fail the row.
  }

  if (row.serviceTypeCode) {
    if (ctx.serviceTypeCode) {
      if (ctx.serviceTypeCode !== row.serviceTypeCode) return false;
    } else if (requireServiceContext) {
      return false;
    }
  }

  return !!(row.locationId || row.serviceTypeCode);
}

function branchAclAllowsOrgWide(ctx: PolicyMatchContext): boolean {
  if (isUnrestrictedLocations(ctx.assignedLocationIds)) return true;
  if (ctx.locationId) return locationAclAllows(ctx.assignedLocationIds, ctx.locationId);
  return (ctx.assignedLocationIds?.length ?? 0) > 0;
}

/**
 * Empty audience matches everyone.
 * Dimensions AND; values within a dimension OR.
 */
export function audienceMatches(rows: PolicyAudienceRow[], ctx: PolicyMatchContext): boolean {
  if (!rows.length) return true;

  const byType = new Map<PolicyAudienceTargetType, PolicyAudienceRow[]>();
  for (const row of rows) {
    const list = byType.get(row.targetType) ?? [];
    list.push(row);
    byType.set(row.targetType, list);
  }

  for (const [type, list] of byType) {
    if (type === PolicyAudienceTargetType.ALL_EMPLOYEES) continue;
    if (type === PolicyAudienceTargetType.ROLE) {
      const ids = list.map((r) => r.roleId).filter((id): id is string => !!id);
      if (!ids.some((id) => ctx.roleIds.includes(id))) return false;
    } else if (type === PolicyAudienceTargetType.JOB_TITLE) {
      const ids = list.map((r) => r.jobTitleId).filter((id): id is string => !!id);
      if (!ctx.jobTitleId || !ids.includes(ctx.jobTitleId)) return false;
    } else if (type === PolicyAudienceTargetType.WORK_AREA) {
      const ids = list.map((r) => r.workAreaId).filter((id): id is string => !!id);
      if (!ctx.workAreaId || !ids.includes(ctx.workAreaId)) return false;
    } else if (type === PolicyAudienceTargetType.LOCATION) {
      const ids = list.map((r) => r.locationId).filter((id): id is string => !!id);
      const allowed = isUnrestrictedLocations(ctx.assignedLocationIds)
        ? ids
        : ids.filter((id) => locationAclAllows(ctx.assignedLocationIds, id));
      if (!allowed.length) return false;
      if (ctx.locationId && !allowed.includes(ctx.locationId)) return false;
      if (!isUnrestrictedLocations(ctx.assignedLocationIds)) {
        const overlap = allowed.some((id) => ctx.assignedLocationIds!.includes(id));
        if (!overlap) return false;
      }
    }
  }
  return true;
}

/**
 * If no module is requested, all policies match on the link axis.
 * Links are OR'd. MODULE-scope links surface in that module even when a record is also requested.
 * Module-only queries (no record/section) only match MODULE-scope links.
 * Exclusive query.scope is ignored so MODULE / FORM_TEMPLATE still match a RECORD screen.
 */
export function policyLinkMatches(links: PolicyLinkRow[], query?: PolicyLinkQuery | null): boolean {
  if (!query?.moduleType) return true;
  if (!links.length) return false;

  const hasRecordContext = Boolean(query.recordId);
  const hasSectionContext = Boolean(query.sectionKey);
  const moduleOnlyQuery = !hasRecordContext && !hasSectionContext;

  return links.some((link) => {
    if (link.moduleType !== query.moduleType) return false;

    if (link.scope === PolicyLinkScope.MODULE) {
      return true;
    }

    if (moduleOnlyQuery) {
      return false;
    }

    if (link.scope === PolicyLinkScope.SECTION) {
      if (!query.sectionKey || link.sectionKey !== query.sectionKey) return false;
      if (query.recordId && link.recordId && link.recordId !== query.recordId) return false;
      return true;
    }

    if (link.scope === PolicyLinkScope.FORM_TEMPLATE) {
      if (!link.recordId) return false;
      return link.recordId === query.formTemplateId || link.recordId === query.recordId;
    }

    if (link.scope === PolicyLinkScope.RECORD) {
      return Boolean(query.recordId) && link.recordId === query.recordId;
    }

    return false;
  });
}

export function policyIsVisible(params: {
  applicability: PolicyApplicabilityRow[];
  audience: PolicyAudienceRow[];
  links?: PolicyLinkRow[];
  ctx: PolicyMatchContext;
  linkQuery?: PolicyLinkQuery | null;
  requireServiceContext?: boolean;
}): boolean {
  if (!applicabilityMatches(params.applicability, params.ctx, {
    requireServiceContext: params.requireServiceContext,
  })) {
    return false;
  }
  if (!audienceMatches(params.audience, params.ctx)) return false;
  if (!policyLinkMatches(params.links ?? [], params.linkQuery)) return false;
  return true;
}
