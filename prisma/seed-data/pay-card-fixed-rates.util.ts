import type { PayCardPresetRule } from './pay-card-preset.types'
import {
  STANDARD_FIXED_PAY_RATES,
  STANDARD_HOURLY_PAY_RATES,
  type FixedVisitAmounts,
} from './fixed-visit-rates.seed-data'

const DURATION_SLOTS: Array<{ minutes: number; key: keyof FixedVisitAmounts }> = [
  { minutes: 15, key: 'm15' },
  { minutes: 30, key: 'm30' },
  { minutes: 45, key: 'm45' },
  { minutes: 60, key: 'm60' },
]

export function fixedPayDurationRules(
  prefix: string,
  amounts: FixedVisitAmounts,
  startOrder: number,
  dayType: PayCardPresetRule['dayType'] = 'WEEKDAY',
): PayCardPresetRule[] {
  return DURATION_SLOTS.map(({ minutes, key }, index) => ({
    label: `${prefix} — ${minutes} minutes`,
    dayType,
    rateType: 'FIXED' as const,
    amount: amounts[key],
    minimumMinutes: minutes,
    sortOrder: startOrder + index,
  }))
}

export function hourlyPayVisitRule(
  prefix: string,
  hourlyRate: number,
  sortOrder: number,
  dayType: PayCardPresetRule['dayType'] = 'WEEKDAY',
): PayCardPresetRule {
  return {
    label: `${prefix} — hourly (over 1 hour)`,
    dayType,
    rateType: 'HOURLY',
    amount: hourlyRate,
    sortOrder,
  }
}

export function buildStandardFixedPayRules(): PayCardPresetRule[] {
  const p = STANDARD_FIXED_PAY_RATES
  const h = STANDARD_HOURLY_PAY_RATES
  return [
    ...fixedPayDurationRules('Weekday visit', p.visit, 0),
    hourlyPayVisitRule('Weekday visit', h.visit, 5),
    ...fixedPayDurationRules('Saturday visit', p.saturdayVisit, 10, 'SATURDAY'),
    hourlyPayVisitRule('Saturday visit', h.saturdayVisit, 15, 'SATURDAY'),
    ...fixedPayDurationRules('Sunday visit', p.sundayVisit, 20, 'SUNDAY'),
    hourlyPayVisitRule('Sunday visit', h.sundayVisit, 25, 'SUNDAY'),
    ...fixedPayDurationRules('Bank holiday visit', p.bankHolidayVisit, 30, 'BANK_HOLIDAY'),
    hourlyPayVisitRule('Bank holiday visit', h.bankHolidayVisit, 35, 'BANK_HOLIDAY'),
    { label: 'Travel time between visits', dayType: 'ANY', rateType: 'TRAVEL_TIME', amount: 22, sortOrder: 40 },
    { label: 'Mileage reimbursement', dayType: 'ANY', rateType: 'MILEAGE', amount: 0.45, sortOrder: 41 },
  ]
}
