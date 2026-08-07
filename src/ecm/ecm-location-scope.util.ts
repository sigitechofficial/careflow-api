import type { Prisma } from '@prisma/client';

/**
 * Scope scheduled jobs to an organisation location.
 * Prefer schedule-area location; fall back to the service user's home location
 * when jobs were created without a schedule area (common in seed / migrated data).
 */
export function scheduledJobLocationScope(
  locationId: string,
): Prisma.ScheduledJobWhereInput {
  return {
    OR: [
      { scheduleArea: { locationId } },
      { serviceUser: { locationId } },
    ],
  };
}
