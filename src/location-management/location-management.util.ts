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
