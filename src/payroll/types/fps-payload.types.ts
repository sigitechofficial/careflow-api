/** Care-owned FPS preview schema (not GovTalk XML — T16 maps this to HMRC). */

export type FpsHoursNormallyWorked = 'A' | 'B' | 'C' | 'D' | 'E'

export type FpsValidationSeverity = 'error' | 'warning'

export type FpsValidationItem = {
  severity: FpsValidationSeverity
  code: string
  scope: 'run' | 'employer' | 'submission' | 'employee'
  employeeId?: string
  employeeName?: string
  field?: string
  message: string
}

export type FpsValidationResult = {
  isReadyToSubmit: boolean
  errorCount: number
  warningCount: number
  items: FpsValidationItem[]
}

export type CareFpsPayload = {
  meta: {
    schemaVersion: 'care-fps-preview-1'
    generatedAt: string
    ukPayrollRunId: string
    runStatus: string
    taxYearCode: string
    purpose: 'PREVIEW'
  }
  employer: {
    hmrcOfficeNumber: string
    employerPayeReference: string
    fullPayeReference: string
    accountsOfficeReference: string
    employerTradingName: string | null
  }
  submission: {
    relatedTaxYear: string
    taxMonthOrWeekNumber: number
    payFrequency: string
    paymentDate: string
    periodStart: string
    periodEnd: string
  }
  employees: CareFpsEmployeeEntry[]
  totals: {
    employeeCount: number
    totalGross: number
    totalIncomeTax: number
    totalEmployeeNi: number
    totalEmployerNi: number
    totalNetPay: number
  }
  warnings: string[]
  /** T13 — structured RTI field checks before live submit. */
  validation: FpsValidationResult
}

export type CareFpsEmployeeEntry = {
  employeeId: string
  name: { forename: string; surname: string }
  birthDate: string | null
  gender: 'M' | 'F' | null
  nino: string | null
  payId: string | null
  address: {
    line1: string | null
    line2: string | null
    city: string | null
    county: string | null
    postcode: string | null
    country: string | null
  }
  employment: {
    taxCode: string | null
    week1Month1: boolean
    niCategory: string | null
    starterDeclaration: string | null
    hoursNormallyWorked: FpsHoursNormallyWorked | null
    startingDate: string | null
    leavingDate: string | null
    /** T05 — employment start falls in this pay period. */
    isStarterInPeriod: boolean
    /** T05 — employment leave falls in this pay period. */
    isLeaverInPeriod: boolean
    isFirstPayOfEmployment: boolean
    isLastPayOfEmployment: boolean
    /** Previous employer P45 received (starter statement may not apply). */
    p45Received: boolean
  }
  payment: {
    taxablePay: number
    taxDeductedOrRefunded: number
    employeeNiContribution: number
    employerNiContribution: number
    periodGross: number
    periodNetPay: number
    taxablePayYtd: number
    totalTaxYtd: number
    employeeNiYtd: number
    employerNiYtd: number
    grossPayYtd: number
    netPayYtd: number
  }
  issues: string[]
}
