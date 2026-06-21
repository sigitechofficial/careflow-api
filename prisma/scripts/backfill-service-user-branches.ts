/**
 * Sync and infer zone/branch links for all service users.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/backfill-service-user-branches.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  inferBranchFromAddress,
  loadBranchAreasForInference,
  pickDefaultBranchForIndex,
} from '../../src/location-management/service-user-branch.util';

const prisma = new PrismaClient();

async function reconcileServiceUserBranchLinks(serviceUserId: string): Promise<boolean> {
  const su = await prisma.serviceUser.findFirst({
    where: { id: serviceUserId, deletedAt: null },
    include: {
      assignments: {
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!su) return false;

  const assignment = su.assignments[0] ?? null;
  const assignmentLocationId = assignment?.locationId ?? null;

  if (!su.locationId && assignmentLocationId) {
    await prisma.serviceUser.update({
      where: { id: serviceUserId },
      data: { locationId: assignmentLocationId },
    });
    return true;
  }

  if (su.locationId && assignment && assignmentLocationId !== su.locationId) {
    await prisma.serviceUserAssignment.update({
      where: { id: assignment.id },
      data: { locationId: su.locationId },
    });
    return true;
  }

  if (su.locationId && !assignment) {
    await prisma.serviceUserAssignment.create({
      data: {
        serviceUserId,
        locationId: su.locationId,
        keyWorkerId: su.keyWorkerId,
        namedNurseId: su.namedNurseId,
      },
    });
    return true;
  }

  return false;
}

async function assignBranch(serviceUserId: string, locationId: string, label: string): Promise<void> {
  await prisma.serviceUser.update({
    where: { id: serviceUserId },
    data: { locationId },
  });
  const assignment = await prisma.serviceUserAssignment.findFirst({
    where: { serviceUserId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });
  if (assignment) {
    await prisma.serviceUserAssignment.update({
      where: { id: assignment.id },
      data: { locationId },
    });
  } else {
    const su = await prisma.serviceUser.findUnique({ where: { id: serviceUserId } });
    await prisma.serviceUserAssignment.create({
      data: {
        serviceUserId,
        locationId,
        keyWorkerId: su?.keyWorkerId ?? null,
        namedNurseId: su?.namedNurseId ?? null,
      },
    });
  }
  console.log(label);
}

async function main() {
  const branchAreas = await loadBranchAreasForInference(prisma);
  const users = await prisma.serviceUser.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      locationId: true,
      address: { select: { town: true, postcode: true, county: true } },
      assignments: {
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true, locationId: true },
      },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  let synced = 0;
  let inferred = 0;
  let defaulted = 0;
  let defaultIndex = 0;

  for (const su of users) {
    const assignment = su.assignments[0] ?? null;
    const needsSync =
      (!su.locationId && assignment?.locationId) ||
      (su.locationId && assignment && assignment.locationId !== su.locationId) ||
      (su.locationId && !assignment);

    if (needsSync) {
      const ok = await reconcileServiceUserBranchLinks(su.id);
      if (ok) {
        synced += 1;
        console.log(`Synced link: ${su.firstName} ${su.lastName}`);
      }
      continue;
    }

    if (!su.locationId) {
      const inferredMatch = inferBranchFromAddress(su.address, branchAreas);
      const match = inferredMatch ?? pickDefaultBranchForIndex(branchAreas, defaultIndex);
      if (!match) continue;

      if (inferredMatch) {
        inferred += 1;
      } else {
        defaultIndex += 1;
        defaulted += 1;
      }

      await assignBranch(
        su.id,
        match.locationId,
        `${inferredMatch ? 'Inferred' : 'Default'}: ${su.firstName} ${su.lastName} -> ${match.zoneName} / ${match.branchLabel}`,
      );
    }
  }

  const linked = await prisma.serviceUser.count({
    where: { deletedAt: null, locationId: { not: null } },
  });

  console.log('');
  console.log(`Scanned ${users.length} service users`);
  console.log(`Synced ${synced} existing link${synced === 1 ? '' : 's'}`);
  console.log(`Inferred ${inferred} from address`);
  console.log(`Defaulted ${defaulted} to operational branches`);
  console.log(`${linked} now have a branch assigned, ${users.length - linked} still unassigned`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
