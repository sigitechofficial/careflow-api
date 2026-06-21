import { ENTERPRISE_EMPLOYEE_VISA_TYPES } from './employee-visa-catalog.constants';

/** Legacy immigration ids removed from the product — remap on read/write. */
export const REMOVED_LEGACY_VISA_TYPE_IDS = new Set(['full_time', 'student']);

export const ENTERPRISE_VISA_TYPE_IDS = new Set(
  ENTERPRISE_EMPLOYEE_VISA_TYPES.map((row) => row.id),
);

export function enterpriseEmployeeVisaTypes(): Array<{
  id: string;
  label: string;
  weeklyHours: number;
}> {
  return ENTERPRISE_EMPLOYEE_VISA_TYPES.map((row) => ({
    id: row.id,
    label: row.label,
    weeklyHours: row.maxWeeklyHours,
  }));
}

export function serializeEnterpriseEmployeeVisaTypes(): string {
  return JSON.stringify(
    ENTERPRISE_EMPLOYEE_VISA_TYPES.map((row, index) => ({
      id: row.id,
      label: row.label,
      maxWeeklyHours: row.maxWeeklyHours,
      defaultContractedHours: null,
      weeklyHours: row.maxWeeklyHours,
      sortOrder: index,
    })),
  );
}
