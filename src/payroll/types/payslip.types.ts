/** Care statutory payslip snapshot (ERA 1996 s.8 — first slice). */

export type PayslipMoneyLine = {
  label: string
  amount: number
  /** When true, amount reduces net (shown under deductions). */
  isDeduction: boolean
}

export type PayslipYtdSnapshot = {
  grossPayYtd: number
  taxablePayYtd: number
  incomeTaxYtd: number
  employeeNiYtd: number
  employerNiYtd: number
  netPayYtd: number
  /** Loan/pension completion: to date from the YTD ledger (absent on older snapshots). */
  studentLoanYtd?: number
  postgraduateLoanYtd?: number
  pensionEmployeeNetYtd?: number
  pensionEmployeeGrossYtd?: number
  pensionEmployerYtd?: number
}

export type CarePayslipData = {
  meta: {
    schemaVersion: 'care-payslip-1'
    generatedAt: string
    ukPayrollRunId: string
    runEmployeeId: string
    purpose: 'ITEMISED_PAY_STATEMENT'
  }
  employer: {
    name: string
    fullPayeReference: string | null
    accountsOfficeReference: string | null
  }
  employee: {
    employeeId: string
    displayName: string
    payrollNumber: string | null
    nationalInsuranceNo: string | null
    taxCode: string | null
    niCategory: string | null
  }
  period: {
    taxYearCode: string
    taxYearLabel: string
    scheduleName: string
    frequency: string
    /** Human label e.g. "April 2026" or "P1 …" */
    periodLabel: string
    /** e.g. "Monthly · April 2026 (01/04/2026 – 30/04/2026)" */
    periodCaption: string
    frequencyLabel: string
    periodStart: string
    periodEnd: string
    paymentDate: string
  }
  earnings: PayslipMoneyLine[]
  deductions: PayslipMoneyLine[]
  /** Informational — not deducted from employee net. */
  employerCosts: PayslipMoneyLine[]
  /**
   * Gate C19: workplace pension figures for information (employer contribution, gross employee
   * contribution, provider basic-rate relief). Not deducted: the employee's net contribution is the
   * deduction line.
   */
  pensionInformation: PayslipMoneyLine[]
  /**
   * Gate C19: the stored net pay checked against the stored figures (gross less PAYE, employee NI,
   * student loan, postgraduate loan and the pension deduction). ok false: do not issue the payslip.
   */
  reconciliation: { ok: boolean; expectedNetPay: number; storedNetPay: number }
  totals: {
    grossPay: number
    totalDeductions: number
    netPay: number
    expenseTotal: number
    /** Mileage and expenses reimbursed with this payment (not wages). */
    reimbursement: number
    /** Part of the expenses whose tax treatment has not been verified. */
    expenseNotVerified: number
    /** Net pay plus reimbursement: what the employee is paid for this run. */
    totalPayable: number
  }
  /** ERA 2019 hours rule — only when pay varies by time worked. */
  hoursWorked: {
    required: boolean
    totalHours: number | null
    source: 'INPUT_LINE_MINUTES' | 'NONE'
  }
  payment: {
    netPay: number
    methodLabel: string
    /** Bank disbursement via Employee payouts — separate from statutory calculation. */
    bankStatus: 'CALCULATED' | 'APPROVED' | 'PAID'
    bankStatusLabel: string
    paidAt: string | null
  }
  ytd: PayslipYtdSnapshot | null
  notes: string[]
}
