/** HMRC FPS “hours normally worked” bands (A–E). */

export const PAYROLL_HOURS_NORMALLY_WORKED_CODES = ['A', 'B', 'C', 'D', 'E'] as const

export type PayrollHoursNormallyWorked = (typeof PAYROLL_HOURS_NORMALLY_WORKED_CODES)[number]

export type PayrollHoursNormallyWorkedMeta = {
  code: PayrollHoursNormallyWorked
  label: string
  description: string
}

export const PAYROLL_HOURS_NORMALLY_WORKED_OPTIONS: PayrollHoursNormallyWorkedMeta[] = [
  {
    code: 'A',
    label: 'A — Less than 16 hours',
    description: 'Usually works under 16 hours a week.',
  },
  {
    code: 'B',
    label: 'B — 16 to 23.99 hours',
    description: 'Usually works 16 hours or more, but under 24.',
  },
  {
    code: 'C',
    label: 'C — 24 to 29.99 hours',
    description: 'Usually works 24 hours or more, but under 30.',
  },
  {
    code: 'D',
    label: 'D — 30 hours or more',
    description: 'Usually works 30 hours or more a week.',
  },
  {
    code: 'E',
    label: 'E — Other / irregular',
    description: 'Hours vary a lot, or none of the bands above fit.',
  },
]

const CODE_SET = new Set<string>(PAYROLL_HOURS_NORMALLY_WORKED_CODES)

export function isPayrollHoursNormallyWorked(
  value: string | null | undefined,
): value is PayrollHoursNormallyWorked {
  return Boolean(value && CODE_SET.has(value))
}

/** Infer A–D from contracted weekly hours. Never returns E (must be chosen). */
export function mapContractedHoursToBand(
  contractedWeeklyHours: number | null | undefined,
): Exclude<PayrollHoursNormallyWorked, 'E'> | null {
  if (contractedWeeklyHours == null || !Number.isFinite(contractedWeeklyHours)) return null
  if (contractedWeeklyHours < 16) return 'A'
  if (contractedWeeklyHours < 24) return 'B'
  if (contractedWeeklyHours < 30) return 'C'
  return 'D'
}

export function payrollHoursNormallyWorkedLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return PAYROLL_HOURS_NORMALLY_WORKED_OPTIONS.find((o) => o.code === code)?.label ?? code
}
