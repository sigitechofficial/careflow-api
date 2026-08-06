import { Prisma } from '@prisma/client'

export type YtdPeriodAmounts = {
  grossPay: number
  taxablePay: number
  incomeTax: number
  employeeNi: number
  employerNi: number
  netPay: number
}

export type YtdLedgerSnapshot = {
  employeeId: string
  taxYearId: string
  grossPayYtd: number
  taxablePayYtd: number
  incomeTaxYtd: number
  employeeNiYtd: number
  employerNiYtd: number
  netPayYtd: number
  lastClosedRunId: string | null
  updatedAt: string
}

type Tx = Prisma.TransactionClient

const d = (n: number) => new Prisma.Decimal(n)
const n = (v: Prisma.Decimal | number | null | undefined) =>
  v == null ? 0 : typeof v === 'number' ? v : Number(v)

export function mapYtdLedger(row: {
  employeeId: string
  taxYearId: string
  grossPayYtd: Prisma.Decimal | number
  taxablePayYtd: Prisma.Decimal | number
  incomeTaxYtd: Prisma.Decimal | number
  employeeNiYtd: Prisma.Decimal | number
  employerNiYtd: Prisma.Decimal | number
  netPayYtd: Prisma.Decimal | number
  lastClosedRunId: string | null
  updatedAt: Date
}): YtdLedgerSnapshot {
  return {
    employeeId: row.employeeId,
    taxYearId: row.taxYearId,
    grossPayYtd: n(row.grossPayYtd),
    taxablePayYtd: n(row.taxablePayYtd),
    incomeTaxYtd: n(row.incomeTaxYtd),
    employeeNiYtd: n(row.employeeNiYtd),
    employerNiYtd: n(row.employerNiYtd),
    netPayYtd: n(row.netPayYtd),
    lastClosedRunId: row.lastClosedRunId,
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function getOrCreateLedger(
  tx: Tx,
  employeeId: string,
  taxYearId: string,
  userId: string,
) {
  const existing = await tx.employeePayrollYtdLedger.findUnique({
    where: { employeeId_taxYearId: { employeeId, taxYearId } },
  })
  if (existing) return existing
  return tx.employeePayrollYtdLedger.create({
    data: {
      employeeId,
      taxYearId,
      createdById: userId,
      updatedById: userId,
    },
  })
}

/** Post period amounts into YTD on run close (idempotent; re-posts after reverse). */
export async function postRunEmployeesToYtd(
  tx: Tx,
  args: {
    runId: string
    taxYearId: string
    userId: string
    employees: Array<{ employeeId: string } & YtdPeriodAmounts>
  },
): Promise<{ posted: number; skipped: number }> {
  let posted = 0
  let skipped = 0

  for (const emp of args.employees) {
    const existing = await tx.employeePayrollYtdContribution.findUnique({
      where: {
        ukPayrollRunId_employeeId: {
          ukPayrollRunId: args.runId,
          employeeId: emp.employeeId,
        },
      },
    })

    if (existing && !existing.isReversed) {
      skipped += 1
      continue
    }

    const ledger = await getOrCreateLedger(tx, emp.employeeId, args.taxYearId, args.userId)

    if (existing?.isReversed) {
      await tx.employeePayrollYtdContribution.update({
        where: { id: existing.id },
        data: {
          ledgerId: ledger.id,
          taxYearId: args.taxYearId,
          grossPay: d(emp.grossPay),
          taxablePay: d(emp.taxablePay),
          incomeTax: d(emp.incomeTax),
          employeeNi: d(emp.employeeNi),
          employerNi: d(emp.employerNi),
          netPay: d(emp.netPay),
          isReversed: false,
          postedAt: new Date(),
          reversedAt: null,
          reversedById: null,
          createdById: args.userId,
        },
      })
    } else {
      await tx.employeePayrollYtdContribution.create({
        data: {
          ledgerId: ledger.id,
          ukPayrollRunId: args.runId,
          employeeId: emp.employeeId,
          taxYearId: args.taxYearId,
          grossPay: d(emp.grossPay),
          taxablePay: d(emp.taxablePay),
          incomeTax: d(emp.incomeTax),
          employeeNi: d(emp.employeeNi),
          employerNi: d(emp.employerNi),
          netPay: d(emp.netPay),
          createdById: args.userId,
        },
      })
    }

    await tx.employeePayrollYtdLedger.update({
      where: { id: ledger.id },
      data: {
        grossPayYtd: { increment: emp.grossPay },
        taxablePayYtd: { increment: emp.taxablePay },
        incomeTaxYtd: { increment: emp.incomeTax },
        employeeNiYtd: { increment: emp.employeeNi },
        employerNiYtd: { increment: emp.employerNi },
        netPayYtd: { increment: emp.netPay },
        lastClosedRunId: args.runId,
        updatedById: args.userId,
      },
    })
    posted += 1
  }

  return { posted, skipped }
}

/** Reverse YTD posts when a closed run is reactivated. */
export async function reverseRunEmployeesFromYtd(
  tx: Tx,
  args: { runId: string; userId: string },
): Promise<{ reversed: number }> {
  const rows = await tx.employeePayrollYtdContribution.findMany({
    where: { ukPayrollRunId: args.runId, isReversed: false },
  })
  let reversed = 0

  for (const row of rows) {
    await tx.employeePayrollYtdLedger.update({
      where: { id: row.ledgerId },
      data: {
        grossPayYtd: { decrement: n(row.grossPay) },
        taxablePayYtd: { decrement: n(row.taxablePay) },
        incomeTaxYtd: { decrement: n(row.incomeTax) },
        employeeNiYtd: { decrement: n(row.employeeNi) },
        employerNiYtd: { decrement: n(row.employerNi) },
        netPayYtd: { decrement: n(row.netPay) },
        updatedById: args.userId,
      },
    })
    await tx.employeePayrollYtdContribution.update({
      where: { id: row.id },
      data: {
        isReversed: true,
        reversedAt: new Date(),
        reversedById: args.userId,
      },
    })
    reversed += 1
  }

  return { reversed }
}
