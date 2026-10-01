import { PrismaService } from '../../src/prisma/prisma.service';

/** Seeded lookup IDs for the fields CreateServiceUserDto requires; spread into POST /service-users bodies. */
export async function requiredServiceUserFields(prisma: PrismaService) {
  const [status, title, gender, location] = await Promise.all([
    prisma.serviceUserStatus.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
    prisma.serviceUserTitle.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
    prisma.serviceUserGender.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
    prisma.location.findFirstOrThrow({ where: { isActive: true, deletedAt: null }, select: { id: true } }),
  ]);
  return {
    statusId: status.id,
    titleId: title.id,
    genderId: gender.id,
    locationId: location.id,
    dateOfBirth: '1950-01-01',
  };
}
