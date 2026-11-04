/**
 * Time-band enhancement engine for carer pay.
 * Splits payable activities across day/time bands and applies absolute, plus, %, or multiplier rates.
 *
 * Clock bands (e.g. 07:00–19:00) are interpreted in the organisation operational timezone
 * (OrganisationGeneralSettings.timezone), not UTC — otherwise local visits miss daytime rules by the offset.
 */

import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  combineOperationalDateAndHm,
  dayKeyInTimeZone,
  formatHmInTimeZone,
  startOfOperationalDayUtc,
} from '../common/utils/operational-day.util';

export type PayStackingPolicy = 'PRIORITY' | 'HIGHEST' | 'STACK';

export type PayEnhancementMethod =
  | 'ABSOLUTE_HOURLY'
  | 'ADDITIONAL_PER_HOUR'
  | 'PERCENTAGE_UPLIFT'
  | 'MULTIPLIER'
  | 'FIXED_SHIFT_ALLOWANCE';

export type PaySpecialDay =
  | 'NONE'
  | 'BANK_HOLIDAY'
  | 'CHRISTMAS'
  | 'BOXING_DAY'
  | 'NEW_YEAR'
  | 'EASTER'
  | 'SPECIAL';

export type TimeBandRule = {
  label?: string | null;
  dayType: string;
  startTime?: string | null;
  endTime?: string | null;
  rateType: string;
  amount: number;
  multiplier?: number | null;
  /** Extra £/hr when method is ADDITIONAL_PER_HOUR (falls back to amount for PREMIUM). */
  additionalAmount?: number | null;
  /** Percentage points when method is PERCENTAGE_UPLIFT (e.g. 25 = +25%). */
  percentageUplift?: number | null;
  enhancementMethod?: PayEnhancementMethod | null;
  minimumMinutes?: number | null;
  priority?: number;
  sortOrder?: number;
  /** Whether this banded rule applies to visits (default true). */
  appliesToVisit?: boolean;
  appliesToTravel?: boolean;
  appliesToWaiting?: boolean;
  appliesToTraining?: boolean;
};

export type TimeSegment = {
  start: Date;
  end: Date;
  minutes: number;
  dayType: string;
  specialDay: PaySpecialDay;
};

export type SegmentPayResult = {
  segment: TimeSegment;
  appliedHourlyRate: number;
  amount: number;
  ruleLabel: string | null;
  baseRate: number;
  explanation: string;
  /** Flat shift allowance included in amount (FIXED_SHIFT_ALLOWANCE). */
  shiftAllowance?: number;
};

export type BandedPayResult = {
  totalAmount: number;
  totalMinutes: number;
  segments: SegmentPayResult[];
  explanation: string;
};

const NON_BAND_RATE_TYPES = new Set([
  'MILEAGE',
  'TRAVEL_TIME',
  'WAITING_TIME',
  'PER_VISIT_FEE',
  'DEDUCTION',
  'FIXED',
]);

/** Priority ladder: lower index = higher precedence when stackingPolicy is PRIORITY. */
export const SPECIAL_DAY_PRIORITY: PaySpecialDay[] = [
  'CHRISTMAS',
  'BOXING_DAY',
  'NEW_YEAR',
  'EASTER',
  'SPECIAL',
  'BANK_HOLIDAY',
  'NONE',
];

export const DAY_TYPE_PRIORITY = [
  'CHRISTMAS',
  'BOXING_DAY',
  'NEW_YEAR',
  'EASTER',
  'SPECIAL',
  'BANK_HOLIDAY',
  'SUNDAY',
  'SATURDAY',
  'WEEKDAY',
  'ANY',
];

export function formatHhMmUtc(d: Date): string {
  return formatHmInTimeZone(d, 'UTC');
}

export function formatHhMmInZone(
  d: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  return formatHmInTimeZone(d, timeZone);
}

