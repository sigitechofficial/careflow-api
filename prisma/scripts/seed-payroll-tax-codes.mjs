/**
 * Idempotent seed of HMRC PAYE tax codes for employee payroll setup.
 * Invoked from prisma/scripts/run-deploy-seeds.sh on production deploy.
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

/** Mirrors care-admin/src/features/payroll/data/uk-payroll-lookups.ts UK_TAX_CODE_OPTIONS */
const TAX_CODES = [
  {
    code: '1257L',
    label: '1257L — Personal allowance (standard)',
    description: 'England / Northern Ireland — £12,570 free pay',
    group: 'STANDARD',
    sortOrder: 10,
  },
  {
    code: '1257M',
    label: '1257M — Marriage allowance received',
    description: 'Higher personal allowance from marriage transfer',
    group: 'STANDARD',
    sortOrder: 20,
  },
  {
    code: '1257N',
    label: '1257N — Marriage allowance transferred',
    description: 'Lower personal allowance after marriage transfer',
    group: 'STANDARD',
    sortOrder: 30,
  },
  {
    code: '1257T',
    label: '1257T — Other calculations apply',
    description: 'HMRC has other adjustments on this code',
    group: 'STANDARD',
    sortOrder: 40,
  },
  {
    code: '1250L',
    label: '1250L — Older personal allowance code',
    description: 'Legacy PA code still seen on some notices',
    group: 'STANDARD',
    sortOrder: 50,
  },
  {
    code: '1185L',
    label: '1185L — Reduced personal allowance',
    description: 'Lower free-pay code from HMRC notice',
    group: 'STANDARD',
    sortOrder: 60,
  },
  {
    code: '0T',
    label: '0T — No personal allowance',
    description: 'All pay taxable from £0 free pay',
    group: 'SPECIAL',
    sortOrder: 100,
  },
  {
    code: 'BR',
    label: 'BR — Basic rate on all taxable pay',
    description: '20% on all taxable pay (no free pay)',
    group: 'SPECIAL',
    sortOrder: 110,
  },
  {
    code: 'D0',
    label: 'D0 — Higher rate on all taxable pay',
    description: '40% on all taxable pay',
    group: 'SPECIAL',
    sortOrder: 120,
  },
  {
    code: 'D1',
    label: 'D1 — Additional rate on all taxable pay',
    description: '45% on all taxable pay',
    group: 'SPECIAL',
    sortOrder: 130,
  },
  {
    code: 'NT',
    label: 'NT — No tax to deduct',
    description: 'Do not deduct Income Tax',
    group: 'SPECIAL',
    sortOrder: 140,
  },
  {
    code: 'K497',
    label: 'K497 — Negative allowance (K code)',
    description: 'Example K code — replace with notice value if needed',
    group: 'SPECIAL',
    sortOrder: 150,
  },
  {
    code: 'S1257L',
    label: 'S1257L — Scottish personal allowance',
    description: 'Scotland PAYE code (S prefix)',
    group: 'SCOTLAND',
    sortOrder: 200,
  },
  {
    code: 'S0T',
    label: 'S0T — Scottish, no personal allowance',
    description: null,
    group: 'SCOTLAND',
    sortOrder: 210,
  },
  {
    code: 'SBR',
    label: 'SBR — Scottish basic rate on all',
    description: null,
    group: 'SCOTLAND',
    sortOrder: 220,
  },
  {
    code: 'SD0',
    label: 'SD0 — Scottish intermediate/higher path',
    description: null,
    group: 'SCOTLAND',
    sortOrder: 230,
  },
  {
    code: 'SD1',
    label: 'SD1 — Scottish higher path',
    description: null,
    group: 'SCOTLAND',
    sortOrder: 240,
  },
  {
    code: 'SD2',
    label: 'SD2 — Scottish top path',
    description: null,
    group: 'SCOTLAND',
    sortOrder: 250,
  },
  {
    code: 'C1257L',
    label: 'C1257L — Welsh personal allowance',
    description: 'Wales PAYE code (C prefix)',
    group: 'WALES',
    sortOrder: 300,
  },
  {
    code: 'C0T',
    label: 'C0T — Welsh, no personal allowance',
    description: null,
    group: 'WALES',
    sortOrder: 310,
  },
  {
    code: 'CBR',
    label: 'CBR — Welsh basic rate on all',
    description: null,
    group: 'WALES',
    sortOrder: 320,
  },
  {
    code: 'CD0',
    label: 'CD0 — Welsh higher rate on all',
    description: null,
    group: 'WALES',
    sortOrder: 330,
  },
  {
    code: 'CD1',
    label: 'CD1 — Welsh additional rate on all',
    description: null,
    group: 'WALES',
    sortOrder: 340,
  },
]

async function main() {
  let created = 0
  let updated = 0

  for (const item of TAX_CODES) {
    const existing = await prisma.payrollTaxCode.findFirst({
      where: { code: item.code },
    })

    if (existing) {
      if (existing.deletedAt) {
        await prisma.payrollTaxCode.update({
          where: { id: existing.id },
          data: {
            deletedAt: null,
            isActive: true,
            label: item.label,
            description: item.description,
            group: item.group,
            sortOrder: item.sortOrder,
          },
        })
        updated += 1
      } else {
        // Keep admin edits to label/description; only backfill sortOrder/group if missing defaults needed.
        // Upsert seed fields that define catalogue identity without wiping custom labels once set:
        // On first seed after create we already have label. Re-runs leave custom labels alone.
        updated += 0
      }
      continue
    }

    await prisma.payrollTaxCode.create({
      data: {
        id: randomUUID(),
        code: item.code,
        label: item.label,
        description: item.description,
        group: item.group,
        sortOrder: item.sortOrder,
        isActive: true,
      },
    })
    created += 1
  }

  const total = await prisma.payrollTaxCode.count({ where: { deletedAt: null } })
  console.log(
    JSON.stringify({ created, restored: updated, activeTaxCodes: total }, null, 2),
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
