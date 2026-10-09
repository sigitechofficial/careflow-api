/**
 * UK domiciliary care wage types. Codes are stable identifiers (seeded in `billing.WageType`);
 * `PAYCARD_SUPPORT` says how far each type is handled today, so the UI never implies automatic
 * calculation that does not exist yet.
 */
export const WAGE_TYPE_CODES = [
  'BASIC_HOURLY',
  'FIXED_SALARY',
  'PER_VISIT',
  'WEEKEND',
  'BANK_HOLIDAY',
  'NIGHT_SHIFT',
  'OVERTIME',
  'TRAVEL_TIME',
  'MILEAGE',
  'SLEEP_IN',
  'WAKING_NIGHT',
  'LIVE_IN',
  'ON_CALL',
  'TRAINING',
  'HOLIDAY_PAY',
  'SICK_PAY',
  'BONUS',
  'MANUAL_ADJUSTMENT',
] as const;
export type WageTypeCode = (typeof WAGE_TYPE_CODES)[number];

export type WageTypeSupport = {
  /** PAYCARD: configured as pay card rules and calculated on visits. UK_PAYROLL: handled in UK payroll. PARTIAL / PLANNED: not fully automatic yet. */
  level: 'PAYCARD' | 'PAY_ITEM' | 'UK_PAYROLL' | 'PARTIAL' | 'PLANNED';
  note: string;
};

export const PAYCARD_SUPPORT: Record<WageTypeCode, WageTypeSupport> = {
  BASIC_HOURLY: { level: 'PAYCARD', note: 'Hourly rules on the pay card, priced per approved visit minutes.' },
  FIXED_SALARY: { level: 'UK_PAYROLL', note: "Set on the carer's UK payroll pay agreement, not on the pay card." },
  PER_VISIT: { level: 'PAYCARD', note: 'Fixed visit-length rules (visits up to 1 hour).' },
  WEEKEND: { level: 'PAYCARD', note: 'Saturday / Sunday rules.' },
  BANK_HOLIDAY: { level: 'PAYCARD', note: "Bank holiday rules, using the pay card's nation calendar." },
  NIGHT_SHIFT: { level: 'PAYCARD', note: 'Night time-band rules, split at midnight and band edges.' },
  OVERTIME: { level: 'PAYCARD', note: 'Overtime rate with a weekly threshold; the premium is added in visit pay runs.' },
  TRAVEL_TIME: { level: 'PAYCARD', note: 'Travel time rule; paid on approved travel between visits in visit pay runs.' },
  MILEAGE: { level: 'PARTIAL', note: 'Calculated in visit pay runs; not yet included in employee payouts.' },
  SLEEP_IN: { level: 'PAYCARD', note: 'Sleeping night (£ per night) rule. Awake working time is not tracked yet.' },
  WAKING_NIGHT: { level: 'PAYCARD', note: 'Waking night (£ per hour) rule.' },
  LIVE_IN: { level: 'PAY_ITEM', note: 'Daily / weekly live-in rate on the pay card; days entered as pay items.' },
  ON_CALL: { level: 'PAYCARD', note: 'On-call rate on the pay card; paid for non-core activity marked on-call, or as pay items.' },
  TRAINING: { level: 'PAYCARD', note: 'Training rate on the pay card; paid for non-core activity marked "include in payroll", or as pay items.' },
  HOLIDAY_PAY: { level: 'PAY_ITEM', note: 'Entered as pay items (52-week average suggested), or rolled-up 12.07% if the pay card opts in.' },
  SICK_PAY: { level: 'PAY_ITEM', note: 'Entered as pay items linked to absence records; rate set by your sick pay policy.' },
  BONUS: { level: 'PAY_ITEM', note: 'Entered as pay items; needs a second approver.' },
  MANUAL_ADJUSTMENT: { level: 'PAY_ITEM', note: 'Positive or negative pay items with a reason; needs a second approver.' },
};

type ClassifiableRule = {
  rateType?: string | null;
  dayType?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

const HOLIDAY_DAY_TYPES = new Set(['BANK_HOLIDAY', 'CHRISTMAS', 'BOXING_DAY', 'NEW_YEAR', 'EASTER', 'SPECIAL']);

function clockMinutes(value?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Night band: crosses midnight, starts from 20:00, or is an early-morning band ending by 08:00. */
export function isNightTimeBand(startTime?: string | null, endTime?: string | null): boolean {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  if (start == null || end == null) return false;
  if (end <= start && !(start === 0 && end === 0)) return true;
  if (start >= 20 * 60) return true;
  return start < 6 * 60 && end <= 8 * 60 && !(start === 0 && end >= 23 * 60);
}

/** Wage type an existing pay card rule represents (derived — no data is stored or changed). */
export function classifyPayRule(rule: ClassifiableRule): WageTypeCode {
  switch (rule.rateType) {
    case 'MILEAGE':
      return 'MILEAGE';
    case 'TRAVEL_TIME':
    case 'WAITING_TIME':
      return 'TRAVEL_TIME';
    case 'SLEEP_IN':
      return 'SLEEP_IN';
    case 'WAKING_NIGHT':
      return 'WAKING_NIGHT';
    case 'FIXED':
    case 'PER_VISIT_FEE':
      return 'PER_VISIT';
    case 'OVERTIME':
      return 'OVERTIME';
    case 'ON_CALL':
      return 'ON_CALL';
    case 'TRAINING':
      return 'TRAINING';
    case 'LIVE_IN_DAILY':
    case 'LIVE_IN_WEEKLY':
      return 'LIVE_IN';
    default:
      break;
  }
  if (rule.dayType && HOLIDAY_DAY_TYPES.has(rule.dayType)) return 'BANK_HOLIDAY';
  if (rule.dayType === 'SATURDAY' || rule.dayType === 'SUNDAY') return 'WEEKEND';
  if (isNightTimeBand(rule.startTime, rule.endTime)) return 'NIGHT_SHIFT';
  return 'BASIC_HOURLY';
}
