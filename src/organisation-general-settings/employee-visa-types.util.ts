import {
  defaultContractedHoursForStatus,
  maxWeeklyHoursForStatus,
  mergeEnterpriseImmigrationStatuses,
} from '../../prisma/seed-data/employee-visa-catalog';
import {
  DEFAULT_EMPLOYEE_VISA_TYPES,
  parseEmployeeVisaTypes,
  serializeEmployeeVisaTypes,
  type EmployeeVisaType,
} from '../../prisma/seed-data/employee-visa-types.util';

export type { EmployeeVisaType };
export { DEFAULT_EMPLOYEE_VISA_TYPES, parseEmployeeVisaTypes, serializeEmployeeVisaTypes };

export function weeklyHoursForVisaTypeId(
  types: EmployeeVisaType[],
  visaTypeId: string | null | undefined,
): number | undefined {
  return maxWeeklyHoursForStatus(types, visaTypeId);
}

export function labelForVisaTypeId(
  types: EmployeeVisaType[],
  visaTypeId: string | null | undefined,
): string | undefined {
  if (!visaTypeId) return undefined;
  return types.find((t) => t.id === visaTypeId)?.label;
}

export { defaultContractedHoursForStatus, maxWeeklyHoursForStatus, mergeEnterpriseImmigrationStatuses };

export function visaTypeAutoFillsContractedHours(
  types: EmployeeVisaType[],
  visaTypeId: string | null | undefined,
): boolean {
  return defaultContractedHoursForStatus(types, visaTypeId) != null;
}

export type WeeklyHoursCapOverride = {
  weeklyHoursCapOverride?: number | null;
  weeklyHoursCapOverrideReason?: string | null;
  weeklyHoursCapOverrideExpiresAt?: Date | string | null;
};

export function isWeeklyHoursCapOverrideActive(
  override: WeeklyHoursCapOverride | null | undefined,
  at: Date = new Date(),
): boolean {
  if (override?.weeklyHoursCapOverride == null || !Number.isFinite(override.weeklyHoursCapOverride)) {
    return false;
  }
  const expires = override.weeklyHoursCapOverrideExpiresAt;
  if (expires) {
    const d = expires instanceof Date ? expires : new Date(expires);
    if (!Number.isNaN(d.getTime()) && d < at) return false;
  }
  return true;
}

/** Immigration status cap, or per-employee approved override when active. */
export function effectiveWeeklyHoursCap(
  types: EmployeeVisaType[],
  visaTypeId: string | null | undefined,
  override?: WeeklyHoursCapOverride | null,
  at: Date = new Date(),
): number | undefined {
  if (isWeeklyHoursCapOverrideActive(override, at)) {
    return override!.weeklyHoursCapOverride!;
  }
  if (!visaTypeId) return undefined;
  return maxWeeklyHoursForStatus(types, visaTypeId);
}

export function assertEmploymentHoursWithinVisaLimit(
  types: EmployeeVisaType[],
  visaTypeId: string | null | undefined,
  hours: { contractedWeeklyHours?: number | null; maximumWeeklyHours?: number | null },
  override?: WeeklyHoursCapOverride | null,
  at: Date = new Date(),
): string | null {
  const cap = effectiveWeeklyHoursCap(types, visaTypeId, override, at);
  if (cap == null || !visaTypeId) return null;
  const statusLabel = labelForVisaTypeId(types, visaTypeId) ?? visaTypeId;
  const overrideActive = isWeeklyHoursCapOverrideActive(override, at);
  for (const [field, value] of [
    ['Contracted weekly hours', hours.contractedWeeklyHours],
    ['Maximum weekly hours', hours.maximumWeeklyHours],
  ] as const) {
    if (value != null && value > cap) {
      const capNote = overrideActive
        ? `${cap}h/week approved override`
        : `${cap}h/week allowed limit for "${statusLabel}"`;
      return `${field} (${value}h) exceeds the ${capNote}.`;
    }
  }
  return null;
}

export function normalizeEmployeeVisaTypeInput(raw: {
  id: string;
  label: string;
  maxWeeklyHours?: number;
  weeklyHours?: number;
  defaultContractedHours?: number | null;
}): EmployeeVisaType {
  const maxWeeklyHours = raw.maxWeeklyHours ?? raw.weeklyHours ?? 40;
  let defaultContractedHours = raw.defaultContractedHours ?? null;
  if (defaultContractedHours != null && defaultContractedHours > maxWeeklyHours) {
    defaultContractedHours = maxWeeklyHours;
  }
  return {
    id: raw.id.trim(),
    label: raw.label.trim(),
    maxWeeklyHours,
    defaultContractedHours,
  };
}
