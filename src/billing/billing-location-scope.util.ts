import { PrismaService } from '../prisma/prisma.service';

/** Service-user ids at a branch — used to scope billing lists that join via serviceUserId. */
export async function serviceUserIdsForLocation(
  prisma: PrismaService,
  locationId: string,
): Promise<string[]> {
  const rows = await prisma.serviceUser.findMany({
    where: { deletedAt: null, locationId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Employee ids whose employment is linked to a branch (primary, base, or floor). */
export async function employeeIdsForLocation(
  prisma: PrismaService,
  locationId: string,
): Promise<string[]> {
  const rows = await prisma.employeeEmployment.findMany({
    where: {
      OR: [
        { locationId },
        { baseLocationId: locationId },
        { floorLocations: { some: { locationId } } },
      ],
    },
    select: { employeeId: true },
  });
  return [...new Set(rows.map((r) => r.employeeId))];
}