export function parseHhMm(value: string): { hours: number; minutes: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

export function minutesOfDayUtc(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function minutesOfDayInZone(
  d: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): number {
  const hm = formatHmInTimeZone(d, timeZone);
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function resolveCalendarDayType(
  date: Date,
  timeZone: string = 'UTC',
): 'WEEKDAY' | 'SATURDAY' | 'SUNDAY' {
  if (timeZone === 'UTC') {
    const day = date.getUTCDay();
    if (day === 0) return 'SUNDAY';
    if (day === 6) return 'SATURDAY';
    return 'WEEKDAY';
  }
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  if (weekday === 'Sun') return 'SUNDAY';
  if (weekday === 'Sat') return 'SATURDAY';
  return 'WEEKDAY';
}

/**
 * What the holiday calendar adds to a day's classification (PC-22 to PC-24).
 * - `specialDays`: the organisation's own special days (a card pays them where it has a rate).
 * - `fixedDates`: false when 25 and 26 December and 1 January are special only on the days the
 *   bank holiday calendar lists them (so not when they fall on a weekend). Default: by date.
 */
export type SpecialDayCalendar = {
  specialDays?: Array<{ date: string; kind: PaySpecialDay }>;
  fixedDates?: boolean;
  /** Organisation setting: priority per day type for carer pay (higher wins). Unset = built-in order. */
  dayTypePriority?: DayTypePriority;
};

/** Priority per day type (BillingDayType → number); higher wins when rules for different days compete. */
export type DayTypePriority = Partial<Record<string, number>>;

export function resolveSpecialDay(
  date: Date,
  opts?: SpecialDayCalendar & {
    isBankHoliday?: boolean;
    timeZone?: string;
  },
): PaySpecialDay {
  const timeZone = opts?.timeZone ?? 'UTC';
  const ymd =
    timeZone === 'UTC' ? date.toISOString().slice(0, 10) : dayKeyInTimeZone(date, timeZone);
  const fromList = opts?.specialDays?.find((s) => s.date === ymd)?.kind;
  if (fromList && fromList !== 'NONE') return fromList;

  if (opts?.fixedDates !== false || opts?.isBankHoliday) {
    const [, m, d] = ymd.split('-').map(Number);
    if (m === 12 && d === 25) return 'CHRISTMAS';
    if (m === 12 && d === 26) return 'BOXING_DAY';
    if (m === 1 && d === 1) return 'NEW_YEAR';
  }
  if (opts?.isBankHoliday) return 'BANK_HOLIDAY';
  return 'NONE';
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * True for a band end that means "to the end of the day". Screens cannot enter 24:00, so an
 * all-day or late band is stored with an end of 23:59; a missing end means the same.
 */
export function isEndOfDayBandEnd(endTime?: string | null): boolean {
  if (!endTime?.trim()) return true;
  const end = parseHhMm(endTime);
  return !!end && end.hours === 23 && end.minutes === 59;
}

/**
 * Whether a wall-clock minute falls in the half-open band [start, end), supporting overnight
 * bands (22:00–06:00). An end of 23:59 is the end of the day (24:00), so 00:00–23:59 covers every
 * minute of the day and 19:00–23:59 runs to midnight (PC-21).
 */
export function minuteInTimeBand(
  minuteOfDay: number,
  startTime?: string | null,
  endTime?: string | null,
): boolean {
  if (!startTime && !endTime) return true;
  const start = startTime ? parseHhMm(startTime) : { hours: 0, minutes: 0 };
  const end = endTime ? parseHhMm(endTime) : { hours: 23, minutes: 59 };
  if (!start || !end) return true;
  const s = start.hours * 60 + start.minutes;
  const e = isEndOfDayBandEnd(endTime) ? MINUTES_PER_DAY : end.hours * 60 + end.minutes;
  if (s === e) return true;
  if (s < e) return minuteOfDay >= s && minuteOfDay < e;
  // Overnight: e.g. 22:00–06:00
  return minuteOfDay >= s || minuteOfDay < e;
}

function dayTypeMatchesRule(
  ruleDayType: string,
  calendarDay: string,
  specialDay: PaySpecialDay,
): boolean {
  if (ruleDayType === 'ANY') return true;
  // An organisation special day is not a public holiday: only a rate for special days applies
  // to it, never the bank holiday rate (the calendar does not create a premium by itself).
  if (specialDay === 'SPECIAL' && ruleDayType === 'BANK_HOLIDAY') return false;
  if (
    specialDay !== 'NONE' &&
    (ruleDayType === specialDay ||
      (specialDay !== 'BANK_HOLIDAY' && ruleDayType === 'BANK_HOLIDAY' && SPECIAL_DAY_PRIORITY.indexOf(specialDay) <= SPECIAL_DAY_PRIORITY.indexOf('BANK_HOLIDAY')))
  ) {
    // Explicit special-day rule preferred; BANK_HOLIDAY also matches named specials if no better match later
    if (ruleDayType === specialDay) return true;
    // specialDay already narrowed away from 'NONE' in this branch
    if (ruleDayType === 'BANK_HOLIDAY') return true;
  }
  if (specialDay !== 'NONE' && ruleDayType === 'BANK_HOLIDAY') return true;
  if (ruleDayType === 'BANK_HOLIDAY' || SPECIAL_DAY_PRIORITY.includes(ruleDayType as PaySpecialDay)) {
    return false;
  }
  return ruleDayType === calendarDay;
}

function ruleSpecificity(rule: TimeBandRule, dayTypePriority?: DayTypePriority): number {
  let score = 0;
  // The organisation's day priority decides first; the rest only breaks ties within a day type.
  if (dayTypePriority) score += (dayTypePriority[rule.dayType] ?? 0) * 1_000_000;
  if (rule.startTime || rule.endTime) score += 10;
  const dayIdx = DAY_TYPE_PRIORITY.indexOf(rule.dayType);
  score += dayIdx >= 0 ? (DAY_TYPE_PRIORITY.length - dayIdx) : 0;
  score += (rule.priority ?? 0) * 100;
  return score;
}

/**
 * Collect boundaries where bands or calendar days change within [start, end).
 * Band clock times are interpreted in `timeZone` (UTC for legacy tests).
 */
export function collectBandBoundaries(
  start: Date,
  end: Date,
  rules: TimeBandRule[],
  timeZone: string = 'UTC',
): Date[] {
  const points = new Set<number>();
  points.add(start.getTime());
  points.add(end.getTime());

  if (timeZone === 'UTC') {
    let cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1, 0, 0, 0, 0),
    );
    while (cursor.getTime() < end.getTime()) {
      points.add(cursor.getTime());
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }

    for (const rule of rules) {
      for (const t of [rule.startTime, rule.endTime]) {
        if (!t) continue;
        // An end of 23:59 is midnight, which is already a boundary: no extra one-minute slice.
        if (t === rule.endTime && isEndOfDayBandEnd(t)) continue;
        const parsed = parseHhMm(t);
        if (!parsed) continue;
        let day = new Date(
          Date.UTC(
            start.getUTCFullYear(),
            start.getUTCMonth(),
            start.getUTCDate(),
            parsed.hours,
            parsed.minutes,
            0,
            0,
          ),
        );
        const lastDay = new Date(
          Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 0, 0, 0, 0),
        );
        while (day.getTime() <= lastDay.getTime() + 24 * 60 * 60 * 1000) {
          if (day.getTime() > start.getTime() && day.getTime() < end.getTime()) {
            points.add(day.getTime());
          }
          day = new Date(day.getTime() + 24 * 60 * 60 * 1000);
        }
      }
    }
  } else {
    // Operational midnights and band HH:mm instants in org TZ
    let dayKey = dayKeyInTimeZone(start, timeZone);
    const endDayKey = dayKeyInTimeZone(end, timeZone);
    for (let guard = 0; guard < 40; guard++) {
      const nextMidnight = startOfOperationalDayUtc(
        // add one day to dayKey
        (() => {
          const [y, m, d] = dayKey.split('-').map(Number);
          const dt = new Date(Date.UTC(y!, m! - 1, d!));
          dt.setUTCDate(dt.getUTCDate() + 1);
          return dt.toISOString().slice(0, 10);
        })(),
        timeZone,
      );
      if (nextMidnight.getTime() > start.getTime() && nextMidnight.getTime() < end.getTime()) {
        points.add(nextMidnight.getTime());
      }
      if (dayKey >= endDayKey) break;
      const [y, m, d] = dayKey.split('-').map(Number);
      const dt = new Date(Date.UTC(y!, m! - 1, d!));
      dt.setUTCDate(dt.getUTCDate() + 1);
      dayKey = dt.toISOString().slice(0, 10);
    }

    const startDay = dayKeyInTimeZone(start, timeZone);
    const endDay = dayKeyInTimeZone(end, timeZone);
    const days: string[] = [];
    {
      let cursor = startDay;
      for (let guard = 0; guard < 40; guard++) {
        days.push(cursor);
        if (cursor >= endDay) break;
        const [y, m, d] = cursor.split('-').map(Number);
        const dt = new Date(Date.UTC(y!, m! - 1, d!));
        dt.setUTCDate(dt.getUTCDate() + 1);
        cursor = dt.toISOString().slice(0, 10);
      }
    }
    for (const rule of rules) {
      for (const t of [rule.startTime, rule.endTime]) {
        if (!t?.trim()) continue;
        if (t === rule.endTime && isEndOfDayBandEnd(t)) continue;
        for (const day of days) {
          const instant = combineOperationalDateAndHm(day, t.trim(), timeZone);
          if (
            Number.isFinite(instant.getTime()) &&
            instant.getTime() > start.getTime() &&
            instant.getTime() < end.getTime()
          ) {
            points.add(instant.getTime());
          }
        }
      }
    }
  }

  return [...points].sort((a, b) => a - b).map((t) => new Date(t));
}

export function splitIntoTimeSegments(
  start: Date,
  end: Date,
  rules: TimeBandRule[],
  opts?: SpecialDayCalendar & {
    isBankHolidayFn?: (d: Date) => boolean;
    timeZone?: string;
  },
): TimeSegment[] {
  if (end.getTime() <= start.getTime()) return [];
  const timeZone = opts?.timeZone ?? 'UTC';
  const boundaries = collectBandBoundaries(start, end, rules, timeZone);
  const segments: TimeSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    const minutes = Math.max(0, Math.round((segEnd.getTime() - segStart.getTime()) / 60_000));
    if (minutes <= 0) continue;
    const isBh = opts?.isBankHolidayFn?.(segStart) ?? false;
    const specialDay = resolveSpecialDay(segStart, {
      isBankHoliday: isBh,
      specialDays: opts?.specialDays,
      fixedDates: opts?.fixedDates,
      timeZone,
    });
    const calendar = resolveCalendarDayType(segStart, timeZone);
    const dayType =
      specialDay === 'CHRISTMAS' ||
      specialDay === 'BOXING_DAY' ||
      specialDay === 'NEW_YEAR' ||
      specialDay === 'EASTER' ||
      specialDay === 'SPECIAL'
        ? specialDay
        : specialDay === 'BANK_HOLIDAY'
          ? 'BANK_HOLIDAY'
          : calendar;
    segments.push({ start: segStart, end: segEnd, minutes, dayType, specialDay });
  }
  return segments;
}

