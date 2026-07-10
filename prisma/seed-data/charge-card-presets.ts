/**
 * UK domiciliary care charge card presets — fixed rates up to 60 minutes,
 * hourly rate × hours for visits longer than 1 hour.
 */

import {
  fixedChargeDurationRules,
  hourlyChargeVisitRule,
  buildStandardFixedChargeRules,
} from './charge-card-fixed-rates.util'
import type { ChargeCardPreset, ChargeCardPresetRule } from './charge-card-preset.types'
import type { FixedVisitAmounts } from './fixed-visit-rates.seed-data'

export type { ChargeCardPreset, ChargeCardPresetRule } from './charge-card-preset.types'

type VisitChargeDayConfig = {
  fixed: FixedVisitAmounts
  hourly: number
}

function buildVisitChargeRules(config: {
  weekday: VisitChargeDayConfig
  saturday?: VisitChargeDayConfig
  sunday?: VisitChargeDayConfig
  bankHoliday?: VisitChargeDayConfig
}): ChargeCardPresetRule[] {
  const rules: ChargeCardPresetRule[] = [
    ...fixedChargeDurationRules('Weekday charge', config.weekday.fixed, 0),
    hourlyChargeVisitRule('Weekday charge', config.weekday.hourly, 5),
  ]
  if (config.saturday) {
    rules.push(
      ...fixedChargeDurationRules('Saturday charge', config.saturday.fixed, 10, 'SATURDAY'),
      hourlyChargeVisitRule('Saturday charge', config.saturday.hourly, 15, 'SATURDAY'),
    )
  }
  if (config.sunday) {
    rules.push(
      ...fixedChargeDurationRules('Sunday charge', config.sunday.fixed, 20, 'SUNDAY'),
      hourlyChargeVisitRule('Sunday charge', config.sunday.hourly, 25, 'SUNDAY'),
    )
  }
  if (config.bankHoliday) {
    rules.push(
      ...fixedChargeDurationRules('Bank holiday charge', config.bankHoliday.fixed, 30, 'BANK_HOLIDAY'),
      hourlyChargeVisitRule('Bank holiday charge', config.bankHoliday.hourly, 35, 'BANK_HOLIDAY'),
    )
  }
  return rules
}

