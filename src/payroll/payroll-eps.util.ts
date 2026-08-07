import type { CareEpsPayload, CareEpsStatutoryRecoveries } from './types/eps-payload.types'

export type EpsBuilderEmployer = {
  hmrcOfficeNumber: string | null
  employerPayeReference: string | null
  accountsOfficeReference: string | null
  employerTradingName: string | null
  fullPayeReference: string | null
  isComplete: boolean
  employmentAllowanceClaimed?: boolean
}

export type EpsBuilderContext = {
  closedRunsInTaxMonth: number
  employeesPaidInTaxMonth: number
}

function relatedTaxYearCode(taxYearCode: string): string {
  const m = taxYearCode.match(/(\d{2})(\d{2})[-/](\d{2})/)
  if (m) return `${m[2]}-${m[3]}`
  return taxYearCode
}

function parseTaxYearStartYear(taxYearCode: string): number | null {
  const m = taxYearCode.match(/^(\d{4})/)
  if (!m) return null
  return Number(m[1])
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDate(y: number, month1to12: number, day: number): string {
  return `${y}-${pad2(month1to12)}-${pad2(day)}`
}

/**
 * UK PAYE tax month boundaries (tax year starting 6 Apr).
 * Month 1: 6 Apr – 5 May … Month 12: 6 Mar – 5 Apr (next calendar year).
 */
export function ukTaxMonthBounds(taxYearStartYear: number, taxMonth: number): {
  start: string
  end: string
} {
  if (!Number.isInteger(taxMonth) || taxMonth < 1 || taxMonth > 12) {
    throw new Error('taxMonth must be 1–12')
  }
  // Start: 6th of (April + taxMonth - 1)
  const startMonthIndex = 3 + (taxMonth - 1) // 0=Jan … April=3
  const startYear = taxYearStartYear + Math.floor(startMonthIndex / 12)
  const startMonth = (startMonthIndex % 12) + 1
  // End: 5th of next calendar month after start month
  const endMonthIndex = startMonthIndex + 1
  const endYear = taxYearStartYear + Math.floor(endMonthIndex / 12)
  const endMonth = (endMonthIndex % 12) + 1
  return {
    start: isoDate(startYear, startMonth, 6),
    end: isoDate(endYear, endMonth, 5),
  }
}

/** Electronic EPS due: 19th of the calendar month that contains the tax-month end date. */
export function epsElectronicDeadline(taxYearStartYear: number, taxMonth: number): string {
  const { end } = ukTaxMonthBounds(taxYearStartYear, taxMonth)
  const [y, m] = end.split('-').map(Number)
  return isoDate(y, m, 19)
}

export function epsDeadlineStatus(
  deadlineIso: string,
  todayIso?: string,
): {
  daysUntilDeadline: number
  deadlineStatus: CareEpsPayload['period']['deadlineStatus']
} {
  const today = todayIso ?? new Date().toISOString().slice(0, 10)
  const t0 = Date.parse(`${today}T00:00:00Z`)
  const t1 = Date.parse(`${deadlineIso}T00:00:00Z`)
  if (Number.isNaN(t0) || Number.isNaN(t1)) {
    return { daysUntilDeadline: 0, deadlineStatus: 'UNKNOWN' }
  }
  const days = Math.round((t1 - t0) / 86_400_000)
  if (days < 0) return { daysUntilDeadline: days, deadlineStatus: 'OVERDUE' }
  if (days <= 7) return { daysUntilDeadline: days, deadlineStatus: 'DUE_SOON' }
  return { daysUntilDeadline: days, deadlineStatus: 'OK' }
}

function money(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

const EMPTY_RECOVERIES: CareEpsStatutoryRecoveries = {
  smpRecovered: 0,
  sppRecovered: 0,
  sapRecovered: 0,
  shppRecovered: 0,
  spbpRecovered: 0,
  nicCompensationOnStatutory: 0,
}

export function buildCareEpsPayload(input: {
  taxYearCode: string
  taxMonth: number
  employer: EpsBuilderEmployer
  noPaymentThisPeriod?: boolean
  employmentAllowanceClaimed?: boolean
  recoveries?: Partial<CareEpsStatutoryRecoveries>
  context?: EpsBuilderContext
  generatedAt?: Date
  todayIso?: string
}): CareEpsPayload {
  const warnings: string[] = []
  const startYear = parseTaxYearStartYear(input.taxYearCode)
  if (startYear == null) {
    throw new Error('taxYearCode must start with a 4-digit year (e.g. 2026-27)')
  }
  if (!Number.isInteger(input.taxMonth) || input.taxMonth < 1 || input.taxMonth > 12) {
    throw new Error('taxMonth must be an integer from 1 to 12')
  }

  const bounds = ukTaxMonthBounds(startYear, input.taxMonth)
  const deadline = epsElectronicDeadline(startYear, input.taxMonth)
  const { daysUntilDeadline, deadlineStatus } = epsDeadlineStatus(deadline, input.todayIso)

  const closedRuns = input.context?.closedRunsInTaxMonth ?? 0
  const employeesPaid = input.context?.employeesPaidInTaxMonth ?? 0
  const suggestedNil = closedRuns === 0 || employeesPaid === 0
  const noPayment =
    input.noPaymentThisPeriod !== undefined ? Boolean(input.noPaymentThisPeriod) : suggestedNil

  if (!input.employer.isComplete) {
    warnings.push(
      'Employer PAYE settings incomplete — set office number, PAYE reference, and Accounts Office reference',
    )
  }
  if (noPayment && employeesPaid > 0) {
    warnings.push(
      'Nil-payment is marked, but closed runs in this tax month show employees were paid — check this carefully',
    )
  }
  if (!noPayment && employeesPaid === 0) {
    warnings.push(
      'No employees found as paid in closed runs for this tax month — consider marking nil payment',
    )
  }
  if (deadlineStatus === 'OVERDUE') {
    warnings.push(`Electronic EPS deadline ${deadline} has passed`)
  } else if (deadlineStatus === 'DUE_SOON') {
    warnings.push(`Electronic EPS deadline ${deadline} is within 7 days`)
  }

  const recoveries: CareEpsStatutoryRecoveries = {
    ...EMPTY_RECOVERIES,
    ...Object.fromEntries(
      Object.entries(input.recoveries ?? {}).map(([k, v]) => [k, money(v as number)]),
    ),
  }

  const eaClaimed =
    input.employmentAllowanceClaimed ?? Boolean(input.employer.employmentAllowanceClaimed)

  const draft: CareEpsPayload = {
    meta: {
      schemaVersion: 'care-eps-preview-1',
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      purpose: 'PREVIEW',
    },
    employer: {
      hmrcOfficeNumber: input.employer.hmrcOfficeNumber?.trim() || '',
      employerPayeReference: input.employer.employerPayeReference?.trim() || '',
      fullPayeReference: input.employer.fullPayeReference?.trim() || '',
      accountsOfficeReference: input.employer.accountsOfficeReference?.trim() || '',
      employerTradingName: input.employer.employerTradingName,
    },
    period: {
      taxYearCode: input.taxYearCode,
      relatedTaxYear: relatedTaxYearCode(input.taxYearCode),
      taxMonth: input.taxMonth,
      taxMonthStart: bounds.start,
      taxMonthEnd: bounds.end,
      electronicDeadline: deadline,
      daysUntilDeadline,
      deadlineStatus,
    },
    indicators: {
      noPaymentThisPeriod: noPayment,
      employmentAllowanceClaimed: eaClaimed,
    },
    recoveries,
    context: {
      closedRunsInTaxMonth: closedRuns,
      employeesPaidInTaxMonth: employeesPaid,
      suggestedNilPayment: suggestedNil,
    },
    warnings,
    validation: { isReadyToSubmit: false, errorCount: 0, warningCount: 0, items: [] },
  }

  draft.validation = validateCareEpsPayload(draft)
  return draft
}

export function validateCareEpsPayload(payload: CareEpsPayload): CareEpsPayload['validation'] {
  const items: CareEpsPayload['validation']['items'] = []
  const push = (
    severity: 'error' | 'warning',
    code: string,
    message: string,
    field?: string,
  ) => items.push({ severity, code, message, field })

  if (!/^\d{3}$/.test(payload.employer.hmrcOfficeNumber.trim())) {
    push(
      'error',
      'EMPLOYER_OFFICE_NUMBER',
      'Employer HMRC office number must be exactly 3 digits',
      'hmrcOfficeNumber',
    )
  }
  if (!payload.employer.employerPayeReference.trim()) {
    push('error', 'EMPLOYER_PAYE_REF', 'Employer PAYE reference is missing', 'employerPayeReference')
  }
  if (!payload.employer.accountsOfficeReference.trim()) {
    push(
      'error',
      'EMPLOYER_ACCOUNTS_OFFICE',
      'Accounts Office reference is missing — needed on every EPS',
      'accountsOfficeReference',
    )
  }
  if (payload.period.taxMonth < 1 || payload.period.taxMonth > 12) {
    push('error', 'TAX_MONTH', 'Tax month must be between 1 and 12', 'taxMonth')
  }
  for (const [key, label] of [
    ['smpRecovered', 'SMP recovered'],
    ['sppRecovered', 'SPP recovered'],
    ['sapRecovered', 'SAP recovered'],
    ['shppRecovered', 'ShPP recovered'],
    ['spbpRecovered', 'SPBP recovered'],
    ['nicCompensationOnStatutory', 'NIC compensation on statutory'],
  ] as const) {
    const v = payload.recoveries[key]
    if (!Number.isFinite(v) || v < 0) {
      push('error', 'RECOVERY_INVALID', `${label} must be zero or a positive amount`, key)
    }
  }
  if (payload.period.deadlineStatus === 'OVERDUE') {
    push(
      'warning',
      'DEADLINE_OVERDUE',
      `Electronic filing deadline ${payload.period.electronicDeadline} has passed`,
      'electronicDeadline',
    )
  }

  const errorCount = items.filter((i) => i.severity === 'error').length
  const warningCount = items.filter((i) => i.severity === 'warning').length
  return {
    isReadyToSubmit: errorCount === 0,
    errorCount,
    warningCount,
    items,
  }
}
