import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  ENTERPRISE_EMPLOYEE_VISA_TYPES,
  defaultContractedHoursForStatus,
  maxWeeklyHoursForStatus,
  mergeEnterpriseImmigrationStatuses,
} from '../../prisma/seed-data/employee-visa-catalog';

export type EmployeeVisaType = {
  id: string;
  label: string;
  maxWeeklyHours: number;
  defaultContractedHours: number | null;
};

export const DEFAULT_EMPLOYEE_VISA_TYPES: EmployeeVisaType[] = [...ENTERPRISE_EMPLOYEE_VISA_TYPES];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHours(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function parseVisaType(raw: unknown, index: number): EmployeeVisaType | null {
  if (!isRecord(raw)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const maxWeeklyHours = parseHours(raw.maxWeeklyHours ?? raw.weeklyHours);
  if (!label || !Number.isFinite(maxWeeklyHours) || maxWeeklyHours < 0 || maxWeeklyHours > 168) return null;
  let id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) id = `visa-${index}-${randomUUID().slice(0, 8)}`;
  if (id.length > 64) return null;
  const defaultRaw = raw.defaultContractedHours;
  let defaultContractedHours: number | null = null;
  if (defaultRaw === null || defaultRaw === undefined || defaultRaw === '') {
    defaultContractedHours = null;
  } else {
    const d = parseHours(defaultRaw);
    defaultContractedHours = Number.isFinite(d) ? d : null;
  }
  return { id, label, maxWeeklyHours, defaultContractedHours };
}

export function parseEmployeeVisaTypes(value: unknown): EmployeeVisaType[] {
  if (!Array.isArray(value)) return [...DEFAULT_EMPLOYEE_VISA_TYPES];
  const parsed = value
    .map((row, index) => parseVisaType(row, index))
    .filter((row): row is EmployeeVisaType => row !== null);
  return parsed.length > 0 ? parsed : [...DEFAULT_EMPLOYEE_VISA_TYPES];
}

export function serializeEmployeeVisaTypes(types: EmployeeVisaType[]): Prisma.InputJsonValue {
  return types.map((t, index) => ({
    id: t.id.trim(),
    label: t.label.trim(),
    maxWeeklyHours: t.maxWeeklyHours,
    defaultContractedHours: t.defaultContractedHours,
    weeklyHours: t.maxWeeklyHours,
    sortOrder: index,
  })) as unknown as Prisma.InputJsonValue;
}

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
