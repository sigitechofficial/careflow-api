import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  ENTERPRISE_EMPLOYEE_VISA_TYPES,
  type EmployeeVisaCatalogEntry,
} from './employee-visa-catalog';

export type EmployeeVisaType = EmployeeVisaCatalogEntry;

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
