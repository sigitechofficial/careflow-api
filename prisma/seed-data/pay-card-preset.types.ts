export type PayCardPresetRule = {
  label: string
  serviceType?: string | null
  dayType: 'WEEKDAY' | 'SATURDAY' | 'SUNDAY' | 'BANK_HOLIDAY' | 'ANY'
  startTime?: string | null
  endTime?: string | null
  rateType:
    | 'HOURLY'
    | 'FIXED'
    | 'MILEAGE'
    | 'TRAVEL_TIME'
    | 'WAITING_TIME'
    | 'PER_VISIT_FEE'
    | 'PREMIUM'
    | 'UPLIFT'
    | 'DEDUCTION'
  amount: number
  minimumMinutes?: number | null
  multiplier?: number | null
  priority?: number
  sortOrder: number
}

export type PayCardPreset = {
  name: string
  code: string
  assignmentLevel:
    | 'ORGANISATION_DEFAULT'
    | 'BRANCH'
    | 'WORKER_TYPE'
    | 'ROLE'
    | 'EMPLOYMENT_TYPE'
  assignmentTargetKey?: 'INTERNAL' | 'AGENCY' | 'BANK' | null
  assignmentLabel?: string
  branchNameHint?: string
  status: 'ACTIVE'
  effectiveFrom: string
  effectiveTo?: string | null
  notes?: string
  rules: PayCardPresetRule[]
}
