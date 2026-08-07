/** Care-owned EPS preview schema (not GovTalk XML — T19 maps this to HMRC). */

export type CareEpsStatutoryRecoveries = {
  smpRecovered: number
  sppRecovered: number
  sapRecovered: number
  shppRecovered: number
  spbpRecovered: number
  /** NIC compensation on statutory pay (if claimed). */
  nicCompensationOnStatutory: number
}

export type CareEpsPayload = {
  meta: {
    schemaVersion: 'care-eps-preview-1'
    generatedAt: string
    purpose: 'PREVIEW'
  }
  employer: {
    hmrcOfficeNumber: string
    employerPayeReference: string
    fullPayeReference: string
    accountsOfficeReference: string
    employerTradingName: string | null
  }
  period: {
    taxYearCode: string
    relatedTaxYear: string
    taxMonth: number
    taxMonthStart: string
    taxMonthEnd: string
    /** Electronic EPS due date (19th of the calendar month of tax-month end). */
    electronicDeadline: string
    daysUntilDeadline: number | null
    deadlineStatus: 'OK' | 'DUE_SOON' | 'OVERDUE' | 'UNKNOWN'
  }
  indicators: {
    noPaymentThisPeriod: boolean
    employmentAllowanceClaimed: boolean
  }
  recoveries: CareEpsStatutoryRecoveries
  context: {
    closedRunsInTaxMonth: number
    employeesPaidInTaxMonth: number
    suggestedNilPayment: boolean
  }
  warnings: string[]
  validation: {
    isReadyToSubmit: boolean
    errorCount: number
    warningCount: number
    items: Array<{
      severity: 'error' | 'warning'
      code: string
      field?: string
      message: string
    }>
  }
}