function isVisitHourlyRule(rule: TimeBandRule): boolean {
  if (NON_BAND_RATE_TYPES.has(rule.rateType)) return false;
  if (rule.appliesToVisit === false) return false;
  return rule.rateType === 'HOURLY' || rule.rateType === 'BANDED' || rule.rateType === 'UPLIFT' || rule.rateType === 'PREMIUM';
}

export function pickBaseHourlyRate(rules: TimeBandRule[]): number {
  // 1) Explicit all-day base (no clock window) — weekday / any only
  const openBases = rules.filter(
    (r) =>
      (r.rateType === 'HOURLY' || r.rateType === 'BANDED') &&
      !r.startTime &&
      !r.endTime &&
      (r.dayType === 'WEEKDAY' || r.dayType === 'ANY') &&
      (r.enhancementMethod == null || r.enhancementMethod === 'ABSOLUTE_HOURLY'),
  );
  if (openBases.length) {
    openBases.sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    return Number(openBases[0].amount);
  }

  // 2) Weekday / any daytime window as natural base when every rate is period-scoped
  const daytime = rules.filter(
    (r) =>
      (r.rateType === 'HOURLY' || r.rateType === 'BANDED') &&
      (r.dayType === 'WEEKDAY' || r.dayType === 'ANY') &&
      (r.enhancementMethod == null || r.enhancementMethod === 'ABSOLUTE_HOURLY') &&
      r.startTime &&
      r.endTime,
  );
  const preferredDay = daytime.find((r) => {
    const s = (r.startTime ?? '').trim();
    const e = (r.endTime ?? '').trim();
    return (s === '07:00' || s === '06:00' || s === '08:00') && (e === '19:00' || e === '18:00' || e === '20:00');
  });
  if (preferredDay) return Number(preferredDay.amount);
  if (daytime.length) {
    daytime.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return Number(daytime[0].amount);
  }

  // Never fall back to Saturday/Sunday-only (or other day-scoped) rates as a silent weekday base.
  return 0;
}

