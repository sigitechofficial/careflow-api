/**
 * Idempotent: ensure every active employee has a READY UK payroll profile.
 * Invoked from prisma/scripts/run-deploy-seeds.sh on each production deploy (push to main).
 *
 * Defaults for new / incomplete profiles: taxCode 1257L, NI A, Week1/Month1.
 * Existing tax code / NI letter are preserved. SUSPENDED profiles are left alone.
 * Skips (exit 0) when no ACTIVE pay schedule exists yet.
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  const schedules = await prisma.payrollSchedule.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    orderBy: [{ frequency: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, code: true, status: true, frequency: true },
  })

  const preferred =
    schedules.find((s) => s.frequency === 'MONTHLY') ?? schedules[0] ?? null

  if (!preferred) {
    console.log(
      'SKIP setup-payroll-employees-ready: no ACTIVE pay schedule. Create one under /payroll/schedules, then redeploy or run this script manually.',
    )
    return
  }

  console.log('Using schedule:', preferred)

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true },
  })

  const profiles = await prisma.employeePayrollProfile.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      employeeId: true,
      status: true,
      taxCode: true,
      niCategory: true,
      scheduleId: true,
    },
  })

  const profileByEmployee = new Map(profiles.map((p) => [p.employeeId, p]))

  let created = 0
  let updated = 0
  let alreadyReady = 0
  let skippedSuspended = 0

  for (const emp of employees) {
    const existing = profileByEmployee.get(emp.id)

    if (existing?.status === 'SUSPENDED') {
      skippedSuspended += 1
      continue
    }

    if (existing?.status === 'READY' && existing.taxCode && existing.niCategory) {
      alreadyReady += 1
      if (!existing.scheduleId) {
        await prisma.employeePayrollProfile.update({
          where: { id: existing.id },
          data: { scheduleId: preferred.id },
        })
        updated += 1
        alreadyReady -= 1
      }
      continue
    }

    if (existing) {
      await prisma.employeePayrollProfile.update({
        where: { id: existing.id },
        data: {
          status: 'READY',
          taxCode: existing.taxCode?.trim() || '1257L',
          taxCodeWeek1Month1: true,
          niCategory: existing.niCategory ?? 'A',
          scheduleId: existing.scheduleId ?? preferred.id,
        },
      })
      updated += 1
    } else {
      await prisma.employeePayrollProfile.create({
        data: {
          id: randomUUID(),
          employeeId: emp.id,
          scheduleId: preferred.id,
          status: 'READY',
          taxCode: '1257L',
          taxCodeWeek1Month1: true,
          niCategory: 'A',
          starterDeclaration: 'UNKNOWN',
          deductionElections: [],
        },
      })
      created += 1
    }
  }

  const after = await prisma.employeePayrollProfile.groupBy({
    by: ['status'],
    where: { deletedAt: null },
    _count: true,
  })

  console.log(
    JSON.stringify(
      {
        employees: employees.length,
        created,
        updated,
        alreadyReady,
        skippedSuspended,
        scheduleId: preferred.id,
        statusCounts: after,
      },
      null,
      2,
    ),
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
