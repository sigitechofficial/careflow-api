/** Keep in sync with prisma/seed-data/employee-visa-catalog.ts */
export const ENTERPRISE_EMPLOYEE_VISA_TYPES: Array<{
  id: string;
  label: string;
  maxWeeklyHours: number;
}> = [
  { id: 'british_citizen', label: 'British citizen', maxWeeklyHours: 40 },
  { id: 'irish_citizen', label: 'Irish citizen', maxWeeklyHours: 40 },
  { id: 'settled_status', label: 'Settled status / ILR', maxWeeklyHours: 40 },
  { id: 'pre_settled_euss', label: 'Pre-settled status (EUSS)', maxWeeklyHours: 40 },
  { id: 'skilled_worker', label: 'Skilled Worker', maxWeeklyHours: 40 },
  { id: 'health_care_worker', label: 'Health and Care Worker', maxWeeklyHours: 40 },
  { id: 'student_visa', label: 'Student visa', maxWeeklyHours: 20 },
  { id: 'student_visa_sub_degree', label: 'Student visa (sub-degree course)', maxWeeklyHours: 10 },
  { id: 'graduate_visa', label: 'Graduate visa', maxWeeklyHours: 40 },
  { id: 'dependent_family', label: 'Dependent / family visa', maxWeeklyHours: 40 },
  { id: 'other_time_limited', label: 'Other time-limited leave', maxWeeklyHours: 40 },
  { id: 'not_applicable', label: 'Not applicable', maxWeeklyHours: 40 },
];

export const LEGACY_VISA_TYPE_ID_MAP: Record<string, string> = {
  full_time: 'skilled_worker',
  student: 'student_visa',
};

/** Visa routes that carry UKVI sponsor (SMS) reporting duties. */
export const SPONSORED_VISA_TYPE_IDS = new Set(['skilled_worker', 'health_care_worker']);

/** Canonical visa metadata (legacy ids remapped), or null when unknown. */
export function resolveEnterpriseVisaMeta(
  visaTypeId: string | null | undefined,
): { id: string; label: string; maxWeeklyHours: number; sponsored: boolean } | null {
  if (!visaTypeId) return null;
  const canonical = ENTERPRISE_EMPLOYEE_VISA_TYPES.some((row) => row.id === visaTypeId)
    ? visaTypeId
    : LEGACY_VISA_TYPE_ID_MAP[visaTypeId] ?? null;
  if (!canonical) return null;
  const entry = ENTERPRISE_EMPLOYEE_VISA_TYPES.find((row) => row.id === canonical);
  if (!entry) return null;
  return {
    id: entry.id,
    label: entry.label,
    maxWeeklyHours: entry.maxWeeklyHours,
    sponsored: SPONSORED_VISA_TYPE_IDS.has(entry.id),
  };
}

export function enterpriseVisaLabel(visaTypeId: string): string | null {
  const direct = ENTERPRISE_EMPLOYEE_VISA_TYPES.find((row) => row.id === visaTypeId);
  if (direct) return direct.label;
  const mapped = LEGACY_VISA_TYPE_ID_MAP[visaTypeId];
  if (!mapped) return null;
  return ENTERPRISE_EMPLOYEE_VISA_TYPES.find((row) => row.id === mapped)?.label ?? null;
}
