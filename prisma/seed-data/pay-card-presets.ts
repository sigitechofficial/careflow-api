/**
 * UK domiciliary care pay card presets aligned with Birdie, Nourish Empower, and
 * Homecare Association 2025–26 benchmarks (NLW £12.21, London LW £13.85, sleep-in
 * vs waking night, travel/mileage supplements).
 */

import { buildStandardFixedPayRules } from './pay-card-fixed-rates.util'
import { PAY_CARD_COMPLETE_UK_2026 } from './pay-card-complete-preset'
import type { PayCardPreset, PayCardPresetRule } from './pay-card-preset.types'

export type { PayCardPreset, PayCardPresetRule } from './pay-card-preset.types'

/** Birdie / HCA baseline — NLW £12.21 (2025–26), weekend and bank holiday uplifts. */
export const PAY_CARD_PRESETS: PayCardPreset[] = [
  PAY_CARD_COMPLETE_UK_2026,
  {
    name: 'Standard Carer Pay — Fixed Visit Rates',
    code: 'PAY-STD-UK-2026',
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentLabel: 'Organisation default',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: `Fixed pay per visit up to 60 min; hourly for longer visits.
Weekday: 15m £14 · 30m £17 · 45m £19 · 60m £22 · over 1 hr £20/hr.
Example — 4 × 15 min = £56 carer pay; 6 hr visit = £120.`,
    rules: buildStandardFixedPayRules(),
  },
  {
    name: 'Standard Carer Pay — London',
    code: 'PAY-LON-2026',
    assignmentLevel: 'BRANCH',
    branchNameHint: 'London',
    assignmentLabel: 'Branch: London',
    status: 'ACTIVE',
    effectiveFrom: '2026-04-01',
    notes: 'Birdie London LW benchmark £13.85/hr with time-of-day bands (Nourish-style).',
    rules: [
      {
        label: 'Weekday day',
        dayType: 'WEEKDAY',
        startTime: '07:00',
        endTime: '19:00',
        rateType: 'HOURLY',
        amount: 13.85,
        sortOrder: 0,
      },
      {
        label: 'Weekday evening',
        dayType: 'WEEKDAY',
        startTime: '19:00',
        endTime: '22:00',
        rateType: 'HOURLY',
        amount: 14.5,
        sortOrder: 1,
      },
      {
        label: 'Night (waking)',
        dayType: 'ANY',
        startTime: '22:00',
        endTime: '07:00',
        rateType: 'HOURLY',
        amount: 15.5,
        sortOrder: 2,
      },
      { label: 'Saturday', dayType: 'SATURDAY', rateType: 'HOURLY', amount: 15.5, sortOrder: 3 },
      { label: 'Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 16.5, sortOrder: 4 },
      { label: 'Bank holiday', dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 18.0, sortOrder: 5 },
    ],
  },
  {
    name: 'Internal Staff Pay',
    code: 'PAY-INT-2026',
    assignmentLevel: 'WORKER_TYPE',
    assignmentTargetKey: 'INTERNAL',
    assignmentLabel: 'Worker type: Internal',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Nourish Empower — employed carers on payroll.',
    rules: [
      { label: 'Standard hourly', dayType: 'WEEKDAY', rateType: 'HOURLY', amount: 12.6, sortOrder: 0 },
      { label: 'Real Living Wage uplift', dayType: 'WEEKDAY', rateType: 'PREMIUM', amount: 12.6, sortOrder: 1 },
      { label: 'Saturday', dayType: 'SATURDAY', rateType: 'HOURLY', amount: 14.25, sortOrder: 2 },
      { label: 'Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 15.25, sortOrder: 3 },
    ],
  },
  {
    name: 'Agency Worker Pay',
    code: 'PAY-AGY-2026',
    assignmentLevel: 'WORKER_TYPE',
    assignmentTargetKey: 'AGENCY',
    assignmentLabel: 'Worker type: Agency',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Typical agency worker buy-in rate (Birdie / Access).',
    rules: [
      { label: 'Agency hourly', dayType: 'ANY', rateType: 'HOURLY', amount: 11.5, sortOrder: 0 },
      { label: 'Agency weekend', dayType: 'SATURDAY', rateType: 'HOURLY', amount: 13.0, sortOrder: 1 },
      { label: 'Agency Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 14.0, sortOrder: 2 },
    ],
  },
  {
    name: 'Bank Staff Pay',
    code: 'PAY-BNK-2026',
    assignmentLevel: 'WORKER_TYPE',
    assignmentTargetKey: 'BANK',
    assignmentLabel: 'Worker type: Bank',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Bank / zero-hours pool — Nourish-style flexible worker rate.',
    rules: [
      { label: 'Bank weekday', dayType: 'WEEKDAY', rateType: 'HOURLY', amount: 12.25, sortOrder: 0 },
      { label: 'Bank Saturday', dayType: 'SATURDAY', rateType: 'HOURLY', amount: 14.0, sortOrder: 1 },
      { label: 'Bank Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 15.0, sortOrder: 2 },
    ],
  },
  {
    name: 'Sleep-in & Waking Night',
    code: 'PAY-NGT-2026',
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentLabel: 'Night visits',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes:
      'Sleep-in flat fee (awake time paid at hourly) + waking night full rate — Birdie / UK case law pattern.',
    rules: [
      {
        label: 'Sleep-in shift fee',
        dayType: 'ANY',
        startTime: '22:00',
        endTime: '07:00',
        rateType: 'FIXED',
        amount: 62.5,
        sortOrder: 0,
      },
      {
        label: 'Sleep-in awake (hourly)',
        dayType: 'ANY',
        rateType: 'HOURLY',
        amount: 12.21,
        minimumMinutes: 15,
        sortOrder: 1,
      },
      {
        label: 'Waking night hourly',
        dayType: 'ANY',
        startTime: '22:00',
        endTime: '07:00',
        rateType: 'HOURLY',
        amount: 14.75,
        sortOrder: 2,
      },
    ],
  },
  {
    name: 'Senior Carer Premium',
    code: 'PAY-SNR-2026',
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentLabel: 'Senior / team leader uplift',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Senior carer uplift over NLW — assign explicitly on employment record.',
    rules: [
      { label: 'Senior weekday', dayType: 'WEEKDAY', rateType: 'HOURLY', amount: 13.5, sortOrder: 0 },
      { label: 'Senior Saturday', dayType: 'SATURDAY', rateType: 'HOURLY', amount: 15.5, sortOrder: 1 },
      { label: 'Senior Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 16.5, sortOrder: 2 },
      { label: 'Senior bank holiday', dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 18.5, sortOrder: 3 },
    ],
  },
  {
    name: 'Live-in Carer Package',
    code: 'PAY-LIV-2026',
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentLabel: 'Live-in weekly package',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    notes: 'Live-in weekly package pay — common in private pay Birdie/Nourish setups.',
    rules: [
      { label: 'Live-in weekly rate', dayType: 'ANY', rateType: 'FIXED', amount: 650, sortOrder: 0 },
      { label: 'Live-in day off cover', dayType: 'ANY', rateType: 'HOURLY', amount: 14.0, sortOrder: 1 },
    ],
  },
]
