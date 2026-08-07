import type { CareFpsPayload } from './types/fps-payload.types'

export type FpsValidationSeverity = 'error' | 'warning'

export type FpsValidationScope = 'run' | 'employer' | 'submission' | 'employee'

export type FpsValidationItem = {
  severity: FpsValidationSeverity
  code: string
  scope: FpsValidationScope
  employeeId?: string
  employeeName?: string
  field?: string
  message: string
}

export type FpsValidationResult = {
  /** True only when there are zero blocking errors (T16 gate). */
  isReadyToSubmit: boolean
  errorCount: number
  warningCount: number
  items: FpsValidationItem[]
}

export type ValidateCareFpsOptions = {
  /** From employer Gateway vault (T02). Missing → blocking error (T16 submit gate). */
  gatewayCredentialsReady?: boolean
}

function push(
  items: FpsValidationItem[],
  item: Omit<FpsValidationItem, 'severity'> & { severity?: FpsValidationSeverity },
) {
  items.push({ severity: item.severity ?? 'error', ...item })
}

function hasText(value?: string | null): boolean {
  return Boolean(value && value.trim().length > 0)
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Simplified UK NI number shape (spaces ignored). */
export function isValidUkNino(raw?: string | null): boolean {
  if (!raw) return false
  const nino = raw.replace(/\s+/g, '').toUpperCase()
  return /^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(nino)
}

/** Loose UK postcode check — enough to catch empty/garbage before HMRC. */
export function isValidUkPostcode(raw?: string | null): boolean {
  if (!raw) return false
  const pc = raw.replace(/\s+/g, '').toUpperCase()
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)
}

function employeeLabel(emp: CareFpsPayload['employees'][number]): string {
  const name = `${emp.name.forename} ${emp.name.surname}`.trim()
  return name || emp.payId || emp.employeeId
}

/**
 * Validate a Care FPS preview payload for HMRC RTI readiness (T13).
 * Blocking errors → isReadyToSubmit=false. Soft gaps (hours band) → warnings.
 * Missing Gateway credentials is a blocking error (T16 submit gate).
 */
