import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';

export type DomJobCancellationRule = {
  id: string;
  hoursFrom: number;
  hoursTo: number;
  chargeServiceUserPercent: number;
  payEmployeePercent: number;
};

export type DomLateVisitZoneAlert = {
  zoneKey: string;
  label: string;
  scheduleAreaId: string | null;
  emailEmployeeIds: string[];
  notificationEmployeeIds: string[];
};

export const DEFAULT_DOM_JOB_CANCELLATION_RULES: DomJobCancellationRule[] = [
  {
    id: 'default-0-24',
    hoursFrom: 0,
    hoursTo: 24,
    chargeServiceUserPercent: 100,
    payEmployeePercent: 100,
  },
  {
    id: 'default-24-25',
    hoursFrom: 24,
    hoursTo: 25,
    chargeServiceUserPercent: 0,
    payEmployeePercent: 0,
  },
];


export function domCareZoneKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A live branch (scheduling.ScheduleArea) the late-visit alert list is built from. */
export type DomLateVisitBranch = {
  id: string;
  name: string;
  location?: { name: string } | null;
  zone?: { name: string } | null;
};

/** Same label rule as the admin (`scheduleAreaDisplayLabel`): Location name, else "Zone - Branch". */
export function domLateVisitBranchLabel(area: DomLateVisitBranch): string {
  const location = area.location?.name?.trim();
  if (location) return location;
  const zone = area.zone?.name?.trim();
  if (zone) return `${zone} - ${area.name}`;
  return area.name;
}

/** One empty alert entry per real branch (no hard-coded sample branch names). */
export function defaultDomLateVisitZoneAlerts(
  branches: DomLateVisitBranch[] = [],
): DomLateVisitZoneAlert[] {
  return branches.map((area) => {
    const label = domLateVisitBranchLabel(area);
    return {
      zoneKey: domCareZoneKey(label),
      label,
      scheduleAreaId: area.id,
      emailEmployeeIds: [],
      notificationEmployeeIds: [],
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRule(raw: unknown): DomJobCancellationRule | null {
  if (!isRecord(raw)) return null;
  const hoursFrom = Number(raw.hoursFrom);
  const hoursTo = Number(raw.hoursTo);
  const chargeServiceUserPercent = Number(raw.chargeServiceUserPercent);
  const payEmployeePercent = Number(raw.payEmployeePercent);
  if (
    !Number.isFinite(hoursFrom) ||
    !Number.isFinite(hoursTo) ||
    !Number.isFinite(chargeServiceUserPercent) ||
    !Number.isFinite(payEmployeePercent)
  ) {
    return null;
  }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : randomUUID();
  return {
    id,
    hoursFrom: Math.max(0, Math.round(hoursFrom)),
    hoursTo: Math.max(0, Math.round(hoursTo)),
    chargeServiceUserPercent: Math.min(100, Math.max(0, Math.round(chargeServiceUserPercent))),
    payEmployeePercent: Math.min(100, Math.max(0, Math.round(payEmployeePercent))),
  };
}

export function parseDomJobCancellationRules(value: Prisma.JsonValue | null | undefined): DomJobCancellationRule[] {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_DOM_JOB_CANCELLATION_RULES];
  const parsed = value.map(parseRule).filter((r): r is DomJobCancellationRule => r !== null);
  return parsed.length > 0 ? parsed : [...DEFAULT_DOM_JOB_CANCELLATION_RULES];
}

function parseZoneAlert(raw: unknown): DomLateVisitZoneAlert | null {
  if (!isRecord(raw)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (!label) return null;
  const zoneKey =
    typeof raw.zoneKey === 'string' && raw.zoneKey.trim() ? raw.zoneKey.trim() : domCareZoneKey(label);
  const scheduleAreaId =
    typeof raw.scheduleAreaId === 'string' && raw.scheduleAreaId.trim() ? raw.scheduleAreaId.trim() : null;
  const emailEmployeeIds = Array.isArray(raw.emailEmployeeIds)
    ? raw.emailEmployeeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const notificationEmployeeIds = Array.isArray(raw.notificationEmployeeIds)
    ? raw.notificationEmployeeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  return { zoneKey, label, scheduleAreaId, emailEmployeeIds, notificationEmployeeIds };
}

/**
 * Late-visit alert list for the live branches, in branch order.
 * Saved per-branch recipients are matched by scheduleAreaId first, then (legacy rows saved before
 * scheduleAreaId was set) by the label-derived zoneKey. Saved entries whose branch no longer
 * exists (e.g. the old sample branches) are dropped; branches without an entry get an empty one.
 * Without `branches` (unknown) the saved entries are returned as they are.
 */
export function parseDomLateVisitZoneAlerts(
  value: Prisma.JsonValue | null | undefined,
  branches?: DomLateVisitBranch[],
): DomLateVisitZoneAlert[] {
  const parsed = Array.isArray(value)
    ? value.map(parseZoneAlert).filter((z): z is DomLateVisitZoneAlert => z !== null)
    : [];
  if (!branches) {
    const byKey = new Map<string, DomLateVisitZoneAlert>();
    for (const zone of parsed) byKey.set(zone.zoneKey, zone);
    return [...byKey.values()];
  }

  const byAreaId = new Map<string, DomLateVisitZoneAlert>();
  const byKey = new Map<string, DomLateVisitZoneAlert>();
  for (const zone of parsed) {
    if (zone.scheduleAreaId) byAreaId.set(zone.scheduleAreaId, zone);
    else byKey.set(zone.zoneKey, zone);
  }

  return defaultDomLateVisitZoneAlerts(branches).map((fresh) => {
    const saved = byAreaId.get(fresh.scheduleAreaId as string) ?? byKey.get(fresh.zoneKey);
    if (!saved) return fresh;
    return {
      ...fresh,
      emailEmployeeIds: saved.emailEmployeeIds,
      notificationEmployeeIds: saved.notificationEmployeeIds,
    };
  });
}

export function serializeDomJobCancellationRules(rules: DomJobCancellationRule[]): Prisma.InputJsonValue {
  return rules.map((r) => ({
    id: r.id,
    hoursFrom: r.hoursFrom,
    hoursTo: r.hoursTo,
    chargeServiceUserPercent: r.chargeServiceUserPercent,
    payEmployeePercent: r.payEmployeePercent,
  }));
}

export function serializeDomLateVisitZoneAlerts(zones: DomLateVisitZoneAlert[]): Prisma.InputJsonValue {
  return zones.map((z) => ({
    zoneKey: z.zoneKey,
    label: z.label,
    scheduleAreaId: z.scheduleAreaId,
    emailEmployeeIds: z.emailEmployeeIds,
    notificationEmployeeIds: z.notificationEmployeeIds,
  }));
}
