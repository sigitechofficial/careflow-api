import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const acceptedFormIds = [
  '2cd1c4a5-1b7b-4cc4-a7b7-0774c77800a9',
  'e2217497-8f48-4d64-a73b-79add7fb6dfb',
  '6e4e5c29-91b7-47d1-927b-9c18a0456201',
  '0056db35-e3b8-4dcd-8058-810901785581',
  '0610cf99-8290-4030-abf3-c606e96f672a',
]

const rows = await p.defaultFormSelection.findMany({
  where: { deletedAt: null, isActive: true, formType: 'CARE_PLAN' },
  include: { form: { select: { id: true, name: true } } },
})

const selectedIds = new Set(rows.map((r) => r.formId))
console.log('Form selection care plans:', rows.length)
for (const id of acceptedFormIds) {
  const inSel = selectedIds.has(id)
  const name = await p.carePathwayForm.findUnique({ where: { id }, select: { name: true } })
  console.log(inSel ? 'IN ' : 'OUT', name?.name, id.slice(0, 8))
}

await p.$disconnect()
