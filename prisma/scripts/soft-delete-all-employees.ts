/**
 * Soft-delete every active employee (and disable portal accounts).
 * Used by the allforcare production deploy so demo staff are cleared and not re-seeded.
 *
 *   npx ts-node --transpile-only prisma/scripts/soft-delete-all-employees.ts
 *
 * Requires DATABASE_URL (loaded from live .env during deploy).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const active = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      personalDetail: { select: { id: true, username: true, email: true } },
      portalAccount: { select: { id: true, email: true } },
    },
  });

  console.log(`[purge-employees] found ${active.length} active employee(s)`);
  if (active.length === 0) {
    console.log('[purge-employees] nothing to do');
    return;
  }

  let freed = 0;
  for (const emp of active) {
    const tag = `__deleted__${emp.id.slice(0, 8)}`;
    if (emp.personalDetail) {
      const nextUsername = emp.personalDetail.username
        ? `${emp.personalDetail.username}${tag}`.slice(0, 190)
        : null;
      const nextEmail = emp.personalDetail.email
        ? `${emp.personalDetail.email}${tag}`.slice(0, 190)
        : null;
      await prisma.employeePersonalDetail.update({
        where: { id: emp.personalDetail.id },
        data: {
          username: nextUsername,
          email: nextEmail,
          updatedAt: now,
        },
      });
      freed += 1;
    }
    if (emp.portalAccount) {
      await prisma.employeePortalAccount.update({
        where: { id: emp.portalAccount.id },
        data: {
          email: `${emp.portalAccount.email}${tag}`.slice(0, 190),
          isEnabled: false,
          refreshTokenHash: null,
          deletedAt: now,
        },
      });
    }
  }

  const result = await prisma.employee.updateMany({
    where: { deletedAt: null },
    data: {
      deletedAt: now,
      isActive: false,
    },
  });

  console.log(
    `[purge-employees] soft-deleted ${result.count} employee(s); freed ${freed} username/email row(s)`,
  );
}

main()
  .catch((err) => {
    console.error('[purge-employees] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