/** Birdie / Nourish-style charge cards for LA, NHS, direct payment, and private pay. */
export const CHARGE_CARD_PRESETS: ChargeCardPreset[] = [
  {
    name: 'Private Client — Fixed Visit Rates',
    code: 'CHG-STD-UK-2026',
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentLabel: 'Organisation default',
    billingFrequency: 'WEEKLY',
    paymentTerms: 'Due on receipt',
    taxTreatment: 'VAT exempt',
    defaultChargeMethod: 'FIXED_VISIT',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: `Fixed charge up to 60 min; hourly for longer visits.
Weekday: 15m £21 · 30m £26 · 45m £29 · 60m £32 · over 1 hr £24/hr.
Example — 4 × 15 min = £84 billed; 6 hr visit = £144.`,
    rules: buildStandardFixedChargeRules(),
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
    defaultChargeMethod: 'FIXED_VISIT',
    status: 'ACTIVE',
    effectiveFrom: '2026-04-01',
    effectiveTo: '2027-03-31',
    notes: 'Typical London borough LA schedule — fixed slots up to 60 min, hourly beyond.',
    rules: buildVisitChargeRules({
      weekday: {
        fixed: { m15: 6.5, m30: 12.5, m45: 18.75, m60: 24.5 },
        hourly: 24.5,
      },
      saturday: {
        fixed: { m15: 6.75, m30: 13.5, m45: 20.25, m60: 27.0 },
        hourly: 27.0,
      },
      sunday: {
        fixed: { m15: 7.25, m30: 14.5, m45: 21.75, m60: 29.0 },
        hourly: 29.0,
      },
      bankHoliday: {
        fixed: { m15: 8.0, m30: 16.0, m45: 24.0, m60: 32.0 },
        hourly: 32.0,
      },
    }),
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
    defaultChargeMethod: 'FIXED_VISIT',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'NHS CHC — fixed slots up to 60 min, hourly for longer visits.',
    rules: buildVisitChargeRules({
      weekday: {
        fixed: { m15: 6.5, m30: 12.75, m45: 18.94, m60: 25.0 },
        hourly: 25.0,
      },
      bankHoliday: {
        fixed: { m15: 7.88, m30: 15.75, m45: 23.63, m60: 31.5 },
        hourly: 31.5,
      },
    }),
  },
  {
    name: 'Direct Payment — Standard',
    code: 'CHG-DP-2026',
    assignmentLevel: 'FUNDER',
    funderCodeHint: 'DIRECT_PAYMENT_FUNDER',
    assignmentLabel: 'Funder: Direct Payment',
    billingFrequency: 'FOUR_WEEKLY',
    paymentTerms: 'Due on receipt',
    defaultChargeMethod: 'FIXED_VISIT',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Direct payment clients — mirrors LA rate card with self-pay invoicing.',
    rules: buildVisitChargeRules({
      weekday: {
        fixed: { m15: 6.13, m30: 12.0, m45: 17.81, m60: 23.5 },
        hourly: 23.5,
      },
      saturday: {
        fixed: { m15: 6.63, m30: 13.25, m45: 19.88, m60: 26.5 },
        hourly: 26.5,
      },
      sunday: {
        fixed: { m15: 7.13, m30: 14.25, m45: 21.38, m60: 28.5 },
        hourly: 28.5,
      },
      bankHoliday: {
        fixed: { m15: 7.5, m30: 15.0, m45: 22.5, m60: 30.0 },
        hourly: 30.0,
      },
    }),
  },
  {
    name: 'Private Client — Premium',
    code: 'CHG-PVT-PREM-2026',
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentLabel: 'Premium private pay',
    billingFrequency: 'WEEKLY',
    paymentTerms: 'Due on receipt',
    taxTreatment: 'VAT exempt',
    defaultChargeMethod: 'FIXED_VISIT',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Higher-rate private clients — assign explicitly on service user or funding record.',
    rules: buildVisitChargeRules({
      weekday: {
        fixed: { m15: 8.5, m30: 16.5, m45: 24.38, m60: 32.0 },
        hourly: 32.0,
      },
      saturday: {
        fixed: { m15: 9.0, m30: 18.0, m45: 27.0, m60: 36.0 },
        hourly: 36.0,
      },
      sunday: {
        fixed: { m15: 9.5, m30: 19.0, m45: 28.5, m60: 38.0 },
        hourly: 38.0,
      },
      bankHoliday: {
        fixed: { m15: 10.5, m30: 21.0, m45: 31.5, m60: 42.0 },
        hourly: 42.0,
      },
    }),
  },
  {
    name: 'Complex Care — Service Type',
    code: 'CHG-CPLX-2026',
    assignmentLevel: 'SERVICE_TYPE',
    assignmentTargetKey: 'Complex care',
    assignmentLabel: 'Service type: Complex care',
    billingFrequency: 'WEEKLY',
    defaultChargeMethod: 'FIXED_VISIT',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Complex / double-up care — fixed up to 60 min; £20/hr for visits over 1 hour (e.g. 6 hr = £120).',
    rules: buildVisitChargeRules({
      weekday: {
        fixed: { m15: 8.0, m30: 15.5, m45: 22.88, m60: 30.0 },
        hourly: 20.0,
      },
      bankHoliday: {
        fixed: { m15: 9.5, m30: 19.0, m45: 28.5, m60: 38.0 },
        hourly: 24.0,
      },
    }),
  },
  {
    name: 'London Branch — LA Uplift',
    code: 'CHG-LON-BRN-2026',
    assignmentLevel: 'BRANCH_REGION',
    branchNameHint: 'London',
    assignmentLabel: 'Branch: London',
    billingFrequency: 'FOUR_WEEKLY',
    paymentTerms: 'Net 30',
    defaultChargeMethod: 'FIXED_VISIT',
    status: 'ACTIVE',
    effectiveFrom: '2026-04-01',
    notes: 'London borough uplift when branch is set on the service user record.',
    rules: buildVisitChargeRules({
      weekday: {
        fixed: { m15: 6.63, m30: 13.0, m45: 19.31, m60: 25.5 },
        hourly: 25.5,
      },
      bankHoliday: {
        fixed: { m15: 8.25, m30: 16.5, m45: 24.75, m60: 33.0 },
        hourly: 33.0,
      },
    }),
  },
  {
    name: 'Live-in Care Package',
    code: 'CHG-LIV-PKG-2026',
    assignmentLevel: 'CARE_PACKAGE',
    assignmentTargetKey: 'Live-in',
    assignmentLabel: 'Care package: Live-in',
    billingFrequency: 'WEEKLY',
    paymentTerms: 'Due on receipt',
    defaultChargeMethod: 'FIXED_VISIT',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Live-in day-off cover — fixed up to 60 min, hourly for longer cover visits.',
    rules: [
      ...fixedChargeDurationRules('Day-off cover', { m15: 7.5, m30: 15.0, m45: 22.5, m60: 30.0 }, 0),
      hourlyChargeVisitRule('Day-off cover', 20.0, 5),
    ],
  },
]
