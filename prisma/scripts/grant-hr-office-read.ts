/**
 * Grant HR role read access needed for office branch work.
 * Usage: npx ts-node --transpile-only prisma/scripts/grant-hr-office-read.ts
 */
import { PrismaClient } from '@prisma/client'

const KEYS = [
  'employees.read',
  'employees.documents.read',
  'employees.compliance.read',
  'service_users.read',
  'service_users.lookups.read',
  'lookups.read',
]

const prisma = new PrismaClient()

async function main() {
  const hr = await prisma.role.findFirst({ where: { name: 'HR', deletedAt: null } })
  if (!hr) throw new Error('HR role not found')
  const perms = await prisma.permission.findMany({
    where: { key: { in: KEYS }, deletedAt: null },
  })
  for (const p of perms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: hr.id, permissionId: p.id } },
      update: {},
      create: { roleId: hr.id, permissionId: p.id },
    })
  }
  console.log('Granted to HR:', perms.map((p) => p.key).join(', '))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
