import type { Prisma } from '@prisma/client';

export const INCIDENT_DEFAULT_STATUSES = ['REPORTED', 'DRAFT', 'UNDER_REVIEW', 'CLOSED'] as const;
export type IncidentDefaultStatus = (typeof INCIDENT_DEFAULT_STATUSES)[number];

export type IncidentTypeSetting = {
  key: string;
  label: string;
  required: boolean;
};

export const DEFAULT_INCIDENT_TYPE_SETTINGS: IncidentTypeSetting[] = [
  { key: 'accident', label: 'Accident', required: true },
  { key: 'behaviour', label: 'Behaviour', required: true },
  { key: 'concerns', label: 'Concerns', required: true },
  { key: 'fall', label: 'Fall', required: true },
  { key: 'incident', label: 'Incident', required: true },
  { key: 'medication', label: 'Medication', required: true },
  { key: 'near_miss', label: 'Near Miss', required: true },
  { key: 'safeguarding', label: 'Safeguarding', required: true },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseType(raw: unknown): IncidentTypeSetting | null {
  if (!isRecord(raw)) return null;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;
  const defaultRow = DEFAULT_INCIDENT_TYPE_SETTINGS.find((t) => t.key === key);
  const label =
    typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : (defaultRow?.label ?? key);
  const required = raw.required === false ? false : true;
  return { key, label, required };
}

export function parseIncidentTypeSettings(value: Prisma.JsonValue | null | undefined): IncidentTypeSetting[] {
  const byKey = new Map<string, IncidentTypeSetting>();
  if (Array.isArray(value)) {
    for (const row of value) {
      const parsed = parseType(row);
      if (parsed) byKey.set(parsed.key, parsed);
    }
  }
  return DEFAULT_INCIDENT_TYPE_SETTINGS.map((def) => {
    const saved = byKey.get(def.key);
    return saved ? { ...def, required: saved.required } : { ...def };
  });
}

export function serializeIncidentTypeSettings(types: IncidentTypeSetting[]): Prisma.InputJsonValue {
  return types.map((t) => ({ key: t.key, label: t.label, required: t.required }));
}

export function parseIncidentDefaultStatus(value: string | null | undefined): IncidentDefaultStatus {
  if (value && INCIDENT_DEFAULT_STATUSES.includes(value as IncidentDefaultStatus)) {
    return value as IncidentDefaultStatus;
  }
  return 'REPORTED';
}

export function incidentStatusLabel(status: IncidentDefaultStatus): string {
  const labels: Record<IncidentDefaultStatus, string> = {
    REPORTED: 'Reported',
    DRAFT: 'Draft',
    UNDER_REVIEW: 'Under review',
    CLOSED: 'Closed',
  };
  return labels[status];
}
