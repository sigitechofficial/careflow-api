import { resolveEnterpriseVisaMeta } from '../organisation-general-settings/employee-visa-catalog.constants';

/** Immigration-evidence RTW docs (not generic passport ID). */
export const IMMIGRATION_RTW_DOC_CODES = new Set(['BIOMETRIC_CARD', 'EMPLOYEE_SHARE_CODE']);

/**
 * Immigration statuses that do not need biometric / share-code style RTW evidence.
 * British/Irish typically evidence RTW via passport/ID instead.
 */
export const IMMIGRATION_RTW_EXEMPT_VISA_IDS = new Set([
  'british_citizen',
  'irish_citizen',
  'not_applicable',
]);

export function isImmigrationRtwDocCode(code: string | null | undefined): boolean {
  return Boolean(code && IMMIGRATION_RTW_DOC_CODES.has(code.toUpperCase()));
}

/**
 * True when the employee should be required to submit biometric / share-code RTW docs.
 * Unset or unknown immigration status → false (do not force; fill Immigration status for outsiders).
 */
export function requiresImmigrationRtwDocuments(visaTypeId: string | null | undefined): boolean {
  const meta = resolveEnterpriseVisaMeta(visaTypeId);
  if (!meta) return false;
  return !IMMIGRATION_RTW_EXEMPT_VISA_IDS.has(meta.id);
}

/** Board/report filter: undefined = all; true = visa outsiders; false = British/Irish/unset/etc. */
export function matchesNeedsImmigrationRtwFilter(
  visaTypeId: string | null | undefined,
  needsImmigrationRtw: boolean | undefined,
): boolean {
  if (needsImmigrationRtw === undefined) return true;
  const needs = requiresImmigrationRtwDocuments(visaTypeId);
  return needsImmigrationRtw ? needs : !needs;
}

export type RequirementMandatoryFlags = {
  isMandatory: boolean;
  blocksAllocation: boolean;
};

/**
 * For biometric / share-code: force mandatory+blocking for visa outsiders;
 * force off for British/Irish/not_applicable (and when immigration is unset).
 * Other compliance types are unchanged.
 */
export function applyImmigrationRtwRequirementFlags(
  typeCode: string | null | undefined,
  visaTypeId: string | null | undefined,
  flags: RequirementMandatoryFlags,
): RequirementMandatoryFlags {
  if (!isImmigrationRtwDocCode(typeCode)) return flags;
  if (requiresImmigrationRtwDocuments(visaTypeId)) {
    return { isMandatory: true, blocksAllocation: true };
  }
  return { isMandatory: false, blocksAllocation: false };
}
