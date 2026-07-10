export type ChargeCardPresetRule = {
  label: string
  serviceType?: string | null
  dayType: 'WEEKDAY' | 'SATURDAY' | 'SUNDAY' | 'BANK_HOLIDAY' | 'ANY'
  rateType: 'HOURLY' | 'FIXED'
  chargeMethod: 'HOURLY_PRO_RATA' | 'FIXED_VISIT'
  amount: number
  minimumMinutes?: number | null
  sortOrder: number
}

export type ChargeCardPreset = {
  name: string
  code: string
  assignmentLevel:
    | 'ORGANISATION_DEFAULT'
    | 'FUNDER'
    | 'BRANCH_REGION'
    | 'SERVICE_TYPE'
    | 'CARE_PACKAGE'
  assignmentLabel?: string
  funderCodeHint?: string
  funderNameHint?: string
  branchNameHint?: string
  assignmentTargetKey?: string | null
  billingFrequency: 'WEEKLY' | 'FOUR_WEEKLY' | 'MONTHLY'
  paymentTerms?: string | null
  taxTreatment?: string | null
  defaultChargeMethod: 'FIXED_VISIT'
  status: 'ACTIVE'
  effectiveFrom: string
  effectiveTo?: string | null
  notes?: string
  rules: ChargeCardPresetRule[]
}
