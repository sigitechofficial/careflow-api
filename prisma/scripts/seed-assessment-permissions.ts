import { PrismaClient } from '@prisma/client';

const PERMS = [
  'service_users.assessments.read',
  'service_users.assessments.create',
  'service_users.assessments.link',
] as const;

const ROLE_NAMES = ['Super Admin', 'Admin', 'Manager', 'Care Coordinator'] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const key of PERMS) {
      await prisma.permission.upsert({
        where: { key },
        update: { isActive: true, deletedAt: null },
        create: { key, isActive: true },
      });
      console.log(`[seed-assessment-perms] upserted ${key}`);
    }

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...PERMS] }, deletedAt: null },
    });

    for (const roleName of ROLE_NAMES) {
      const role = await prisma.role.findFirst({ where: { name: roleName, deletedAt: null } });
      if (!role) {
        console.warn(`[seed-assessment-perms] role not found: ${roleName}`);
        continue;
      }
      for (const p of permissions) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
          update: {},
          create: { roleId: role.id, permissionId: p.id },
        });
      }
      console.log(`[seed-assessment-perms] linked ${PERMS.length} permission(s) to ${roleName}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
