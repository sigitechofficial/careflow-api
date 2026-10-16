import { Prisma, PayrollRunLineType } from '@prisma/client';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { pickBaseHourlyRate, type TimeBandRule } from './pay-time-band.util';

/**
 * Non-visit earnings ("pay items"): bonus, manual adjustment, holiday, sick, on-call, live-in, training.
 * Pay card rule rate types that price them: ON_CALL, TRAINING, LIVE_IN_DAILY, LIVE_IN_WEEKLY, OVERTIME.
 */
export type PayItemWageTypeCode =
  | 'ON_CALL'
  | 'LIVE_IN'
  | 'TRAINING'
  | 'HOLIDAY_PAY'
  | 'SICK_PAY'
  | 'BONUS'
  | 'MANUAL_ADJUSTMENT';

export type PayItemUnit = 'PERIOD' | 'DAY' | 'WEEK' | 'HOUR' | 'AMOUNT';

export type PayItemConfig = {
  lineType: PayrollRunLineType;
  /** Units the item may be entered in; AMOUNT = enter the £ amount directly. */
  units: PayItemUnit[];
  /** Pay card rule rate type that supplies the default rate for a unit. */
  cardRateType?: Partial<Record<PayItemUnit, string>>;
  allowNegative: boolean;
  /** Approver must be a different user from the creator. */
  requiresSecondApprover: boolean;
  /** Counts towards pay for the minimum wage check in the visit pay run. */
  includesInNmwPay: boolean;
  /** Hours count as working time for the minimum wage check. */
  countsAsNmwHours: boolean;
  /** Optional link to an existing record. */
  sourceTypes: Array<'EMPLOYEE_HOLIDAY' | 'EMPLOYEE_ABSENCE'>;
};

export const PAY_ITEM_CONFIG: Record<PayItemWageTypeCode, PayItemConfig> = {
  ON_CALL: {
    lineType: 'ON_CALL_STANDBY',
    units: ['PERIOD'],
    cardRateType: { PERIOD: 'ON_CALL' },
    allowNegative: false,
    requiresSecondApprover: false,
    includesInNmwPay: true,
    countsAsNmwHours: false,
    sourceTypes: [],
  },
  LIVE_IN: {
    lineType: 'LIVE_IN',
    units: ['DAY', 'WEEK'],
    cardRateType: { DAY: 'LIVE_IN_DAILY', WEEK: 'LIVE_IN_WEEKLY' },
    allowNegative: false,
    requiresSecondApprover: false,
    includesInNmwPay: true,
    countsAsNmwHours: false,
    sourceTypes: [],
  },
  TRAINING: {
    lineType: 'NON_VISIT_ACTIVITY',
    units: ['HOUR', 'AMOUNT'],
    cardRateType: { HOUR: 'TRAINING' },
    allowNegative: false,
    requiresSecondApprover: false,
    includesInNmwPay: true,
    countsAsNmwHours: true,
    sourceTypes: [],
  },
  HOLIDAY_PAY: {
    lineType: 'HOLIDAY_PAY',
    units: ['HOUR', 'DAY', 'AMOUNT'],
    allowNegative: false,
    requiresSecondApprover: false,
    // Holiday pay is not pay for working time in the minimum wage calculation.
    includesInNmwPay: false,
    countsAsNmwHours: false,
    sourceTypes: ['EMPLOYEE_HOLIDAY'],
  },
  SICK_PAY: {
    lineType: 'SICK_PAY',
    units: ['DAY', 'WEEK', 'AMOUNT'],
    allowNegative: false,
    requiresSecondApprover: false,
    includesInNmwPay: false,
    countsAsNmwHours: false,
    sourceTypes: ['EMPLOYEE_ABSENCE'],
  },
  BONUS: {
    lineType: 'BONUS',
    units: ['AMOUNT'],
    allowNegative: false,
    requiresSecondApprover: true,
    includesInNmwPay: true,
    countsAsNmwHours: false,
    sourceTypes: [],
  },
  MANUAL_ADJUSTMENT: {
    lineType: 'ADJUSTMENT',
    units: ['AMOUNT'],
    allowNegative: true,
    requiresSecondApprover: true,
    includesInNmwPay: true,
    countsAsNmwHours: false,
    sourceTypes: [],
  },
};

export function isPayItemWageType(code: string): code is PayItemWageTypeCode {
  return Object.prototype.hasOwnProperty.call(PAY_ITEM_CONFIG, code);
}

/**
 * Pay items the system writes itself and a person cannot enter by hand. A mileage correction is a
 * reimbursement: it is paid on a mileage line, outside wages and outside the minimum wage check.
 */
