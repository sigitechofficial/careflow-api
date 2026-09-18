import type { Prisma } from '@prisma/client';

export const INCIDENT_DEFAULT_STATUSES = ['REPORTED', 'DRAFT', 'UNDER_REVIEW', 'CLOSED'] as const;
export type IncidentDefaultStatus = (typeof INCIDENT_DEFAULT_STATUSES)[number];

export type IncidentTypeSetting = {
  key: string;
  label: string;
  required: boolean;
};

export type IncidentCatalogOption = {
  key: string;
  label: string;
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

export const DEFAULT_INCIDENT_SEVERITY_SETTINGS: IncidentTypeSetting[] = [
  { key: 'low', label: 'Low', required: true },
  { key: 'medium', label: 'Medium', required: true },
  { key: 'high', label: 'High', required: true },
  { key: 'critical', label: 'Critical', required: true },
];

export const DEFAULT_INCIDENT_WHO_INFORMED_SETTINGS: IncidentTypeSetting[] = [
  { key: 'office', label: 'Office', required: true },
  { key: 'on_call_manager', label: 'On-call manager', required: true },
  { key: 'family_nok', label: 'Family / NOK', required: true },
  { key: 'gp', label: 'GP', required: true },
  { key: 'emergency_999', label: '999', required: true },
  { key: 'safeguarding_lead', label: 'Safeguarding lead', required: true },
  { key: 'local_authority', label: 'Local authority', required: true },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseType(
  raw: unknown,
  defaults: IncidentTypeSetting[] = DEFAULT_INCIDENT_TYPE_SETTINGS,
): IncidentTypeSetting | null {
  if (!isRecord(raw)) return null;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;
  const defaultRow = defaults.find((t) => t.key === key);
  const label =
    typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : (defaultRow?.label ?? key);
  const required = raw.required === false ? false : true;
  return { key, label, required };
}

function parseFixedCatalog(
  value: Prisma.JsonValue | null | undefined,
  defaults: IncidentTypeSetting[],
): IncidentTypeSetting[] {
  const byKey = new Map<string, IncidentTypeSetting>();
  if (Array.isArray(value)) {
    for (const row of value) {
      const parsed = parseType(row, defaults);
      if (parsed) byKey.set(parsed.key, parsed);
    }
  }
  return defaults.map((def) => {
    const saved = byKey.get(def.key);
    return saved ? { ...def, required: saved.required } : { ...def };
  });
}

export function parseIncidentTypeSettings(
  value: Prisma.JsonValue | null | undefined,
): IncidentTypeSetting[] {
  return parseFixedCatalog(value, DEFAULT_INCIDENT_TYPE_SETTINGS);
}

export function parseIncidentSeveritySettings(
  value: Prisma.JsonValue | null | undefined,
): IncidentTypeSetting[] {
  return parseFixedCatalog(value, DEFAULT_INCIDENT_SEVERITY_SETTINGS);
}

export function parseIncidentWhoInformedSettings(
  value: Prisma.JsonValue | null | undefined,
): IncidentTypeSetting[] {
  const byKey = new Map<string, IncidentTypeSetting>();
  if (Array.isArray(value)) {
    for (const row of value) {
      const parsed = parseType(row, DEFAULT_INCIDENT_WHO_INFORMED_SETTINGS);
      if (parsed) byKey.set(parsed.key, parsed);
    }
  }
  const merged = DEFAULT_INCIDENT_WHO_INFORMED_SETTINGS.map((def) => {
    const saved = byKey.get(def.key);
    return saved ? { ...def, required: saved.required, label: saved.label } : { ...def };
  });
  const extras: IncidentTypeSetting[] = [];
  for (const [key, row] of byKey) {
    if (!DEFAULT_INCIDENT_WHO_INFORMED_SETTINGS.some((d) => d.key === key)) {
      extras.push(row);
    }
  }
  return [...merged, ...extras];
}

export function serializeIncidentTypeSettings(types: IncidentTypeSetting[]): Prisma.InputJsonValue {
  return types.map((t) => ({ key: t.key, label: t.label, required: t.required }));
}

export function incidentCatalogForApp(
  items: IncidentTypeSetting[],
  defaults: IncidentTypeSetting[],
): IncidentCatalogOption[] {
  const enabled = items.filter((i) => i.required);
  const source = enabled.length ? enabled : defaults;
  return source.map((i) => ({ key: i.key, label: i.label }));
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
