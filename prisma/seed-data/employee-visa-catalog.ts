/**
 * Canonical immigration / right-to-work status labels for org Settings.
 * maxWeeklyHours = visa work restriction cap (standard 40h; lower for student routes).
 */
export type EmployeeVisaCatalogEntry = {
  id: string;
  label: string;
  maxWeeklyHours: number;
  /** Prefill contracted hours when this status is selected; null = do not auto-change. */
  defaultContractedHours: number | null;
};

const STANDARD_MAX_HOURS = 40;

/** Stable ids — do not rename after deploy (employee employment references these). */
export const ENTERPRISE_EMPLOYEE_VISA_TYPES: EmployeeVisaCatalogEntry[] = [
  { id: 'british_citizen', label: 'British citizen', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'irish_citizen', label: 'Irish citizen', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'settled_status', label: 'Settled status / ILR', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'pre_settled_euss', label: 'Pre-settled status (EUSS)', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'skilled_worker', label: 'Skilled Worker', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'health_care_worker', label: 'Health and Care Worker', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'student_visa', label: 'Student visa', maxWeeklyHours: 20, defaultContractedHours: 20 },
  {
    id: 'student_visa_sub_degree',
    label: 'Student visa (sub-degree course)',
    maxWeeklyHours: 10,
    defaultContractedHours: 10,
  },
  { id: 'graduate_visa', label: 'Graduate visa', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'dependent_family', label: 'Dependent / family visa', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'other_time_limited', label: 'Other time-limited leave', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
  { id: 'not_applicable', label: 'Not applicable', maxWeeklyHours: STANDARD_MAX_HOURS, defaultContractedHours: null },
];

export const ENTERPRISE_IMMIGRATION_STATUS_IDS = ENTERPRISE_EMPLOYEE_VISA_TYPES.map((t) => t.id);

/** Legacy v1 ids from initial migration — map to enterprise ids on upgrade. */
export const LEGACY_VISA_TYPE_ID_MAP: Record<string, string> = {
  full_time: 'skilled_worker',
  student: 'student_visa',
};

export function isLegacyVisaCatalog(
  types: Array<{ id: string; label?: string; maxWeeklyHours?: number; weeklyHours?: number }>,
): boolean {
  if (types.length === 0) return true;
  const ids = new Set(types.map((t) => t.id));
  if (ids.size <= 2 && [...ids].every((id) => id === 'full_time' || id === 'student')) return true;
  return !ENTERPRISE_IMMIGRATION_STATUS_IDS.every((id) => ids.has(id));
}

/** Merge missing enterprise rows; refresh caps/labels on built-in ids without dropping custom rows. */
export function mergeEnterpriseImmigrationStatuses(
  current: EmployeeVisaCatalogEntry[],
): EmployeeVisaCatalogEntry[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  for (const enterprise of ENTERPRISE_EMPLOYEE_VISA_TYPES) {
    if (!byId.has(enterprise.id)) {
      byId.set(enterprise.id, enterprise);
    }
  }
  const enterpriseOrder = ENTERPRISE_EMPLOYEE_VISA_TYPES.map((t) => t.id);
  const custom = current.filter((t) => !enterpriseOrder.includes(t.id));
  return [
    ...enterpriseOrder.map((id) => {
      const saved = byId.get(id)!;
      const canonical = ENTERPRISE_EMPLOYEE_VISA_TYPES.find((t) => t.id === id)!;
      return {
        ...canonical,
        label: saved.label?.trim() || canonical.label,
        maxWeeklyHours: saved.maxWeeklyHours ?? canonical.maxWeeklyHours,
        defaultContractedHours: saved.defaultContractedHours ?? canonical.defaultContractedHours,
      };
    }),
    ...custom,
  ];
}

export function defaultContractedHoursForStatus(
  types: EmployeeVisaCatalogEntry[],
  visaTypeId: string | null | undefined,
): number | undefined {
  if (!visaTypeId) return undefined;
  const match = types.find((t) => t.id === visaTypeId);
  if (match?.defaultContractedHours == null) return undefined;
  return match.defaultContractedHours;
}

export function maxWeeklyHoursForStatus(
  types: EmployeeVisaCatalogEntry[],
  visaTypeId: string | null | undefined,
): number | undefined {
  if (!visaTypeId) return undefined;
  return types.find((t) => t.id === visaTypeId)?.maxWeeklyHours;
}