export const SYSTEM_PAY_ITEM_CONFIG: Record<string, PayItemConfig & { label: string }> = {
  // Q13: an approved payment for a visit that did not go ahead as planned. It is not pay for
  // time worked, so it never counts towards minimum wage pay or hours.
  DISRUPTION_PAY: {
    label: 'Cancelled / disrupted visit',
    lineType: 'CANCELLATION',
    units: ['AMOUNT'],
    allowNegative: false,
    requiresSecondApprover: true,
    includesInNmwPay: false,
    countsAsNmwHours: false,
    sourceTypes: [],
  },
  MILEAGE_CORRECTION: {
    label: 'Mileage correction',
    lineType: 'MILEAGE',
    units: ['AMOUNT'],
    allowNegative: true,
    requiresSecondApprover: true,
    includesInNmwPay: false,
    countsAsNmwHours: false,
    sourceTypes: [],
  },
};

/** Configuration of any pay item a pay run can pay, entered by hand or written by the system. */
export function payItemConfigOf(code: string): (PayItemConfig & { label?: string }) | null {
  if (isPayItemWageType(code)) return PAY_ITEM_CONFIG[code];
  return SYSTEM_PAY_ITEM_CONFIG[code] ?? null;
}

/** quantity × rate in decimal arithmetic, rounded half-up to pence. */
export function payItemAmount(quantity: Prisma.Decimal.Value, rate: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(quantity)
    .mul(new Prisma.Decimal(rate))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function roundPence(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Monday (YYYY-MM-DD) of the operational-timezone week containing `instant`. */
export function weekKeyInTimeZone(instant: Date, timeZone: string): string {
  const day = dayKeyInTimeZone(instant, timeZone);
  const d = new Date(`${day}T12:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export type OvertimeWeek = { weekKey: string; workedMinutes: number; overtimeMinutes: number };

/** Minutes above the weekly threshold per Monday–Sunday week. Only the excess is overtime. */
export function weeklyOvertime(
  shifts: Array<{ start: Date; minutes: number }>,
  thresholdMinutes: number,
  timeZone: string,
): OvertimeWeek[] {
  const byWeek = new Map<string, number>();
  for (const s of shifts) {
    if (!(s.minutes > 0)) continue;
    const key = weekKeyInTimeZone(s.start, timeZone);
    byWeek.set(key, (byWeek.get(key) ?? 0) + s.minutes);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, workedMinutes]) => ({
      weekKey,
      workedMinutes,
      overtimeMinutes: Math.max(0, workedMinutes - Math.max(0, thresholdMinutes)),
    }));
}

/**
 * Overtime premium per hour. Base pay for overtime minutes is already in visit pay, so only the
 * extra is paid here (never the full rate again): multiplier → base × (m − 1); +£/hr → £; absolute
 * overtime rate → rate − base.
 */
export function overtimePremiumPerHour(
  rule: { amount: Prisma.Decimal.Value; enhancementMethod?: string | null },
  baseRate: number,
): Prisma.Decimal {
  const amount = new Prisma.Decimal(rule.amount);
  const base = new Prisma.Decimal(baseRate || 0);
  let premium: Prisma.Decimal;
  switch (rule.enhancementMethod) {
    case 'ADDITIONAL_PER_HOUR':
      premium = amount;
      break;
    case 'ABSOLUTE_HOURLY':
      premium = amount.sub(base);
      break;
    case 'MULTIPLIER':
    default:
      premium = base.mul(amount.sub(1));
      break;
  }
  return premium.isNegative() ? new Prisma.Decimal(0) : premium.toDecimalPlaces(4);
}

/** Rolled-up holiday pay (12.07% of pay for hours worked). Only used when a card opts in. */
export const ROLLED_UP_HOLIDAY_RATE = new Prisma.Decimal('0.1207');

export function rolledUpHolidayPay(workedPay: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(workedPay).mul(ROLLED_UP_HOLIDAY_RATE).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

type CardRuleRow = {
  rateType: string;
  amount: Prisma.Decimal | number;
  dayType: string;
  startTime?: string | null;
  endTime?: string | null;
  enhancementMethod?: string | null;
  minimumMinutes?: number | null;
  priority?: number;
  sortOrder?: number;
  label?: string | null;
};

/** First rule of a rate type on the card (by display order). */
export function cardRuleOfType<T extends CardRuleRow>(rules: T[], rateType: string): T | null {
  return [...rules].filter((r) => r.rateType === rateType).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0] ?? null;
}

/** The card's weekday base hourly rate (same rule the engine applies premiums to). */
export function cardBaseHourlyRate(rules: CardRuleRow[]): number {
  return pickBaseHourlyRate(
    rules.map(
      (r) =>
        ({
          label: r.label ?? null,
          dayType: r.dayType,
          startTime: r.startTime ?? null,
          endTime: r.endTime ?? null,
          rateType: r.rateType,
          amount: Number(r.amount),
          enhancementMethod: (r.enhancementMethod ?? null) as TimeBandRule['enhancementMethod'],
          priority: r.priority,
          sortOrder: r.sortOrder,
        }) as TimeBandRule,
    ),
  );
}