function resolveEnhancementMethod(rule: TimeBandRule): PayEnhancementMethod {
  if (rule.enhancementMethod) return rule.enhancementMethod;
  if (rule.rateType === 'PREMIUM') return 'ADDITIONAL_PER_HOUR';
  if (rule.rateType === 'UPLIFT' || (rule.multiplier != null && Number(rule.multiplier) > 0 && rule.multiplier !== 1)) {
    return 'MULTIPLIER';
  }
  if (rule.percentageUplift != null) return 'PERCENTAGE_UPLIFT';
  if (rule.additionalAmount != null) return 'ADDITIONAL_PER_HOUR';
  return 'ABSOLUTE_HOURLY';
}

export function applyEnhancement(
  baseRate: number,
  rule: TimeBandRule,
): { rate: number; method: PayEnhancementMethod; shiftAllowance: number } {
  const method = resolveEnhancementMethod(rule);
  const amount = Number(rule.amount);
  switch (method) {
    case 'ADDITIONAL_PER_HOUR': {
      const add = rule.additionalAmount != null ? Number(rule.additionalAmount) : amount;
      return { rate: baseRate + add, method, shiftAllowance: 0 };
    }
    case 'PERCENTAGE_UPLIFT': {
      const pct = rule.percentageUplift != null ? Number(rule.percentageUplift) : amount;
      return { rate: baseRate * (1 + pct / 100), method, shiftAllowance: 0 };
    }
    case 'MULTIPLIER': {
      const mult =
        rule.multiplier != null && Number(rule.multiplier) > 0
          ? Number(rule.multiplier)
          : amount > 0 && amount < 10
            ? amount
            : 1;
      return { rate: baseRate * mult, method, shiftAllowance: 0 };
    }
    case 'FIXED_SHIFT_ALLOWANCE':
      // Flat £ for working in this band; hourly pay still uses base (or absolute if stacked separately).
      return { rate: baseRate, method, shiftAllowance: amount };
    case 'ABSOLUTE_HOURLY':
    default:
      return { rate: amount, method, shiftAllowance: 0 };
  }
}

