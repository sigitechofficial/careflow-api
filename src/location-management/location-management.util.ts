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
