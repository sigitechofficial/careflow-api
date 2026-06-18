import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';

export type EmployeeVisaType = {
  id: string;
  label: string;
  weeklyHours: number;
};

export const DEFAULT_EMPLOYEE_VISA_TYPES: EmployeeVisaType[] = [
  { id: 'full_time', label: 'Full time visa', weeklyHours: 40 },
  { id: 'student', label: 'Student visa', weeklyHours: 20 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVisaType(raw: unknown, index: number): EmployeeVisaType | null {
  if (!isRecord(raw)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const weeklyHours =
    typeof raw.weeklyHours === 'number' && Number.isFinite(raw.weeklyHours)
      ? raw.weeklyHours
      : typeof raw.weeklyHours === 'string'
        ? Number(raw.weeklyHours)
        : NaN;
  if (!label || !Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 168) return null;
  let id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) id = `visa-${index}-${randomUUID().slice(0, 8)}`;
  if (id.length > 64) return null;
  return { id, label, weeklyHours };
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
    weeklyHours: t.weeklyHours,
    sortOrder: index,
  })) as unknown as Prisma.InputJsonValue;
}

export function weeklyHoursForVisaTypeId(
  types: EmployeeVisaType[],
  visaTypeId: string | null | undefined,
): number | undefined {
  if (!visaTypeId) return undefined;
  const match = types.find(t => t.id === visaTypeId);
  return match?.weeklyHours;
}
