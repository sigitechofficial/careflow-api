import type { PrismaClient } from '@prisma/client';
export const ZONE_MARKER_COLORS = [
  '#EAB308',
  '#F97316',
  '#86EFAC',
  '#6B7280',
  '#22C55E',
  '#EC4899',
  '#3B82F6',
  '#A855F7',
] as const;

export const ZONE_GROUP_ID_PREFIX = 'zone-group:';

export function parseUserIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

export function defaultMarkerColor(index: number): string {
  return ZONE_MARKER_COLORS[index % ZONE_MARKER_COLORS.length] ?? '#3B82F6';
}

export function formatPersonLabel(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  addressLine: string | null | undefined,
): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unknown';
  if (addressLine?.trim()) return `${name}, ${addressLine.trim()}`;
  return name;
}

export function parseLocationName(name: string | null | undefined): {
  zoneName: string;
  roomName: string;
} {
  if (!name?.trim()) return { zoneName: '', roomName: '' };
  const idx = name.indexOf(' - ');
  if (idx === -1) return { zoneName: name.trim(), roomName: name.trim() };
  return {
    zoneName: name.slice(0, idx).trim(),
    roomName: name.slice(idx + 3).trim(),
  };
}

export function parentZoneFromLocationName(name: string | null | undefined): string {
  return parseLocationName(name).zoneName || name?.trim() || '';
}

export function zoneGroupId(parentZoneName: string): string {
  return `${ZONE_GROUP_ID_PREFIX}${parentZoneName}`;
}

export function isZoneGroupId(id: string): boolean {
  return id.startsWith(ZONE_GROUP_ID_PREFIX);
}

export function parentZoneFromGroupId(id: string): string | null {
  if (!isZoneGroupId(id)) return null;
  return id.slice(ZONE_GROUP_ID_PREFIX.length);
}

export function resolveParentZoneName(
  parentZoneName: string | null | undefined,
  locationName: string | null | undefined,
  areaName: string,
): string {
  if (parentZoneName?.trim()) return parentZoneName.trim();
  const fromLocation = parentZoneFromLocationName(locationName);
  if (fromLocation) return fromLocation;
  return areaName;
}

export function formatFloorNames(
  locationNames: string[],
  accessAllZones: boolean,
  parentZone: string,
): string {
  if (accessAllZones && parentZone) {
    return locationNames
      .filter((n) => parentZoneFromLocationName(n) === parentZone)
      .map((n) => parseLocationName(n).roomName)
      .filter(Boolean)
      .join(', ');
  }
  return locationNames
    .map((n) => parseLocationName(n).roomName)
    .filter(Boolean)
    .join(', ');
}

/** Uppercase, strip all whitespace — for unique postcode keys. */
export function normalizePostcodeKey(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** Display form: outward + inward with a single space when possible. */
export function formatPostcodeDisplay(raw: string): string {
  const key = normalizePostcodeKey(raw);
  if (key.length > 3) {
    return `${key.slice(0, key.length - 3)} ${key.slice(key.length - 3)}`;
  }
  return key;
}

export function parsePostcodeList(raw: string[] | undefined | null): Array<{
  postcode: string;
  normalizedPostcode: string;
}> {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: Array<{ postcode: string; normalizedPostcode: string }> = [];
  for (const item of raw) {
    const trimmed = typeof item === 'string' ? item.trim() : '';
    if (!trimmed) continue;
    const normalizedPostcode = normalizePostcodeKey(trimmed);
    if (!normalizedPostcode || seen.has(normalizedPostcode)) continue;
    seen.add(normalizedPostcode);
    out.push({
      postcode: formatPostcodeDisplay(trimmed),
      normalizedPostcode,
    });
  }
  return out;
}

export function slugifyAreaCode(name: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
  return base || 'AREA';
}

export const LOCATION_AUDIT_USER_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
} as const;

export type LocationAuditActor = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
} | null | undefined;

export type LocationAuditDto = {
  createdAt: string | null;
  updatedAt: string | null;
  createdByName: string | null;
  updatedByName: string | null;
};

export function actorDisplayName(user: LocationAuditActor): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email?.trim() || null;
}

export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toLocationAudit(row: {
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdBy?: LocationAuditActor;
  updatedBy?: LocationAuditActor;
}): LocationAuditDto {
  return {
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
    createdByName: actorDisplayName(row.createdBy),
    updatedByName: actorDisplayName(row.updatedBy),
  };
}

export function normalizeOptionalLocationId(locationId?: string | null): string | undefined {
  const trimmed = locationId?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Branch label shown to the office, the same as the staff record's Zones/Branches picker:
 * "Zone · Branch" (e.g. "London · Bexley"). Zone: the schedule area's parent zone, else its zone,
 * else the part of the location name before " - ". Branch: the schedule area's name, else the part
 * after " - ", else the location name.
 */
export function branchDisplayParts(
  locationName: string,
  area?: { name?: string | null; parentZoneName?: string | null; zone?: { name: string } | null } | null,
): { zoneName: string; branchName: string } {
  const parsed = parseLocationName(locationName);
  const zoneName = area?.parentZoneName?.trim() || area?.zone?.name || parsed.zoneName || locationName;
  const branchName = area?.name || parsed.roomName || locationName;
  return { zoneName, branchName };
}

export function branchDisplayLabel(
  locationName: string,
  area?: { name?: string | null; parentZoneName?: string | null; zone?: { name: string } | null } | null,
): string {
  const { zoneName, branchName } = branchDisplayParts(locationName, area);
  return zoneName && zoneName !== branchName ? `${zoneName} · ${branchName}` : branchName;
}

/** "Zone · Branch" labels for these locations (see branchDisplayLabel). */
export async function branchLabelsById(
  prisma: Pick<PrismaClient, 'location' | 'scheduleArea'>,
  locationIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const [locations, areas] = await Promise.all([
    prisma.location.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.scheduleArea.findMany({
      where: { locationId: { in: ids }, deletedAt: null },
      select: { locationId: true, name: true, parentZoneName: true, zone: { select: { name: true } } },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);
  const areaByLocation = new Map<string, (typeof areas)[number]>();
  for (const a of areas) if (a.locationId && !areaByLocation.has(a.locationId)) areaByLocation.set(a.locationId, a);
  return new Map(locations.map((l) => [l.id, branchDisplayLabel(l.name, areaByLocation.get(l.id))]));
}
