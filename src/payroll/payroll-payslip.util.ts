import type { CarePayslipData, PayslipMoneyLine, PayslipYtdSnapshot } from './types/payslip.types'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function moneyLine(label: string, amount: number, isDeduction = false): PayslipMoneyLine | null {
  const a = round2(amount)
  if (a === 0) return null
  return { label, amount: a, isDeduction }
}

/** Format ISO date (YYYY-MM-DD) as UK DD/MM/YYYY. */
export function formatUkPayslipDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '-'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  if (!m) return isoDate
  return `${m[3]}/${m[2]}/${m[1]}`
}

export function payFrequencyLabel(frequency: string): string {
  switch (frequency) {
    case 'MONTHLY':
      return 'Monthly'
    case 'WEEKLY':
      return 'Weekly'
    case 'FORTNIGHTLY':
      return 'Fortnightly'
    case 'FOUR_WEEKLY':
      return 'Four-weekly'
    default:
      return frequency || 'Pay period'
  }
}

/**
 * Clear month/week identity for list + PDF.
 * ASCII-only separators so Helvetica PDF never shows "?".
 * e.g. "Monthly - April 2026 (01/04/2026 - 30/04/2026)"
 */
export function buildPayslipPeriodCaption(input: {
  frequency: string
  periodLabel: string
  periodStart: string
  periodEnd: string
}): string {
  const freq = payFrequencyLabel(input.frequency)
  const start = formatUkPayslipDate(input.periodStart)
  const end = formatUkPayslipDate(input.periodEnd)
  const range = `${start} - ${end}`
  let title = (input.periodLabel || '').trim()

  // Weekly generator labels: "P1 2026-04-06 - 2026-04-12" -> "Period 1"
  const weekMatch = /^P(\d+)\s+\d{4}-\d{2}-\d{2}/i.exec(title)
  if (weekMatch) {
    title = `Period ${weekMatch[1]}`
  } else {
    title = title
      .replace(/\s+\d{4}-\d{2}-\d{2}\s*[\u2013\u2014\-]\s*\d{4}-\d{2}-\d{2}\s*$/i, '')
      .trim()
  }

  if (!title) return `${freq} - ${range}`
  if (title.includes(start) || title.includes(end)) return `${freq} - ${title}`
  return `${freq} - ${title} (${range})`
}

export type BuildCarePayslipInput = {
  generatedAt?: string
  run: {
    id: string
    status: string
  }
  runEmployee: {
    id: string
    employeeId: string
    visitPay: number
    salaryPay: number
    travelPay: number
    nmwTopUp: number
    otherPay: number
    expenseTotal: number
    /** Reimbursements paid with this run's net pay (0 on runs from before they were). */
    reimbursementPayable?: number
    /** Part of the expenses whose tax treatment has not been verified. */
    expenseNotVerified?: number
    deductionTotal: number
    totalGross: number
    taxablePay: number
    incomeTax: number
    employeeNi: number
    employerNi: number
    netPay: number
    taxCodeApplied: string | null
    niCategoryApplied: string | null
  }
  employee: {
    displayName: string
    payrollNumber: string | null
    nationalInsuranceNo: string | null
  }
  employer: {
    employerTradingName: string | null
    fullPayeReference: string | null
    accountsOfficeReference: string | null
  }
  period: {
    taxYearCode: string
    taxYearLabel: string
    scheduleName: string
    frequency: string
    periodLabel: string
    periodStart: string
    periodEnd: string
    paymentDate: string
  }
  /** Paid minutes from non-expense input lines (visit/time). */
  paidMinutes: number
  ytd: PayslipYtdSnapshot | null
  /**
   * Bank disbursement status from Employee payouts (optional).
   * Payslip amounts always come from the CLOSED run; this only labels payment state.
   */
  bankPayment?: {
    lineStatus?: string | null
    batchStatus?: string | null
    paidAt?: string | null
  } | null
}

export type PayslipBankPaymentStatus = 'CALCULATED' | 'APPROVED' | 'PAID'

/** Map Employee payouts batch/line state onto a clear payslip payment label. */
export function resolvePayslipBankPayment(input?: {
  lineStatus?: string | null
  batchStatus?: string | null
  paidAt?: string | null
} | null): {
  bankStatus: PayslipBankPaymentStatus
  bankStatusLabel: string
  paidAt: string | null
  note: string
} {
  const line = (input?.lineStatus ?? '').toUpperCase()
  const batch = (input?.batchStatus ?? '').toUpperCase()
  const paidAt = input?.paidAt?.trim() || null

  if (line === 'PAID' || batch === 'PAID') {
    return {
      bankStatus: 'PAID',
      bankStatusLabel: paidAt
        ? `Paid (${formatUkPayslipDate(paidAt.slice(0, 10))})`
        : 'Paid',
      paidAt,
      note: 'Bank payment recorded on Employee payouts.',
    }
  }

  if (batch === 'APPROVED') {
    return {
      bankStatus: 'APPROVED',
      bankStatusLabel: 'Approved — awaiting bank payment',
      paidAt: null,
      note: 'Payout approved but not yet marked paid. Net pay below is calculated, not disbursed.',
    }
  }

  return {
    bankStatus: 'CALCULATED',
    bankStatusLabel: 'Calculated — not yet paid',
    paidAt: null,
    note: 'This statement shows calculated pay after tax/NI. Mark the Employee payout as paid when bank transfer is complete.',
  }
}

/** Sum paid hours from input-line minutes for ERA variable-hours disclosure. */
export function hoursFromPaidMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return round2(minutes / 60)
}

/**
 * Build a Care payslip snapshot from a CLOSED run employee row.
 * Does not invent loans/pension amounts - notes when those engines are pending.
 */
