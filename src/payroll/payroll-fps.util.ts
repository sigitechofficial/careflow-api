import { assessRtiIdentityCompleteness, mapGenderNameToHmrc } from './payroll-rti-identity.util'
import { dateToIsoDate } from './payroll-mapper.util'
import { validateCareFpsPayload } from './payroll-fps-validation.util'
import {
  isPayrollHoursNormallyWorked,
  mapContractedHoursToBand,
} from './payroll-hours-normally-worked.util'
import {
  deriveStarterLeaverIndicators,
  starterLeaverFpsIssues,
} from './payroll-starter-leaver.util'
import type {
  CareFpsEmployeeEntry,
  CareFpsPayload,
  FpsHoursNormallyWorked,
} from './types/fps-payload.types'

export type FpsBuilderEmployer = {
  hmrcOfficeNumber: string | null
  employerPayeReference: string | null
  accountsOfficeReference: string | null
  employerTradingName: string | null
  fullPayeReference: string | null
  isComplete: boolean
}

export type FpsBuilderEmployeeIdentity = {
  employeeId: string
  firstName: string | null
  lastName: string | null
  dateOfBirth: Date | string | null
  genderName: string | null
  addressLine1: string | null
  addressLine2: string | null
  town: string | null
  county: string | null
  country: string | null
  postcode: string | null
  nationalInsuranceNo: string | null
  payrollNumber: string | null
  startDate: Date | string | null
  endDate: Date | string | null
  contractedWeeklyHours: number | null
}

export type FpsBuilderRunEmployee = {
  employeeId: string
  totalGross: number
  taxablePay: number
  incomeTax: number
  employeeNi: number
  employerNi: number
  netPay: number
  taxCodeApplied: string | null
  niCategoryApplied: string | null
  week1Month1: boolean
  starterDeclaration: string | null
  /** Explicit FPS band from payroll profile (T04). Preferred over contracted-hours inference. */
  hoursNormallyWorked?: FpsHoursNormallyWorked | null
  p45Received?: boolean
  ytd: {
    grossPayYtd: number
    taxablePayYtd: number
    incomeTaxYtd: number
    employeeNiYtd: number
    employerNiYtd: number
    netPayYtd: number
  } | null
}

export type FpsBuilderRun = {
  id: string
  status: string
  totalGross: number
  totalIncomeTax: number
  totalEmployeeNi: number
  totalEmployerNi: number
  totalNetPay: number
  taxYearCode: string
  periodSequence: number
  periodStart: string
  periodEnd: string
  paymentDate: string
  payFrequency: string
}

/** HMRC FPS hours-normally-worked band from contracted weekly hours (A–D only). */
export function mapHoursNormallyWorked(
  contractedWeeklyHours: number | null | undefined,
): FpsHoursNormallyWorked | null {
  return mapContractedHoursToBand(contractedWeeklyHours)
}

/** Prefer profile band; fall back to contracted weekly hours. */
export function resolveHoursNormallyWorked(input: {
  profileBand?: string | null
  contractedWeeklyHours?: number | null
}): FpsHoursNormallyWorked | null {
  if (isPayrollHoursNormallyWorked(input.profileBand)) return input.profileBand
  return mapHoursNormallyWorked(input.contractedWeeklyHours)
}

function relatedTaxYearCode(taxYearCode: string): string {
  // e.g. 2026-27 → 26-27
  const m = taxYearCode.match(/(\d{2})(\d{2})[-/](\d{2})/)
  if (m) return `${m[2]}-${m[3]}`
  return taxYearCode
}

