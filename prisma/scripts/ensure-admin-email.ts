/**
 * Ensure the allforcare admin user email exists (rename from the default seed email if needed).
 *
 *   ADMIN_EMAIL=suzzette@allforcare.co.uk \
 *   ADMIN_EMAIL_FROM=admin@careadmin.local \
 *   ADMIN_PASSWORD=Admin@12345 \
 *   npx ts-node --transpile-only prisma/scripts/ensure-admin-email.ts
 *
 * Requires DATABASE_URL.
 */
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NEW_EMAIL = (process.env.ADMIN_EMAIL ?? 'suzzette@allforcare.co.uk').trim().toLowerCase();
const OLD_EMAIL = (process.env.ADMIN_EMAIL_FROM ?? 'admin@careadmin.local').trim().toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD?.trim() || 'Admin@12345';

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const existingNew = await prisma.user.findFirst({
    where: { email: { equals: NEW_EMAIL, mode: 'insensitive' }, deletedAt: null },
  });
  if (existingNew) {
    await prisma.user.update({
      where: { id: existingNew.id },
      data: {
        email: NEW_EMAIL,
        passwordHash,
        isActive: true,
        deletedAt: null,
      },
    });
    console.log(`[ensure-admin-email] updated existing admin ${NEW_EMAIL}`);
    return;
  }

  const existingOld = await prisma.user.findFirst({
    where: { email: { equals: OLD_EMAIL, mode: 'insensitive' }, deletedAt: null },
  });
  if (existingOld) {
    await prisma.user.update({
      where: { id: existingOld.id },
      data: {
        email: NEW_EMAIL,
        passwordHash,
        isActive: true,
        deletedAt: null,
      },
    });
    console.log(`[ensure-admin-email] renamed ${OLD_EMAIL} → ${NEW_EMAIL}`);
    return;
  }

  const superAdminRole = await prisma.role.findFirst({
    where: { name: { equals: 'Super Admin', mode: 'insensitive' } },
  });

  const user = await prisma.user.create({
    data: {
      email: NEW_EMAIL,
      username: 'suzzette-admin',
      passwordHash,
      firstName: 'Suzzette',
      lastName: 'Admin',
      isActive: true,
    },
  });

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
      update: {},
      create: { userId: user.id, roleId: superAdminRole.id },
    });
  }

  console.log(`[ensure-admin-email] created admin ${NEW_EMAIL}`);
}

main()
  .catch((err) => {
    console.error('[ensure-admin-email] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
