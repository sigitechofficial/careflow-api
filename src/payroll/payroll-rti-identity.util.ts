export type RtiHmrcGender = 'M' | 'F'

export type RtiIdentityAssessmentInput = {
  firstName?: string | null
  lastName?: string | null
  dateOfBirth?: Date | string | null
  genderName?: string | null
  addressLine1?: string | null
  town?: string | null
  postcode?: string | null
  nationalInsuranceNo?: string | null
  payrollNumber?: string | null
  taxCode?: string | null
  niCategory?: string | null
}

export type RtiIdentityAssessment = {
  isComplete: boolean
  issues: string[]
  genderHmrc: RtiHmrcGender | null
}

/** Map Care Gender lookup name → HMRC FPS M/F. "Other" is not FPS-ready. */
export function mapGenderNameToHmrc(genderName?: string | null): RtiHmrcGender | null {
  const raw = (genderName ?? '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'm' || raw === 'male' || raw === 'man') return 'M'
  if (raw === 'f' || raw === 'female' || raw === 'woman') return 'F'
  return null
}

function hasText(value?: string | null): boolean {
  return Boolean(value && value.trim().length > 0)
}

function hasDate(value?: Date | string | null): boolean {
  if (value == null) return false
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  return String(value).trim().length >= 8
}

/**
 * FPS identity + statutory profile fields required before EmployeePayrollProfile can be READY.
 * Does not duplicate HR fields — callers join EmployeePersonalDetail / Employment.
 */
export function assessRtiIdentityCompleteness(
  input: RtiIdentityAssessmentInput,
): RtiIdentityAssessment {
  const issues: string[] = []
  const genderHmrc = mapGenderNameToHmrc(input.genderName)

  if (!hasText(input.firstName)) issues.push('Legal first name is missing on the employee record')
  if (!hasText(input.lastName)) issues.push('Legal last name is missing on the employee record')
  if (!hasDate(input.dateOfBirth)) {
    issues.push('Date of birth is missing on the employee personal record')
  }
  if (!genderHmrc) {
    issues.push(
      'Gender must be Male or Female on the employee record (HMRC FPS uses M or F only)',
    )
  }
  if (!hasText(input.addressLine1)) {
    issues.push('Address line 1 is missing on the employee personal record')
  }
  if (!hasText(input.town)) issues.push('Town / city is missing on the employee personal record')
  if (!hasText(input.postcode)) issues.push('Postcode is missing on the employee personal record')
  if (!hasText(input.nationalInsuranceNo)) {
    issues.push('National Insurance number is missing on the employment record')
  }
  if (!hasText(input.payrollNumber)) {
    issues.push('Payroll number is missing on the employment record (used as HMRC payroll ID)')
  }
  if (!hasText(input.taxCode)) issues.push('UK tax code must be set on the payroll profile')
  if (!hasText(input.niCategory)) {
    issues.push('NI category letter must be set on the payroll profile')
  }

  return {
    isComplete: issues.length === 0,
    issues,
    genderHmrc,
  }
}

export function formatRtiIdentityBlockMessage(issues: string[]): string {
  const head = 'Cannot set profile to READY until HMRC identity fields are complete:'
  return `${head}\n- ${issues.join('\n- ')}`
}
