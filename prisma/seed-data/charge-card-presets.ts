/**
 * UK domiciliary care charge card presets aligned with Birdie, Nourish Empower, and
 * typical LA / NHS / private-pay billing (hourly pro-rata, 15/30/45/60 min slots).
 */

export type ChargeCardPresetRule = {
  label: string
  serviceType?: string | null
  dayType: 'WEEKDAY' | 'SATURDAY' | 'SUNDAY' | 'BANK_HOLIDAY' | 'ANY'
  rateType: 'HOURLY'
  chargeMethod: 'HOURLY_PRO_RATA'
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
  /** Match funder by unique code (e.g. CROYDON_COUNCIL). */
  funderCodeHint?: string
  /** Match funder by name (case-insensitive contains). */
  funderNameHint?: string
  /** Match branch/location by name (case-insensitive contains). */
  branchNameHint?: string
  assignmentTargetKey?: string | null
  billingFrequency: 'WEEKLY' | 'FOUR_WEEKLY' | 'MONTHLY'
  paymentTerms?: string | null
  taxTreatment?: string | null
  defaultChargeMethod: 'HOURLY_PRO_RATA'
  status: 'ACTIVE'
  effectiveFrom: string
  effectiveTo?: string | null
  notes?: string
  rules: ChargeCardPresetRule[]
}

const weekdayDurationRules = (
  prefix: string,
  amount15: number,
  amount30: number,
  amount45: number,
  amount60: number,
  startOrder: number,
): ChargeCardPresetRule[] => [
  {
    label: `${prefix} — 15 minutes`,
    dayType: 'WEEKDAY',
    rateType: 'HOURLY',
    chargeMethod: 'HOURLY_PRO_RATA',
    amount: amount15,
    minimumMinutes: 15,
    sortOrder: startOrder,
  },
  {
    label: `${prefix} — 30 minutes`,
    dayType: 'WEEKDAY',
    rateType: 'HOURLY',
    chargeMethod: 'HOURLY_PRO_RATA',
    amount: amount30,
    minimumMinutes: 30,
    sortOrder: startOrder + 1,
  },
  {
    label: `${prefix} — 45 minutes`,
    dayType: 'WEEKDAY',
    rateType: 'HOURLY',
    chargeMethod: 'HOURLY_PRO_RATA',
    amount: amount45,
    minimumMinutes: 45,
    sortOrder: startOrder + 2,
  },
  {
    label: `${prefix} — 60 minutes`,
    dayType: 'WEEKDAY',
    rateType: 'HOURLY',
    chargeMethod: 'HOURLY_PRO_RATA',
    amount: amount60,
    minimumMinutes: 60,
    sortOrder: startOrder + 3,
  },
]