export function validateCareFpsPayload(
  payload: CareFpsPayload,
  options: ValidateCareFpsOptions = {},
): FpsValidationResult {
  const items: FpsValidationItem[] = []

  if (payload.meta.runStatus !== 'CLOSED') {
    push(items, {
      code: 'RUN_NOT_CLOSED',
      scope: 'run',
      field: 'status',
      message: 'Close the payroll run before you can send an FPS to HMRC',
    })
  }

  if (payload.employees.length < 1) {
    push(items, {
      code: 'NO_EMPLOYEES',
      scope: 'run',
      message: 'This run has no employees — nothing to put on an FPS',
    })
  }

  // Employer identity
  if (!/^\d{3}$/.test(payload.employer.hmrcOfficeNumber.trim())) {
    push(items, {
      code: 'EMPLOYER_OFFICE_NUMBER',
      scope: 'employer',
      field: 'hmrcOfficeNumber',
      message: 'Employer HMRC office number must be exactly 3 digits (Payroll → Employer PAYE)',
    })
  }
  if (!hasText(payload.employer.employerPayeReference)) {
    push(items, {
      code: 'EMPLOYER_PAYE_REF',
      scope: 'employer',
      field: 'employerPayeReference',
      message: 'Employer PAYE reference (after the slash) is missing',
    })
  }
  if (!hasText(payload.employer.accountsOfficeReference)) {
    push(items, {
      code: 'EMPLOYER_ACCOUNTS_OFFICE',
      scope: 'employer',
      field: 'accountsOfficeReference',
      message: 'Accounts Office reference is missing — needed on every FPS',
    })
  }

  if (options.gatewayCredentialsReady === false) {
    push(items, {
      code: 'GATEWAY_NOT_READY',
      scope: 'employer',
      field: 'gatewayCredentials',
      message:
        'HMRC Gateway login is not ready for the selected environment (Payroll → Employer PAYE). Save the test user ID and password before Care can send an FPS.',
    })
  }

  // Submission header
  if (!/^\d{2}-\d{2}$/.test(payload.submission.relatedTaxYear.trim())) {
    push(items, {
      code: 'RELATED_TAX_YEAR',
      scope: 'submission',
      field: 'relatedTaxYear',
      message: 'Related tax year looks wrong (expected format like 26-27)',
    })
  }
  if (
    !Number.isInteger(payload.submission.taxMonthOrWeekNumber) ||
    payload.submission.taxMonthOrWeekNumber < 1
  ) {
    push(items, {
      code: 'PERIOD_NUMBER',
      scope: 'submission',
      field: 'taxMonthOrWeekNumber',
      message: 'Pay period number must be a positive whole number',
    })
  }
  if (!hasText(payload.submission.payFrequency)) {
    push(items, {
      code: 'PAY_FREQUENCY',
      scope: 'submission',
      field: 'payFrequency',
      message: 'Pay frequency is missing on this run’s schedule',
    })
  }
  if (!hasText(payload.submission.paymentDate)) {
    push(items, {
      code: 'PAYMENT_DATE',
      scope: 'submission',
      field: 'paymentDate',
      message: 'Payment date is missing on the pay period',
    })
  }

  for (const emp of payload.employees) {
    const name = employeeLabel(emp)
    const base = {
      scope: 'employee' as const,
      employeeId: emp.employeeId,
      employeeName: name,
    }

    if (!hasText(emp.name.forename)) {
      push(items, {
        ...base,
        code: 'EMP_FORENAME',
        field: 'forename',
        message: `${name}: first name is missing`,
      })
    }
    if (!hasText(emp.name.surname)) {
      push(items, {
        ...base,
        code: 'EMP_SURNAME',
        field: 'surname',
        message: `${name}: last name is missing`,
      })
    }
    if (!hasText(emp.birthDate)) {
      push(items, {
        ...base,
        code: 'EMP_DOB',
        field: 'birthDate',
        message: `${name}: date of birth is missing`,
      })
    }
    if (emp.gender !== 'M' && emp.gender !== 'F') {
      push(items, {
        ...base,
        code: 'EMP_GENDER',
        field: 'gender',
        message: `${name}: gender must be Male or Female (HMRC only accepts M or F)`,
      })
    }
    if (!hasText(emp.nino)) {
      push(items, {
        ...base,
        code: 'EMP_NINO_MISSING',
        field: 'nino',
        message: `${name}: National Insurance number is missing`,
      })
    } else if (!isValidUkNino(emp.nino)) {
      push(items, {
        ...base,
        code: 'EMP_NINO_FORMAT',
        field: 'nino',
        message: `${name}: National Insurance number does not look valid (example AB123456C)`,
      })
    }
    if (!hasText(emp.payId)) {
      push(items, {
        ...base,
        code: 'EMP_PAY_ID',
        field: 'payId',
        message: `${name}: payroll number is missing (used as HMRC payroll ID)`,
      })
    }
    if (!hasText(emp.address.line1)) {
      push(items, {
        ...base,
        code: 'EMP_ADDRESS_LINE1',
        field: 'address.line1',
        message: `${name}: address line 1 is missing`,
      })
    }
    if (!hasText(emp.address.city)) {
      push(items, {
        ...base,
        code: 'EMP_ADDRESS_CITY',
        field: 'address.city',
        message: `${name}: town / city is missing`,
      })
    }
    if (!hasText(emp.address.postcode)) {
      push(items, {
        ...base,
        code: 'EMP_POSTCODE_MISSING',
        field: 'address.postcode',
        message: `${name}: postcode is missing`,
      })
    } else if (!isValidUkPostcode(emp.address.postcode)) {
      push(items, {
        ...base,
        code: 'EMP_POSTCODE_FORMAT',
        field: 'address.postcode',
        message: `${name}: postcode does not look like a UK postcode`,
      })
    }
    if (!hasText(emp.employment.taxCode)) {
      push(items, {
        ...base,
        code: 'EMP_TAX_CODE',
        field: 'taxCode',
        message: `${name}: tax code is missing on this run`,
      })
    }
    if (!hasText(emp.employment.niCategory)) {
      push(items, {
        ...base,
        code: 'EMP_NI_CATEGORY',
        field: 'niCategory',
        message: `${name}: NI category letter is missing on this run`,
      })
    }
    if (!emp.employment.hoursNormallyWorked) {
      push(items, {
        ...base,
        severity: 'warning',
        code: 'EMP_HOURS_BAND',
        field: 'hoursNormallyWorked',
        message: `${name}: hours-normally-worked band is unknown (set A–E on the payroll profile)`,
      })
    }

    const moneyFields: Array<[keyof typeof emp.payment, string]> = [
      ['taxablePay', 'taxable pay'],
      ['taxDeductedOrRefunded', 'income tax'],
      ['employeeNiContribution', 'employee NI'],
      ['employerNiContribution', 'employer NI'],
      ['periodGross', 'gross'],
      ['periodNetPay', 'net pay'],
      ['taxablePayYtd', 'taxable pay YTD'],
      ['totalTaxYtd', 'tax YTD'],
      ['employeeNiYtd', 'employee NI YTD'],
      ['employerNiYtd', 'employer NI YTD'],
      ['grossPayYtd', 'gross YTD'],
      ['netPayYtd', 'net YTD'],
    ]
    for (const [key, label] of moneyFields) {
      if (!isFiniteNumber(emp.payment[key])) {
        push(items, {
          ...base,
          code: 'EMP_MONEY_INVALID',
          field: `payment.${key}`,
          message: `${name}: ${label} figure is invalid`,
        })
      }
    }

    if (
      isFiniteNumber(emp.payment.periodGross) &&
      emp.payment.periodGross > 0 &&
      isFiniteNumber(emp.payment.grossPayYtd) &&
      emp.payment.grossPayYtd + 0.005 < emp.payment.periodGross
    ) {
      push(items, {
        ...base,
        code: 'EMP_YTD_BELOW_PERIOD',
        field: 'payment.grossPayYtd',
        message: `${name}: year-to-date gross is lower than this period’s gross — YTD may not have posted on close`,
      })
    }
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
