/**

 * Master UK carer pay card — all rate components needed for visit pay, payroll supplements,

 * and expense reimbursement. Based on NLW £12.21 (2025–26) with typical domiciliary uplifts.

 *

 * Assign explicitly to a carer (not organisation default) — use as a complete template.

 */

import { fixedPayDurationRules, hourlyPayVisitRule } from './pay-card-fixed-rates.util'

import { STANDARD_FIXED_PAY_RATES, STANDARD_HOURLY_PAY_RATES } from './fixed-visit-rates.seed-data'

import type { PayCardPreset } from './pay-card-preset.types'



const BASE = 12.21

const p = STANDARD_FIXED_PAY_RATES

const h = STANDARD_HOURLY_PAY_RATES



export const PAY_CARD_COMPLETE_UK_2026: PayCardPreset = {

  name: 'Complete Carer Pay — UK Master Template',

  code: 'PAY-COMPLETE-UK-2026',

  assignmentLevel: 'ORGANISATION_DEFAULT',

  assignmentLabel: 'Complete template — assign explicitly to carer',

  status: 'ACTIVE',

  effectiveFrom: '2026-01-01',

  notes: `Master pay card covering all carer pay components per Care Billing Module v4.



Visit pay (matched by day type + exact visit duration):

• Weekday / Saturday / Sunday / bank holiday — fixed rates for 15, 30, 45, 60, 90 & 120 min visits

• Bank holiday optional 2× multiplier rule



Time-of-day bands (22:00–07:00 night, 19:00–22:00 evening):

• Evening and unsocial-hours premiums



Night & sleep-in:

• Sleep-in flat allowance, awake time during sleep-in, waking night hourly



Payroll supplements (applied at payroll / expense stage):

• Overtime (time-and-a-half), complex care premium, double-up premium

• Travel time, waiting time, mileage

• Call-out fee, training/shadowing rate



Assign this card to a carer profile to see every rate in one place.`,

  rules: [

    ...fixedPayDurationRules('Weekday visit', p.visit, 0),

    hourlyPayVisitRule('Weekday visit', h.visit, 5),

    ...fixedPayDurationRules('Saturday visit', p.saturdayVisit, 10, 'SATURDAY'),

    hourlyPayVisitRule('Saturday visit', h.saturdayVisit, 15, 'SATURDAY'),

    ...fixedPayDurationRules('Sunday visit', p.sundayVisit, 20, 'SUNDAY'),

    hourlyPayVisitRule('Sunday visit', h.sundayVisit, 25, 'SUNDAY'),

    ...fixedPayDurationRules('Bank holiday visit', p.bankHolidayVisit, 30, 'BANK_HOLIDAY'),

    hourlyPayVisitRule('Bank holiday visit', h.bankHolidayVisit, 35, 'BANK_HOLIDAY'),

    {

      label: 'Weekend — 2× uplift (multiplier)',

      dayType: 'SATURDAY',

      rateType: 'UPLIFT',

      amount: BASE,

      multiplier: 2,

      sortOrder: 36,

    },

    {

      label: 'Bank holiday — 2× uplift (multiplier)',

      dayType: 'BANK_HOLIDAY',

      rateType: 'UPLIFT',

      amount: BASE,

      multiplier: 2,

      sortOrder: 37,

    },



    // —— Time-of-day bands (20–24) ——

    {

      label: 'Weekday daytime (07:00–19:00)',

      dayType: 'WEEKDAY',

      startTime: '07:00',

      endTime: '19:00',

      rateType: 'HOURLY',

      amount: BASE,

      sortOrder: 20,

    },

    {

      label: 'Weekday evening (19:00–22:00)',

      dayType: 'WEEKDAY',

      startTime: '19:00',

      endTime: '22:00',

      rateType: 'HOURLY',

      amount: 13.5,

      sortOrder: 21,

    },

    {

      label: 'Night / unsocial hours (22:00–07:00)',

      dayType: 'ANY',

      startTime: '22:00',

      endTime: '07:00',

      rateType: 'HOURLY',

      amount: 15.5,

      sortOrder: 22,

    },

    {

      label: 'Night premium uplift',

      dayType: 'ANY',

      startTime: '22:00',

      endTime: '07:00',

      rateType: 'PREMIUM',

      amount: 3.29,

      sortOrder: 23,

    },



    // —— Sleep-in & waking night (40–44) ——

    {

      label: 'Sleep-in shift allowance',

      dayType: 'ANY',

      startTime: '22:00',

      endTime: '07:00',

      rateType: 'FIXED',

      amount: 62.5,

      sortOrder: 40,

    },

    {

      label: 'Sleep-in — awake time (15 min)',

      dayType: 'ANY',

      rateType: 'FIXED',

      amount: p.visit.m15,

      minimumMinutes: 15,

      sortOrder: 41,

    },

    {

      label: 'Waking night — hourly',

      dayType: 'ANY',

      startTime: '22:00',

      endTime: '07:00',

      rateType: 'HOURLY',

      amount: 14.75,

      sortOrder: 42,

    },

    {

      label: 'Waking night — fixed shift fee',

      dayType: 'ANY',

      startTime: '22:00',

      endTime: '07:00',

      rateType: 'FIXED',

      amount: 118.0,

      sortOrder: 43,

    },



    // —— Overtime & premiums (50–55) ——

    {

      label: 'Overtime — time-and-a-half',

      dayType: 'ANY',

      rateType: 'HOURLY',

      amount: 18.32,

      priority: 10,

      sortOrder: 50,

    },

    {

      label: 'Overtime — 1.5× uplift (multiplier)',

      dayType: 'ANY',

      rateType: 'UPLIFT',

      amount: BASE,

      multiplier: 1.5,

      priority: 10,

      sortOrder: 51,

    },

    {

      label: 'Complex care premium',

      dayType: 'ANY',

      rateType: 'PREMIUM',

      amount: 3.0,

      serviceType: 'Complex care',

      sortOrder: 52,

    },

    {

      label: 'Double-up — secondary carer',

      dayType: 'ANY',

      rateType: 'PREMIUM',

      amount: 2.0,

      serviceType: 'Double-up',

      sortOrder: 53,

    },

    {

      label: 'Shadowing / training visit',

      dayType: 'ANY',

      rateType: 'HOURLY',

      amount: BASE,

      serviceType: 'Training',

      sortOrder: 54,

    },



    // —— Travel, waiting, mileage (60–64) ——

    {

      label: 'Travel time between visits',

      dayType: 'ANY',

      rateType: 'TRAVEL_TIME',

      amount: BASE,

      sortOrder: 60,

    },

    {

      label: 'Waiting time (access delay)',

      dayType: 'ANY',

      rateType: 'WAITING_TIME',

      amount: BASE,

      sortOrder: 61,

    },

    {

      label: 'Mileage reimbursement',

      dayType: 'ANY',

      rateType: 'MILEAGE',

      amount: 0.45,

      sortOrder: 62,

    },

    {

      label: 'Passenger mileage (extra)',

      dayType: 'ANY',

      rateType: 'MILEAGE',

      amount: 0.05,

      sortOrder: 63,

    },



    // —— Fees & adjustments (70–72) ——

    {

      label: 'Call-out / per-visit fee',

      dayType: 'ANY',

      rateType: 'PER_VISIT_FEE',

      amount: 5.0,

      sortOrder: 70,

    },

    {

      label: 'Approved deduction (example)',

      dayType: 'ANY',

      rateType: 'DEDUCTION',

      amount: 0,

      sortOrder: 71,

    },

  ],

}