function matchingHourlyRulesForSegment(
  rules: TimeBandRule[],
  segment: TimeSegment,
  timeZone: string = 'UTC',
): TimeBandRule[] {
  const mid = new Date(segment.start.getTime() + Math.floor((segment.minutes * 60_000) / 2));
  const midMinute =
    timeZone === 'UTC' ? minutesOfDayUtc(mid) : minutesOfDayInZone(mid, timeZone);
  return rules.filter((rule) => {
    if (!isVisitHourlyRule(rule)) return false;
    if (
      !dayTypeMatchesRule(
        rule.dayType,
        resolveCalendarDayType(segment.start, timeZone),
        segment.specialDay,
      )
    ) {
      return false;
    }
    return minuteInTimeBand(midMinute, rule.startTime, rule.endTime);
  });
}

function chooseRulesByPolicy(
  candidates: TimeBandRule[],
  stackingPolicy: PayStackingPolicy,
  /** The card's base hourly rate (premiums / multipliers are applied to it). */
  baseRate: number,
  dayTypePriority?: DayTypePriority,
): TimeBandRule[] {
  if (!candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => {
    const spec = ruleSpecificity(b, dayTypePriority) - ruleSpecificity(a, dayTypePriority);
    if (spec !== 0) return spec;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  if (stackingPolicy === 'STACK') {
    // One absolute (or most specific) + all additives/multipliers that are not absolute replacements
    const primary = sorted[0];
    const extras = sorted.slice(1).filter((r) => {
      const m = resolveEnhancementMethod(r);
      return m !== 'ABSOLUTE_HOURLY';
    });
    return [primary, ...extras];
  }

  if (stackingPolicy === 'HIGHEST') {
    // Compare every candidate's effective rate on the card's base rate (not a base derived from the
    // segment's candidates, which made "+£/hr" and multiplier rules lose against absolute rates).
    const base = baseRate;
    let best = sorted[0];
    let bestRate = applyEnhancement(base, best).rate;
    for (const c of sorted) {
      const r = applyEnhancement(base, c).rate;
      if (r > bestRate) {
        best = c;
        bestRate = r;
      }
    }
    return [best];
  }

  // PRIORITY — most specific / highest priority wins alone
  return [sorted[0]];
}

export function calculateBandedPay(input: {
  start: Date;
  end: Date;
  rules: TimeBandRule[];
  stackingPolicy?: PayStackingPolicy;
  baseRateOverride?: number;
  isBankHolidayFn?: (d: Date) => boolean;
  specialDays?: Array<{ date: string; kind: PaySpecialDay }>;
  fixedDates?: boolean;
  /** IANA TZ for interpreting rule clock bands (default UTC for unit tests). */
  timeZone?: string;
  dayTypePriority?: DayTypePriority;
}): BandedPayResult | null {
  const {
    start,
    end,
    rules,
    stackingPolicy = 'PRIORITY',
    baseRateOverride,
    isBankHolidayFn,
    specialDays,
    fixedDates,
    timeZone = 'UTC',
    dayTypePriority,
  } = input;

  const segments = splitIntoTimeSegments(start, end, rules, {
    isBankHolidayFn,
    specialDays,
    fixedDates,
    timeZone,
  });
  if (!segments.length) return null;

  const baseRate = baseRateOverride ?? pickBaseHourlyRate(rules);
  const segmentResults: SegmentPayResult[] = [];
  let unmatchedSegments = 0;
  const formatHm = (d: Date) =>
    timeZone === 'UTC' ? formatHhMmUtc(d) : formatHhMmInZone(d, timeZone);

  for (const segment of segments) {
    const matches = matchingHourlyRulesForSegment(rules, segment, timeZone);
    const chosen = chooseRulesByPolicy(matches, stackingPolicy, baseRate, dayTypePriority);

    let rate = 0;
    let label: string | null = null;
    let shiftAllowance = 0;
    const parts: string[] = [];

    if (!chosen.length) {
      // No day/time rule covers this slice — do not silently reuse another day's base rate.
      unmatchedSegments += 1;
      parts.push('no matching rate for day/time');
    } else if (stackingPolicy === 'STACK' && chosen.length > 1) {
      let current = baseRate;
      for (const rule of chosen) {
        const applied = applyEnhancement(current, rule);
        if (applied.method === 'FIXED_SHIFT_ALLOWANCE') {
          shiftAllowance += applied.shiftAllowance;
          parts.push(`${rule.label ?? rule.dayType} allowance £${applied.shiftAllowance.toFixed(2)}`);
        } else {
          current = applied.rate;
          parts.push(`${rule.label ?? rule.dayType}→£${current.toFixed(2)}`);
        }
        label = rule.label ?? label;
      }
      rate = current;
    } else {
      const rule = chosen[0];
      const applied = applyEnhancement(baseRate, rule);
      rate = applied.rate;
      shiftAllowance = applied.shiftAllowance;
      label = rule.label ?? null;
      if (applied.method === 'FIXED_SHIFT_ALLOWANCE') {
        parts.push(
          `${label ?? rule.dayType} base £${rate.toFixed(2)}/hr + shift allowance £${shiftAllowance.toFixed(2)}`,
        );
      } else {
        parts.push(`${label ?? rule.dayType} £${rate.toFixed(2)}/hr`);
      }
    }

    const hourlyPay = Math.round(rate * (segment.minutes / 60) * 100) / 100;
    const amount = Math.round((hourlyPay + shiftAllowance) * 100) / 100;
    segmentResults.push({
      segment,
      appliedHourlyRate: rate,
      amount,
      ruleLabel: label,
      baseRate,
      shiftAllowance: shiftAllowance > 0 ? shiftAllowance : undefined,
      explanation: `${formatHm(segment.start)}–${formatHm(segment.end)} (${segment.minutes}m) @ £${rate.toFixed(2)}/hr${
        shiftAllowance > 0 ? ` + £${shiftAllowance.toFixed(2)} allowance` : ''
      } [${parts.join('; ')}]`,
    });
  }

  // Entire activity unpaid when any slice has no matching rule (missing rate, not £0 from wrong day).
  if (unmatchedSegments > 0) return null;

  const totalAmount = Math.round(segmentResults.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const totalMinutes = segmentResults.reduce((s, r) => s + r.segment.minutes, 0);

  return {
    totalAmount,
    totalMinutes,
    segments: segmentResults,
    explanation: segmentResults.map((s) => s.explanation).join(' | '),
  };
}

/** True when any hourly rule has an explicit time window or premium/uplift method. */
export function hasTimeBandedHourlyRules(rules: TimeBandRule[]): boolean {
  return rules.some(
    (r) =>
      isVisitHourlyRule(r) &&
      (!!r.startTime ||
        !!r.endTime ||
        r.rateType === 'PREMIUM' ||
        r.rateType === 'UPLIFT' ||
        r.enhancementMethod === 'ADDITIONAL_PER_HOUR' ||
        r.enhancementMethod === 'PERCENTAGE_UPLIFT' ||
        r.enhancementMethod === 'MULTIPLIER' ||
        r.enhancementMethod === 'FIXED_SHIFT_ALLOWANCE' ||
        (r.dayType !== 'ANY' && r.dayType !== 'WEEKDAY')),
  );
}

/**
 * Prefer banded/premium engine when a base hourly exists and day/time premiums are configured.
 * Used for visits over 1 hour (or when no fixed duration slot matches). Short visits still
 * Fixed duration slots (≤ 60 minutes) take exact matches only in calculatePayableAmount;
 * otherwise hourly / banded pro-rata is used.
 */
export function shouldPreferBandedOverFixed(rules: TimeBandRule[]): boolean {
  return hasTimeBandedHourlyRules(rules) && pickBaseHourlyRate(rules) > 0;
}
