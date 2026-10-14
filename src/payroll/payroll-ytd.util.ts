import { Prisma } from '@prisma/client'

export type YtdPeriodAmounts = {
  grossPay: number
  taxablePay: number
  incomeTax: number
  employeeNi: number
  employerNi: number
  netPay: number
  /** Gate C11: student and postgraduate loan deducted (0 when none). */
  studentLoan?: number
  postgraduateLoan?: number
  /** Gate C10: NI data for RTI; null figures when the run row has none (legacy). */
  ni?: {
    category: string | null
    directorNicMethod: string | null
    niableEarnings: number | null
    atLel: number | null
    lelToPt: number | null
    ptToUel: number | null
  }
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
  studentLoanYtd: number
  postgraduateLoanYtd: number
  lastClosedRunId: string | null
  updatedAt: string
}

type Tx = Prisma.TransactionClient

const d = (n: number) => new Prisma.Decimal(n)
const dOrNull = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v))
const niColumns = (emp: YtdPeriodAmounts) => ({
  niCategory: emp.ni?.category ?? null,
  directorNicMethod: emp.ni?.directorNicMethod ?? null,
  niableEarnings: dOrNull(emp.ni?.niableEarnings),
  niEarningsAtLel: dOrNull(emp.ni?.atLel),
  niEarningsLelToPt: dOrNull(emp.ni?.lelToPt),
  niEarningsPtToUel: dOrNull(emp.ni?.ptToUel),
})
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
  studentLoanYtd?: Prisma.Decimal | number
  postgraduateLoanYtd?: Prisma.Decimal | number
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
    studentLoanYtd: n(row.studentLoanYtd),
    postgraduateLoanYtd: n(row.postgraduateLoanYtd),
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
          ...niColumns(emp),
          studentLoan: d(emp.studentLoan ?? 0),
          postgraduateLoan: d(emp.postgraduateLoan ?? 0),
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
          ...niColumns(emp),
          studentLoan: d(emp.studentLoan ?? 0),
          postgraduateLoan: d(emp.postgraduateLoan ?? 0),
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
        studentLoanYtd: { increment: emp.studentLoan ?? 0 },
        postgraduateLoanYtd: { increment: emp.postgraduateLoan ?? 0 },
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
        studentLoanYtd: { decrement: n(row.studentLoan) },
        postgraduateLoanYtd: { decrement: n(row.postgraduateLoan) },
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

export type NiYtdByCategory = {
  niCategory: string
  directorNicMethod: string | null
  niableEarningsYtd: number
  atLelYtd: number
  lelToPtYtd: number
  ptToUelYtd: number
  employeeNiYtd: number
  employerNiYtd: number
}

/**
 * Gate C10: NI year to date for RTI, per NI category (and director method), summed from the
 * contributions not reversed. A category change keeps the earlier category's figures; a
 * director's earnings period is kept apart from earlier ordinary earnings. Runs closed without NI
 * data (before C10) are listed, not guessed: their year needs reconstructing before an FPS.
 */
export async function niYtdByCategory(
  db: Pick<Prisma.TransactionClient, 'employeePayrollYtdContribution'>,
  employeeId: string,
  taxYearId: string,
): Promise<{ categories: NiYtdByCategory[]; runsWithoutNiData: string[] }> {
  const rows = await db.employeePayrollYtdContribution.findMany({
    where: { employeeId, taxYearId, isReversed: false },
    orderBy: { postedAt: 'asc' },
  })
  const categories = new Map<string, NiYtdByCategory>()
  const runsWithoutNiData: string[] = []
  for (const row of rows) {
    if (row.niableEarnings == null || !row.niCategory) {
      runsWithoutNiData.push(row.ukPayrollRunId)
      continue
    }
    const key = `${row.niCategory}|${row.directorNicMethod ?? ''}`
    const sum = categories.get(key) ?? {
      niCategory: row.niCategory,
      directorNicMethod: row.directorNicMethod,
      niableEarningsYtd: 0,
      atLelYtd: 0,
      lelToPtYtd: 0,
      ptToUelYtd: 0,
      employeeNiYtd: 0,
      employerNiYtd: 0,
    }
    const add = (a: number, b: Prisma.Decimal | null) => Math.round((a + n(b)) * 100) / 100
    sum.niableEarningsYtd = add(sum.niableEarningsYtd, row.niableEarnings)
    sum.atLelYtd = add(sum.atLelYtd, row.niEarningsAtLel)
    sum.lelToPtYtd = add(sum.lelToPtYtd, row.niEarningsLelToPt)
    sum.ptToUelYtd = add(sum.ptToUelYtd, row.niEarningsPtToUel)
    sum.employeeNiYtd = add(sum.employeeNiYtd, row.employeeNi)
    sum.employerNiYtd = add(sum.employerNiYtd, row.employerNi)
    categories.set(key, sum)
  }
  return { categories: [...categories.values()], runsWithoutNiData }
}
