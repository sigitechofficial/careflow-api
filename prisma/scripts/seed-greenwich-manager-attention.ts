/**
 * Idempotent Greenwich IA / care-plan / assessment manager-attention seed.
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-greenwich-manager-attention.ts
 */
import { PrismaClient } from '@prisma/client'
import { seedGreenwichManagerAttention } from '../seeds/greenwich-manager-attention.seed'
import { ensureHierarchyRoles } from '../seeds/demo-office-users.seed'

const prisma = new PrismaClient()

async function main() {
  await ensureHierarchyRoles(prisma)
  await seedGreenwichManagerAttention(prisma)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