export function buildCarePayslipData(input: BuildCarePayslipInput): CarePayslipData {
  if (input.run.status !== 'CLOSED') {
    throw new Error('Payslips are only available for CLOSED UK payroll runs')
  }

  const re = input.runEmployee
  const earnings: PayslipMoneyLine[] = [
    moneyLine('Visit pay', re.visitPay),
    moneyLine('Salary', re.salaryPay),
    moneyLine('Travel pay', re.travelPay),
    moneyLine('NMW top-up', re.nmwTopUp),
    moneyLine('Other pay', re.otherPay),
  ].filter((l): l is PayslipMoneyLine => l != null)

  if (earnings.length === 0 && re.totalGross > 0) {
    earnings.push({ label: 'Gross pay', amount: round2(re.totalGross), isDeduction: false })
  }

  const deductions: PayslipMoneyLine[] = [
    moneyLine('Income Tax (PAYE)', re.incomeTax, true),
    moneyLine('National Insurance (employee)', re.employeeNi, true),
    moneyLine('Other deductions', re.deductionTotal, true),
  ].filter((l): l is PayslipMoneyLine => l != null)

  const employerCosts: PayslipMoneyLine[] = [
    moneyLine('National Insurance (employer)', re.employerNi, false),
  ].filter((l): l is PayslipMoneyLine => l != null)

  const totalDeductions = round2(deductions.reduce((s, d) => s + d.amount, 0))
  const paidHours = hoursFromPaidMinutes(input.paidMinutes)
  const timeVaryingGross = round2(re.visitPay + re.travelPay + re.nmwTopUp + re.otherPay)
  const hoursRequired = timeVaryingGross > 0 && paidHours > 0

  const notes: string[] = [
    'Itemised pay statement under Employment Rights Act 1996 s.8.',
    'Student loan, postgraduate loan, and workplace pension deductions are not calculated in Care yet - they will not appear until those engines ship.',
  ]
  const reimbursement = round2(re.reimbursementPayable ?? 0)
  if (reimbursement > 0) {
    notes.push(
      `Mileage and expenses of GBP ${reimbursement.toFixed(2)} are reimbursed with this payment. They are not wages and are not part of gross taxable pay; total payable is GBP ${round2(re.netPay + reimbursement).toFixed(2)}.`,
    )
  } else if (re.expenseTotal > 0) {
    notes.push(
      `Expenses of GBP ${round2(re.expenseTotal).toFixed(2)} are tracked separately and are not included in gross taxable pay on this statement.`,
    )
  }
  if ((re.expenseNotVerified ?? 0) > 0) {
    notes.push(
      `The tax treatment of GBP ${round2(re.expenseNotVerified ?? 0).toFixed(2)} of mileage has not been verified against HMRC approved amounts for the period.`,
    )
  }
  if (timeVaryingGross > 0 && paidHours <= 0) {
    notes.push(
      'Some pay may vary by time worked, but paid hours were not recorded on input lines for this period.',
    )
  }

  const bank = resolvePayslipBankPayment(input.bankPayment)
  notes.push(bank.note)

  const employerName =
    input.employer.employerTradingName?.trim() ||
    'Employer (set trading name under Payroll -> Employer PAYE)'

  return {
    meta: {
      schemaVersion: 'care-payslip-1',
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      ukPayrollRunId: input.run.id,
      runEmployeeId: re.id,
      purpose: 'ITEMISED_PAY_STATEMENT',
    },
    employer: {
      name: employerName,
      fullPayeReference: input.employer.fullPayeReference,
      accountsOfficeReference: input.employer.accountsOfficeReference,
    },
    employee: {
      employeeId: re.employeeId,
      displayName: input.employee.displayName,
      payrollNumber: input.employee.payrollNumber,
      nationalInsuranceNo: input.employee.nationalInsuranceNo,
      taxCode: re.taxCodeApplied,
      niCategory: re.niCategoryApplied,
    },
    period: {
      ...input.period,
      frequencyLabel: payFrequencyLabel(input.period.frequency),
      periodCaption: buildPayslipPeriodCaption(input.period),
    },
    earnings,
    deductions,
    employerCosts,
    totals: {
      grossPay: round2(re.totalGross),
      totalDeductions,
      netPay: round2(re.netPay),
      expenseTotal: round2(re.expenseTotal),
      reimbursement,
      expenseNotVerified: round2(re.expenseNotVerified ?? 0),
      totalPayable: round2(re.netPay + reimbursement),
    },
    hoursWorked: {
      required: hoursRequired,
      totalHours: hoursRequired ? paidHours : paidHours > 0 ? paidHours : null,
      source: paidHours > 0 ? 'INPUT_LINE_MINUTES' : 'NONE',
    },
    payment: {
      netPay: round2(re.netPay),
      methodLabel: 'Bank transfer',
      bankStatus: bank.bankStatus,
      bankStatusLabel: bank.bankStatusLabel,
      paidAt: bank.paidAt,
    },
    ytd: input.ytd
      ? {
          grossPayYtd: round2(input.ytd.grossPayYtd),
          taxablePayYtd: round2(input.ytd.taxablePayYtd),
          incomeTaxYtd: round2(input.ytd.incomeTaxYtd),
          employeeNiYtd: round2(input.ytd.employeeNiYtd),
          employerNiYtd: round2(input.ytd.employerNiYtd),
          netPayYtd: round2(input.ytd.netPayYtd),
        }
      : null,
    notes,
  }
}

export function payslipPdfFilename(data: CarePayslipData): string {
  const payDate = data.period.paymentDate.replace(/-/g, '')
  const slug = data.employee.displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const id = data.meta.runEmployeeId.slice(0, 8)
  return `payslip-${slug || 'employee'}-${payDate}-${id}.pdf`
}