export function buildCareFpsPayload(input: {
  run: FpsBuilderRun
  employer: FpsBuilderEmployer
  identities: FpsBuilderEmployeeIdentity[]
  employees: FpsBuilderRunEmployee[]
  generatedAt?: Date
  gatewayCredentialsReady?: boolean
}): CareFpsPayload {
  const warnings: string[] = []
  if (input.run.status !== 'CLOSED') {
    warnings.push('Run is not CLOSED — FPS preview is only valid after close')
  }
  if (!input.employer.isComplete) {
    warnings.push(
      'Employer PAYE settings incomplete — set office number, PAYE reference, and Accounts Office reference',
    )
  }

  const identityById = new Map(input.identities.map((i) => [i.employeeId, i]))
  const entries: CareFpsEmployeeEntry[] = []

  for (const emp of input.employees) {
    const id = identityById.get(emp.employeeId)
    const genderHmrc = mapGenderNameToHmrc(id?.genderName)
    const assessment = assessRtiIdentityCompleteness({
      firstName: id?.firstName,
      lastName: id?.lastName,
      dateOfBirth: id?.dateOfBirth,
      genderName: id?.genderName,
      addressLine1: id?.addressLine1,
      town: id?.town,
      postcode: id?.postcode,
      nationalInsuranceNo: id?.nationalInsuranceNo,
      payrollNumber: id?.payrollNumber,
      taxCode: emp.taxCodeApplied,
      niCategory: emp.niCategoryApplied,
    })
    const issues = [...assessment.issues]
    if (!emp.ytd) {
      issues.push('YTD figures missing — close the run to post year-to-date ledgers')
    }
    const hours = resolveHoursNormallyWorked({
      profileBand: emp.hoursNormallyWorked,
      contractedWeeklyHours: id?.contractedWeeklyHours ?? null,
    })
    if (!hours) {
      issues.push(
        'Hours normally worked band (A–E) not set on payroll profile — and contracted hours missing',
      )
    }

    const starterLeaver = deriveStarterLeaverIndicators({
      startDate: id?.startDate,
      endDate: id?.endDate,
      periodStart: input.run.periodStart,
      periodEnd: input.run.periodEnd,
      p45Received: emp.p45Received,
    })
    const displayName =
      `${(id?.firstName ?? '').trim()} ${(id?.lastName ?? '').trim()}`.trim() || emp.employeeId
    issues.push(
      ...starterLeaverFpsIssues({
        displayName,
        starterDeclaration: emp.starterDeclaration,
        indicators: starterLeaver,
      }),
    )

    entries.push({
      employeeId: emp.employeeId,
      name: {
        forename: (id?.firstName ?? '').trim(),
        surname: (id?.lastName ?? '').trim(),
      },
      birthDate: dateToIsoDate(id?.dateOfBirth ?? null),
      gender: genderHmrc,
      nino: id?.nationalInsuranceNo?.trim() || null,
      payId: id?.payrollNumber?.trim() || null,
      address: {
        line1: id?.addressLine1?.trim() || null,
        line2: id?.addressLine2?.trim() || null,
        city: id?.town?.trim() || null,
        county: id?.county?.trim() || null,
        postcode: id?.postcode?.trim() || null,
        country: id?.country?.trim() || null,
      },
      employment: {
        taxCode: emp.taxCodeApplied,
        week1Month1: emp.week1Month1,
        niCategory: emp.niCategoryApplied,
        starterDeclaration: emp.starterDeclaration,
        hoursNormallyWorked: hours,
        startingDate: starterLeaver.startingDate,
        leavingDate: starterLeaver.leavingDate,
        isStarterInPeriod: starterLeaver.isStarterInPeriod,
        isLeaverInPeriod: starterLeaver.isLeaverInPeriod,
        isFirstPayOfEmployment: starterLeaver.isFirstPayOfEmployment,
        isLastPayOfEmployment: starterLeaver.isLastPayOfEmployment,
        p45Received: starterLeaver.p45Received,
      },
      payment: {
        taxablePay: emp.taxablePay,
        taxDeductedOrRefunded: emp.incomeTax,
        employeeNiContribution: emp.employeeNi,
        employerNiContribution: emp.employerNi,
        periodGross: emp.totalGross,
        periodNetPay: emp.netPay,
        taxablePayYtd: emp.ytd?.taxablePayYtd ?? 0,
        totalTaxYtd: emp.ytd?.incomeTaxYtd ?? 0,
        employeeNiYtd: emp.ytd?.employeeNiYtd ?? 0,
        employerNiYtd: emp.ytd?.employerNiYtd ?? 0,
        grossPayYtd: emp.ytd?.grossPayYtd ?? 0,
        netPayYtd: emp.ytd?.netPayYtd ?? 0,
      },
      issues,
    })
  }

  const incompleteEmployees = entries.filter((e) => e.issues.length > 0).length
  if (incompleteEmployees > 0) {
    warnings.push(
      `${incompleteEmployees} employee(s) have incomplete FPS fields — fix before live submit (T16)`,
    )
  }

  const generatedAt = (input.generatedAt ?? new Date()).toISOString()

  const draft: CareFpsPayload = {
    meta: {
      schemaVersion: 'care-fps-preview-1',
      generatedAt,
      ukPayrollRunId: input.run.id,
      runStatus: input.run.status,
      taxYearCode: input.run.taxYearCode,
      purpose: 'PREVIEW',
    },
    employer: {
      hmrcOfficeNumber: input.employer.hmrcOfficeNumber?.trim() || '',
      employerPayeReference: input.employer.employerPayeReference?.trim() || '',
      fullPayeReference: input.employer.fullPayeReference?.trim() || '',
      accountsOfficeReference: input.employer.accountsOfficeReference?.trim() || '',
      employerTradingName: input.employer.employerTradingName,
    },
    submission: {
      relatedTaxYear: relatedTaxYearCode(input.run.taxYearCode),
      taxMonthOrWeekNumber: input.run.periodSequence,
      payFrequency: input.run.payFrequency,
      paymentDate: input.run.paymentDate,
      periodStart: input.run.periodStart,
      periodEnd: input.run.periodEnd,
    },
    employees: entries,
    totals: {
      employeeCount: entries.length,
      totalGross: input.run.totalGross,
      totalIncomeTax: input.run.totalIncomeTax,
      totalEmployeeNi: input.run.totalEmployeeNi,
      totalEmployerNi: input.run.totalEmployerNi,
      totalNetPay: input.run.totalNetPay,
    },
    warnings,
    validation: {
      isReadyToSubmit: false,
      errorCount: 0,
      warningCount: 0,
      items: [],
    },
  }

  draft.validation = validateCareFpsPayload(draft, {
    gatewayCredentialsReady: input.gatewayCredentialsReady,
  })
  return draft
}
