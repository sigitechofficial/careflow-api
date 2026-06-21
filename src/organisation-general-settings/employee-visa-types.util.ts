import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  ENTERPRISE_EMPLOYEE_VISA_TYPES,
  LEGACY_VISA_TYPE_ID_MAP,
  enterpriseVisaLabel,
} from './employee-visa-catalog.constants';
import {
  ENTERPRISE_VISA_TYPE_IDS,
  REMOVED_LEGACY_VISA_TYPE_IDS,
  enterpriseEmployeeVisaTypes,
} from './employee-visa-catalog.runtime';

export type EmployeeVisaType = {
  id: string;
  label: string;
  weeklyHours: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVisaType(raw: unknown, index: number): EmployeeVisaType | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || REMOVED_LEGACY_VISA_TYPE_IDS.has(id)) return null;

  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const weeklyHours =
    typeof raw.weeklyHours === 'number' && Number.isFinite(raw.weeklyHours)
      ? raw.weeklyHours
      : typeof raw.weeklyHours === 'string'
        ? Number(raw.weeklyHours)
        : typeof raw.maxWeeklyHours === 'number' && Number.isFinite(raw.maxWeeklyHours)
          ? raw.maxWeeklyHours
          : typeof raw.maxWeeklyHours === 'string'
            ? Number(raw.maxWeeklyHours)
            : NaN;
  if (!label || !Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 168) return null;
  const resolvedId = id || `visa-${index}-${randomUUID().slice(0, 8)}`;
  if (resolvedId.length > 64) return null;
  return { id: resolvedId, label, weeklyHours };
}

/** Enterprise immigration catalog plus any custom org-defined statuses (legacy v1 rows are dropped). */
export function parseEmployeeVisaTypes(value: unknown): EmployeeVisaType[] {
  const parsed = Array.isArray(value)
    ? value
        .map((row, index) => parseVisaType(row, index))
        .filter((row): row is EmployeeVisaType => row !== null)
    : [];

  const byId = new Map<string, EmployeeVisaType>();
  for (const enterprise of enterpriseEmployeeVisaTypes()) {
    byId.set(enterprise.id, enterprise);
  }
  for (const row of parsed) {
    if (ENTERPRISE_VISA_TYPE_IDS.has(row.id)) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

export function serializeEmployeeVisaTypes(types: EmployeeVisaType[]): Prisma.InputJsonValue {
  const enterpriseIds = ENTERPRISE_VISA_TYPE_IDS;
  const enterpriseRows = types.filter((row) => enterpriseIds.has(row.id));
  const customRows = types.filter((row) => !enterpriseIds.has(row.id));
  const ordered = [
    ...ENTERPRISE_EMPLOYEE_VISA_TYPES.map((canonical) => {
      const saved = enterpriseRows.find((row) => row.id === canonical.id);
      return {
        id: canonical.id,
        label: saved?.label?.trim() || canonical.label,
        maxWeeklyHours: saved?.weeklyHours ?? canonical.maxWeeklyHours,
        defaultContractedHours: null,
        weeklyHours: saved?.weeklyHours ?? canonical.maxWeeklyHours,
      };
    }),
    ...customRows.map((row) => ({
      id: row.id.trim(),
      label: row.label.trim(),
      maxWeeklyHours: row.weeklyHours,
      defaultContractedHours: null,
      weeklyHours: row.weeklyHours,
    })),
  ];
  return ordered.map((row, index) => ({ ...row, sortOrder: index })) as unknown as Prisma.InputJsonValue;
}

export function weeklyHoursForVisaTypeId(
  types: EmployeeVisaType[],
  visaTypeId: string | null | undefined,
): number | undefined {
  if (!visaTypeId) return undefined;
  const match = types.find((t) => t.id === visaTypeId);
  return match?.weeklyHours;
}

export function labelForVisaTypeId(
  types: EmployeeVisaType[],
  visaTypeId: string | null | undefined,
): string | null {
  if (!visaTypeId?.trim()) return null;
  const direct = types.find((t) => t.id === visaTypeId);
  if (direct) return direct.label;
  const mapped = LEGACY_VISA_TYPE_ID_MAP[visaTypeId];
  if (mapped) {
    const legacy = types.find((t) => t.id === mapped);
    if (legacy) return legacy.label;
  }
  return enterpriseVisaLabel(visaTypeId);
}
