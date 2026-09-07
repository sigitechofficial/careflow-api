/**
 * Idempotent Greenwich council branch staff (User + Employee + UserLocation).
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-greenwich-branch-users.ts
 */
import { PrismaClient } from '@prisma/client'
import { seedGreenwichBranchUsers } from '../seeds/greenwich-branch-users.seed'

const prisma = new PrismaClient()

async function main() {
  await seedGreenwichBranchUsers(prisma)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
