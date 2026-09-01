import type { PrismaService } from '../prisma/prisma.service';
import { parseLocationName } from './location-management.util';

export type ScheduleAreaBranchLookup = {
  name: string;
  parentZoneName: string | null;
  location: { name: string } | null;
  zone: { name: string } | null;
};

export type ServiceUserBranchFields = {
  locationId: string | null;
  locationName: string | null;
  zoneName: string | null;
  branchName: string | null;
  branchLayers: string[];
  displayLabel: string;
};

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

  const pickByBranchHint = (hint: string) => {
    const key = normalizeBranchToken(hint);
    return (
      areas.find((a) => normalizeBranchToken(a.branchLabel).includes(key)) ??
      areas.find((a) => normalizeBranchToken(a.branchLabel) === key) ??
      null
    );
  };

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
    if (town && branchToken.includes(town)) return area;
  }

  if (postcode.startsWith('CR') || town.includes('croydon')) {
    return pickByBranchHint('Croydon 1') ?? pickByBranchHint('Croydon') ?? pickFromZone('London');
  }
  if (postcode.startsWith('BR') || town.includes('bexley') || town.includes('bromley')) {
    return pickByBranchHint('Bexley') ?? pickFromZone('London');
  }
  if (postcode.startsWith('SE10') || town.includes('greenwich')) {
    return pickByBranchHint('Greenwich') ?? pickFromZone('London');
  }
  if (
    postcode.startsWith('N17') ||
    town.includes('tottenham') ||
    town.includes('haringey') ||
    town.includes('hackney') ||
    town.includes('stratford') ||
    town.includes('waltham') ||
    town.includes('enfield') ||
    town.includes('chingford') ||
    town.includes('barnet')
  ) {
    return pickByBranchHint('Haringey') ?? pickFromZone('London');
  }
  if (
    postcode.startsWith('SM') ||
    town.includes('merton') ||
    town.includes('wembley') ||
    town.includes('southall') ||
    town.includes('richmond')
  ) {
    return pickByBranchHint('Merton') ?? pickFromZone('London');
  }
  if (town.includes('ilford')) {
    return pickByBranchHint('Greenwich') ?? pickFromZone('London');
  }
  if (town.includes('birmingham')) return pickFromZone('Birmingham');
  if (town.includes('manchester')) return pickFromZone('Manchester');
  if (town.includes('leeds')) return pickFromZone('Leeds');
  if (town.includes('glasgow')) return pickFromZone('Glasgow');
  if (town.includes('edinburgh')) return pickFromZone('Edinburgh');
  if (town.includes('liverpool')) return pickFromZone('Liverpool');
  if (town.includes('bristol')) return pickFromZone('Bristol');
  if (town.includes('sheffield')) return pickFromZone('Sheffield');
  if (town.includes('newcastle')) return pickFromZone('Newcastle');
  if (town.includes('cardiff')) return pickFromZone('Cardiff');
  if (town.includes('belfast')) return pickFromZone('Belfast');
  if (town.includes('london')) return pickFromZone('London');

  return null;
}

export function pickDefaultBranchForIndex(
  areas: Array<{ locationId: string; zoneName: string; branchLabel: string }>,
  index: number,
): { locationId: string; zoneName: string; branchLabel: string } | null {
  if (!areas.length) return null;
  return areas[index % areas.length];
}

function normalizeBranchToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function pushBranchLayer(layers: string[], value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const norm = normalizeBranchToken(trimmed);
  if (layers.some((layer) => normalizeBranchToken(layer) === norm)) return;
  layers.push(trimmed);
}

/** Ordered zone → branch path; skips only exact duplicate layer names. */
export function buildBranchDisplayLayers(
  scheduleArea: ScheduleAreaBranchLookup | undefined,
  locationName: string | null | undefined,
): string[] {
  const layers: string[] = [];
  const resolvedLocationName = locationName ?? scheduleArea?.location?.name ?? null;
  const parsed = parseLocationName(resolvedLocationName);

  const zoneCandidates = [
    scheduleArea?.parentZoneName,
    scheduleArea?.zone?.name,
    parsed.zoneName,
  ];
  for (const candidate of zoneCandidates) {
    if (!candidate?.trim()) continue;
    const zonePart = candidate.includes(' - ')
      ? parseLocationName(candidate).zoneName
      : candidate.trim();
    if (zonePart) pushBranchLayer(layers, zonePart);
    if (layers.length) break;
  }

  const branchCandidates = [scheduleArea?.name, parsed.roomName];
  for (const candidate of branchCandidates) {
    if (!candidate?.trim()) continue;
    pushBranchLayer(layers, candidate.trim());
    break;
  }

  if (
    layers.length === 2 &&
    normalizeBranchToken(layers[0]) === normalizeBranchToken(layers[1])
  ) {
    return [layers[1]];
  }

  if (!layers.length && resolvedLocationName) {
    const fallback = parsed.roomName || parsed.zoneName || resolvedLocationName.trim();
    pushBranchLayer(layers, fallback);
  }

  return layers;
}

export function formatBranchLayerPath(layers: string[]): string {
  return layers.join(' · ');
}

function branchFieldsFromLayers(
  locationId: string,
  locationName: string | null,
  layers: string[],
): ServiceUserBranchFields {
  const branchName = layers.length ? layers[layers.length - 1] : null;
  const zoneName = layers.length > 1 ? layers[0] : null;
  return {
    locationId,
    locationName,
    zoneName,
    branchName,
    branchLayers: layers,
    displayLabel: formatBranchLayerPath(layers),
  };
}

export async function loadBranchAreasForInference(prisma: PrismaService) {
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

export async function loadScheduleAreaByLocationMap(
  prisma: PrismaService,
): Promise<Map<string, ScheduleAreaBranchLookup>> {
  const areas = await prisma.scheduleArea.findMany({
    where: { deletedAt: null, isActive: true, locationId: { not: null } },
    select: {
      name: true,
      locationId: true,
      parentZoneName: true,
      location: { select: { name: true } },
      zone: { select: { name: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const map = new Map<string, ScheduleAreaBranchLookup>();
  for (const area of areas) {
    if (area.locationId && !map.has(area.locationId)) {
      map.set(area.locationId, area);
    }
  }
  return map;
}

export function resolveBranchFromLocation(
  locationId: string | null | undefined,
  locationName: string | null | undefined,
  scheduleAreaByLocation: Map<string, ScheduleAreaBranchLookup>,
): ServiceUserBranchFields {
  if (!locationId) {
    return {
      locationId: null,
      locationName: null,
      zoneName: null,
      branchName: null,
      branchLayers: [],
      displayLabel: '',
    };
  }

  const scheduleArea = scheduleAreaByLocation.get(locationId);
  const resolvedLocationName = locationName ?? scheduleArea?.location?.name ?? null;
  const layers = buildBranchDisplayLayers(scheduleArea, resolvedLocationName);
  return branchFieldsFromLayers(locationId, resolvedLocationName, layers);
}

export function resolveServiceUserBranch(
  su: {
    locationId: string | null;
    location?: { name: string } | null;
    assignments?: Array<{
      locationId: string | null;
      location?: { name: string } | null;
    }>;
  },
  scheduleAreaByLocation: Map<string, ScheduleAreaBranchLookup>,
): ServiceUserBranchFields {
  const assignment = su.assignments?.[0];
  const locationId = su.locationId ?? assignment?.locationId ?? null;
  const locationName = su.location?.name ?? assignment?.location?.name ?? null;
  return resolveBranchFromLocation(locationId, locationName, scheduleAreaByLocation);
}
