/**
 * Fixed (non-pro-rata) visit rates for visits up to 60 minutes.
 * Visits longer than 60 minutes use the hourly rates below (rate × hours).
 */

export const MAX_FIXED_VISIT_MINUTES = 60

export const STANDARD_FIXED_PAY_RATES = {
  visit: {
    m15: 14,
    m30: 17,
    m45: 19,
    m60: 22,
  },
  saturdayVisit: {
    m15: 15,
    m30: 19,
    m45: 21,
    m60: 24,
  },
  sundayVisit: {
    m15: 16,
    m30: 20,
    m45: 22,
    m60: 25,
  },
  bankHolidayVisit: {
    m15: 18,
    m30: 22,
    m45: 24,
    m60: 28,
  },
} as const

export const STANDARD_FIXED_CHARGE_RATES = {
  visit: {
    m15: 21,
    m30: 26,
    m45: 29,
    m60: 32,
  },
  saturdayVisit: {
    m15: 23,
    m30: 28,
    m45: 31,
    m60: 35,
  },
  sundayVisit: {
    m15: 25,
    m30: 30,
    m45: 33,
    m60: 37,
  },
  bankHolidayVisit: {
    m15: 27,
    m30: 32,
    m45: 36,
    m60: 40,
  },
} as const

/** Hourly rate applied when visit duration exceeds 60 minutes. */
export const STANDARD_HOURLY_PAY_RATES = {
  visit: 20,
  saturdayVisit: 22,
  sundayVisit: 23,
  bankHolidayVisit: 28,
} as const

export const STANDARD_HOURLY_CHARGE_RATES = {
  visit: 24,
  saturdayVisit: 26,
  sundayVisit: 28,
  bankHolidayVisit: 32,
} as const

export type FixedVisitAmounts = {
  m15: number
  m30: number
  m45: number
  m60: number
}
