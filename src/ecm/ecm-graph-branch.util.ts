import type { Prisma } from '@prisma/client';

export type GraphBranchRef = { id: string; name: string };

/**
 * Resolve a human-readable branch (schedule area) for graph comparison.
 * Prefer the job's schedule area; when missing (common on seed/migrated jobs),
 * map the service user's home location to a schedule area; else use the
 * location name; else "Unassigned area".
 */
export function resolveGraphBranch(input: {
  scheduleArea: { id: string; name: string } | null | undefined;
  serviceUserLocation: { id: string; name: string } | null | undefined;
  areaByLocationId: Map<string, { id: string; name: string }>;
}): GraphBranchRef {
  if (input.scheduleArea?.id) {
    return { id: input.scheduleArea.id, name: input.scheduleArea.name };
  }
  const locId = input.serviceUserLocation?.id;
  if (locId) {
    const mapped = input.areaByLocationId.get(locId);
    if (mapped) return { id: mapped.id, name: mapped.name };
    const locName = input.serviceUserLocation?.name?.trim();
    return {
      id: `loc:${locId}`,
      name: locName || 'Unassigned location',
    };
  }
  return { id: 'none', name: 'Unassigned area' };
}

/**
 * Filter jobs by schedule area, including null-area jobs whose service user
 * lives in that area's location (same fallback as location scope).
 */
export function scheduledJobScheduleAreaScope(
  scheduleAreaId: string,
  areaLocationId?: string | null,
): Prisma.ScheduledJobWhereInput {
  if (!areaLocationId) {
    return { scheduleAreaId };
  }
  return {
    OR: [
      { scheduleAreaId },
      { scheduleAreaId: null, serviceUser: { locationId: areaLocationId } },
    ],
  };
}
