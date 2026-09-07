/**
 * One-shot: ensure Super Admin has all permissions + create demo office users.
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-demo-office-users.ts
 */
import { PrismaClient } from '@prisma/client'
import {
  ensureSuperAdminAllPermissions,
  seedDemoOfficeUsers,
} from '../seeds/demo-office-users.seed'

const prisma = new PrismaClient()

async function main() {
  await seedDemoOfficeUsers(prisma)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
