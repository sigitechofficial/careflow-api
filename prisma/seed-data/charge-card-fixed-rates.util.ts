import type { ChargeCardPresetRule } from './charge-card-preset.types'
import {
  STANDARD_FIXED_CHARGE_RATES,
  STANDARD_HOURLY_CHARGE_RATES,
  type FixedVisitAmounts,
} from './fixed-visit-rates.seed-data'

const DURATION_SLOTS: Array<{ minutes: number; key: keyof FixedVisitAmounts }> = [
  { minutes: 15, key: 'm15' },
  { minutes: 30, key: 'm30' },
  { minutes: 45, key: 'm45' },
  { minutes: 60, key: 'm60' },
]

export function fixedChargeDurationRules(
  prefix: string,
  amounts: FixedVisitAmounts,
  startOrder: number,
  dayType: ChargeCardPresetRule['dayType'] = 'WEEKDAY',
): ChargeCardPresetRule[] {
  return DURATION_SLOTS.map(({ minutes, key }, index) => ({
    label: `${prefix} — ${minutes} minutes`,
    dayType,
    rateType: 'FIXED' as const,
    chargeMethod: 'FIXED_VISIT' as const,
    amount: amounts[key],
    minimumMinutes: minutes,
    sortOrder: startOrder + index,
  }))
}

export function hourlyChargeVisitRule(
  prefix: string,
  hourlyRate: number,
  sortOrder: number,
  dayType: ChargeCardPresetRule['dayType'] = 'WEEKDAY',
): ChargeCardPresetRule {
  return {
    label: `${prefix} — hourly (over 1 hour)`,
    dayType,
    rateType: 'HOURLY',
    chargeMethod: 'HOURLY_PRO_RATA',
    amount: hourlyRate,
    sortOrder,
  }
}

export function buildStandardFixedChargeRules(): ChargeCardPresetRule[] {
  const c = STANDARD_FIXED_CHARGE_RATES
  const h = STANDARD_HOURLY_CHARGE_RATES
  return [
    ...fixedChargeDurationRules('Weekday charge', c.visit, 0),
    hourlyChargeVisitRule('Weekday charge', h.visit, 5),
    ...fixedChargeDurationRules('Saturday charge', c.saturdayVisit, 10, 'SATURDAY'),
    hourlyChargeVisitRule('Saturday charge', h.saturdayVisit, 15, 'SATURDAY'),
    ...fixedChargeDurationRules('Sunday charge', c.sundayVisit, 20, 'SUNDAY'),
    hourlyChargeVisitRule('Sunday charge', h.sundayVisit, 25, 'SUNDAY'),
    ...fixedChargeDurationRules('Bank holiday charge', c.bankHolidayVisit, 30, 'BANK_HOLIDAY'),
    hourlyChargeVisitRule('Bank holiday charge', h.bankHolidayVisit, 35, 'BANK_HOLIDAY'),
  ]
}
