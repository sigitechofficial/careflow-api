import { dateToIsoDate } from './payroll-mapper.util'

/** Inclusive ISO date (YYYY-MM-DD) range check. */
export function isoDateInInclusiveRange(
  dateIso: string | null | undefined,
  rangeStartIso: string,
  rangeEndIso: string,
): boolean {
  if (!dateIso || dateIso.length < 10) return false
  const d = dateIso.slice(0, 10)
  const a = rangeStartIso.slice(0, 10)
  const b = rangeEndIso.slice(0, 10)
  return d >= a && d <= b
}

export type StarterLeaverIndicators = {
  startingDate: string | null
  leavingDate: string | null
  /** Employment start date falls inside this pay period. */
  isStarterInPeriod: boolean
  /** Employment leave date falls inside this pay period. */
  isLeaverInPeriod: boolean
  /** Treat this FPS as first payment for the employment (start in period). */
  isFirstPayOfEmployment: boolean
  /** Treat this FPS as last payment for the employment (leave in period). */
  isLastPayOfEmployment: boolean
  p45Received: boolean
}

/**
 * Derive starter/leaver FPS indicators from employment dates vs the pay period (T05).
 * First/last pay use period overlap — stronger “no prior closed run” checks can come later.
 */
export function deriveStarterLeaverIndicators(input: {
  startDate: Date | string | null | undefined
  endDate: Date | string | null | undefined
  periodStart: string
  periodEnd: string
  p45Received?: boolean | null
}): StarterLeaverIndicators {
  const startingDate = dateToIsoDate(input.startDate ?? null)
  const leavingDate = dateToIsoDate(input.endDate ?? null)
  const isStarterInPeriod = isoDateInInclusiveRange(
    startingDate,
    input.periodStart,
    input.periodEnd,
  )
  const isLeaverInPeriod = isoDateInInclusiveRange(leavingDate, input.periodStart, input.periodEnd)
  return {
    startingDate,
    leavingDate,
    isStarterInPeriod,
    isLeaverInPeriod,
    isFirstPayOfEmployment: isStarterInPeriod,
    isLastPayOfEmployment: isLeaverInPeriod,
    p45Received: Boolean(input.p45Received),
  }
}

export function starterLeaverFpsIssues(input: {
  displayName: string
  starterDeclaration: string | null | undefined
  indicators: StarterLeaverIndicators
}): string[] {
  const issues: string[] = []
  const name = input.displayName || 'Employee'
  if (
    input.indicators.isFirstPayOfEmployment &&
    !input.indicators.p45Received &&
    (!input.starterDeclaration || input.starterDeclaration === 'UNKNOWN')
  ) {
    issues.push(
      `${name}: first pay in this period — set starter declaration A/B/C (or mark P45 received)`,
    )
  }
  if (
    input.indicators.startingDate &&
    input.indicators.leavingDate &&
    input.indicators.leavingDate < input.indicators.startingDate
  ) {
    issues.push(`${name}: leaving date is before starting date on the employment record`)
  }
  return issues
}
