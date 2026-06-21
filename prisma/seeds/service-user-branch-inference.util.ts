/**
 * Branch inference for persona seeds — kept in prisma/seeds (no src/ imports on deploy VPS).
 */
import type { PrismaClient } from '@prisma/client';

function parseLocationName(name: string | null | undefined): { zoneName: string; roomName: string } {
  if (!name?.trim()) return { zoneName: '', roomName: '' };
  const idx = name.indexOf(' - ');
  if (idx === -1) return { zoneName: name.trim(), roomName: name.trim() };
  return {
    zoneName: name.slice(0, idx).trim(),
    roomName: name.slice(idx + 3).trim(),
  };
}

function normalizeBranchToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

export function inferBranchFromAddress(
  address: { town?: string | null; postcode?: string | null; county?: string | null } | null,
  areas: Array<{
    locationId: string;
    branchLabel: string;
    zoneName: string;
  }>,
): { locationId: string; zoneName: string; branchLabel: string } | null {
  if (!address) return null;

  const town = normalizeBranchToken(address.town ?? '');
  const postcode = (address.postcode ?? '').trim().toUpperCase();
  if (!town && !postcode) return null;

  const zoneGroups = new Map<string, typeof areas>();
  for (const area of areas) {
    const zoneKey = normalizeBranchToken(area.zoneName);
    const list = zoneGroups.get(zoneKey) ?? [];
    list.push(area);
    zoneGroups.set(zoneKey, list);
  }

  const pickFromZone = (zoneName: string) => {
    const group = zoneGroups.get(normalizeBranchToken(zoneName));
    return group?.[0] ?? null;
  };

  for (const area of areas) {
    const branchToken = normalizeBranchToken(area.branchLabel);
    const zoneToken = normalizeBranchToken(area.zoneName);
    if (town && (town === branchToken || town === zoneToken)) return area;
    if (town && zoneToken && town.includes(zoneToken)) return pickFromZone(area.zoneName) ?? area;
    if (town && branchToken && branchToken.startsWith(town)) return area;
  }

  if (postcode.startsWith('CR')) return pickFromZone('Croydon');
  if (postcode.startsWith('BR')) return pickFromZone('Bexley');
  if (postcode.startsWith('SE10') || town.includes('greenwich')) return pickFromZone('Greenwich');
  if (postcode.startsWith('N17') || town.includes('tottenham') || town.includes('haringey'))
    return pickFromZone('Haringey');
  if (postcode.startsWith('SM') || town.includes('merton')) return pickFromZone('Merton');
  if (town.includes('bromley')) return pickFromZone('Bexley');
  if (town.includes('hackney') || town.includes('stratford') || town.includes('waltham'))
    return pickFromZone('Haringey');
  if (town.includes('enfield') || town.includes('chingford') || town.includes('barnet'))
    return pickFromZone('Haringey');
  if (town.includes('wembley') || town.includes('southall')) return pickFromZone('Merton');
  if (town.includes('richmond')) return pickFromZone('Merton');
  if (town.includes('ilford')) return pickFromZone('Greenwich');

  return null;
}

export async function loadBranchAreasForInference(prisma: PrismaClient) {
  const areas = await prisma.scheduleArea.findMany({
    where: { deletedAt: null, isActive: true, locationId: { not: null } },
    select: {
      name: true,
      locationId: true,
      parentZoneName: true,
      location: { select: { name: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return areas
    .filter((area) => area.locationId)
    .map((area) => {
      const parsed = parseLocationName(area.location?.name ?? null);
      const zoneName = area.parentZoneName?.trim() || parsed.zoneName || area.name;
      return {
        locationId: area.locationId as string,
        zoneName,
        branchLabel: area.name,
      };
    });
}
