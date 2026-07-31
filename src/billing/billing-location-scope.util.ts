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
