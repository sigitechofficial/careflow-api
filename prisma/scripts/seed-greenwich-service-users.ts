/**
 * Idempotent Greenwich council in-service service users.
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-greenwich-service-users.ts
 */
import { PrismaClient } from '@prisma/client'
import { seedGreenwichServiceUsers } from '../seeds/greenwich-service-users.seed'

const prisma = new PrismaClient()

async function main() {
  await seedGreenwichServiceUsers(prisma)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