/** Birdie / Nourish-style charge cards for LA, NHS, direct payment, and private pay. */
export const CHARGE_CARD_PRESETS: ChargeCardPreset[] = [
  {
    name: 'Private Client — Standard Rates',
    code: 'CHG-STD-UK-2026',
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentLabel: 'Organisation default',
    billingFrequency: 'WEEKLY',
    paymentTerms: 'Due on receipt',
    taxTreatment: 'VAT exempt',
    defaultChargeMethod: 'HOURLY_PRO_RATA',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Birdie / Access Group style default private-pay hourly rates with visit duration bands.',
    rules: [
      ...weekdayDurationRules('Weekday', 29.5, 28.5, 28.0, 27.5, 0),
      {
        label: 'Saturday — any duration',
        dayType: 'SATURDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 31.0,
        sortOrder: 4,
      },
      {
        label: 'Sunday — any duration',
        dayType: 'SUNDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 33.0,
        sortOrder: 5,
      },
      {
        label: 'Bank holiday — 30 minutes',
        dayType: 'BANK_HOLIDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 36.0,
        minimumMinutes: 30,
        sortOrder: 6,
      },
      {
        label: 'Bank holiday — any duration',
        dayType: 'BANK_HOLIDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 35.0,
        sortOrder: 7,
      },
    ],
  },
  {
    name: 'Local Authority — Croydon Council',
    code: 'CHG-LA-CROY-2026',
    assignmentLevel: 'FUNDER',
    funderCodeHint: 'CROYDON_COUNCIL',
    assignmentLabel: 'Funder: Croydon Council',
    billingFrequency: 'FOUR_WEEKLY',
    paymentTerms: 'Net 30',
    taxTreatment: 'VAT exempt',
    defaultChargeMethod: 'HOURLY_PRO_RATA',
    status: 'ACTIVE',
    effectiveFrom: '2026-04-01',
    effectiveTo: '2027-03-31',
    notes: 'Typical London borough LA schedule — 4-weekly invoicing, duration-banded weekday rates.',
    rules: [
      ...weekdayDurationRules('Personal care weekday', 25.5, 25.0, 24.75, 24.5, 0),
      {
        label: 'Saturday',
        dayType: 'SATURDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 27.0,
        sortOrder: 4,
      },
      {
        label: 'Sunday',
        dayType: 'SUNDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 29.0,
        sortOrder: 5,
      },
      {
        label: 'Bank holiday',
        dayType: 'BANK_HOLIDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 32.0,
        sortOrder: 6,
      },
    ],
  },
  {
    name: 'NHS Continuing Healthcare',
    code: 'CHG-NHS-CHC-2026',
    assignmentLevel: 'FUNDER',
    funderCodeHint: 'NHS_CHC',
    assignmentLabel: 'Funder: NHS Continuing Healthcare',
    billingFrequency: 'MONTHLY',
    paymentTerms: 'Net 30',
    taxTreatment: 'VAT exempt',
    defaultChargeMethod: 'HOURLY_PRO_RATA',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'NHS CHC block contract style — monthly billing, standard visit durations.',
    rules: [
      ...weekdayDurationRules('CHC weekday', 26.0, 25.5, 25.25, 25.0, 0),
      {
        label: 'Bank holiday',
        dayType: 'BANK_HOLIDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 31.5,
        sortOrder: 4,
      },
    ],
  },
  {
    name: 'Direct Payment — Standard',
    code: 'CHG-DP-2026',
    assignmentLevel: 'FUNDER',
    funderCodeHint: 'DIRECT_PAYMENT_FUNDER',
    assignmentLabel: 'Funder: Direct Payment',
    billingFrequency: 'FOUR_WEEKLY',
    paymentTerms: 'Due on receipt',
    defaultChargeMethod: 'HOURLY_PRO_RATA',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Direct payment clients — mirrors LA rate card with self-pay invoicing.',
    rules: [
      ...weekdayDurationRules('Direct payment weekday', 24.5, 24.0, 23.75, 23.5, 0),
      {
        label: 'Saturday',
        dayType: 'SATURDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 26.5,
        sortOrder: 4,
      },
      {
        label: 'Sunday',
        dayType: 'SUNDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 28.5,
        sortOrder: 5,
      },
      {
        label: 'Bank holiday',
        dayType: 'BANK_HOLIDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 30.0,
        sortOrder: 6,
      },
    ],
  },
  {
    name: 'Private Client — Premium',
    code: 'CHG-PVT-PREM-2026',
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentLabel: 'Premium private pay',
    billingFrequency: 'WEEKLY',
    paymentTerms: 'Due on receipt',
    taxTreatment: 'VAT exempt',
    defaultChargeMethod: 'HOURLY_PRO_RATA',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Higher-rate private clients — assign explicitly on service user or funding record.',
    rules: [
      ...weekdayDurationRules('Premium weekday', 34.0, 33.0, 32.5, 32.0, 0),
      {
        label: 'Saturday',
        dayType: 'SATURDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 36.0,
        sortOrder: 4,
      },
      {
        label: 'Sunday',
        dayType: 'SUNDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 38.0,
        sortOrder: 5,
      },
      {
        label: 'Bank holiday',
        dayType: 'BANK_HOLIDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 42.0,
        sortOrder: 6,
      },
    ],
  },
  {
    name: 'Complex Care — Service Type',
    code: 'CHG-CPLX-2026',
    assignmentLevel: 'SERVICE_TYPE',
    assignmentTargetKey: 'Complex care',
    assignmentLabel: 'Service type: Complex care',
    billingFrequency: 'WEEKLY',
    defaultChargeMethod: 'HOURLY_PRO_RATA',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Complex / double-up care visits — Nourish-style service-type charge card.',
    rules: [
      ...weekdayDurationRules('Complex care weekday', 32.0, 31.0, 30.5, 30.0, 0),
      {
        label: 'Bank holiday',
        dayType: 'BANK_HOLIDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 38.0,
        sortOrder: 4,
      },
    ],
  },
  {
    name: 'London Branch — LA Uplift',
    code: 'CHG-LON-BRN-2026',
    assignmentLevel: 'BRANCH_REGION',
    branchNameHint: 'London',
    assignmentLabel: 'Branch: London',
    billingFrequency: 'FOUR_WEEKLY',
    paymentTerms: 'Net 30',
    defaultChargeMethod: 'HOURLY_PRO_RATA',
    status: 'ACTIVE',
    effectiveFrom: '2026-04-01',
    notes: 'London borough uplift when branch is set on the service user record.',
    rules: [
      ...weekdayDurationRules('London weekday', 26.5, 26.0, 25.75, 25.5, 0),
      {
        label: 'Bank holiday',
        dayType: 'BANK_HOLIDAY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 33.0,
        sortOrder: 4,
      },
    ],
  },
  {
    name: 'Live-in Care Package',
    code: 'CHG-LIV-PKG-2026',
    assignmentLevel: 'CARE_PACKAGE',
    assignmentTargetKey: 'Live-in',
    assignmentLabel: 'Care package: Live-in',
    billingFrequency: 'WEEKLY',
    paymentTerms: 'Due on receipt',
    defaultChargeMethod: 'HOURLY_PRO_RATA',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Live-in weekly package billing — hourly rate for day-off cover visits.',
    rules: [
      {
        label: 'Day-off cover — 60 minutes',
        dayType: 'ANY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 30.0,
        minimumMinutes: 60,
        sortOrder: 0,
      },
      {
        label: 'Day-off cover — any duration',
        dayType: 'ANY',
        rateType: 'HOURLY',
        chargeMethod: 'HOURLY_PRO_RATA',
        amount: 29.0,
        sortOrder: 1,
      },
    ],
  },
]
