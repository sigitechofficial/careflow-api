/**
 * Time-band enhancement engine for carer pay.
 * Splits payable activities across day/time bands and applies absolute, plus, %, or multiplier rates.
 */

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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatHhMmUtc(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
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

export function resolveCalendarDayType(date: Date): 'WEEKDAY' | 'SATURDAY' | 'SUNDAY' {
  const day = date.getUTCDay();
  if (day === 0) return 'SUNDAY';
  if (day === 6) return 'SATURDAY';
  return 'WEEKDAY';
}

export function resolveSpecialDay(
  date: Date,
  opts?: {
    isBankHoliday?: boolean;
    specialDays?: Array<{ date: string; kind: PaySpecialDay }>;
  },
): PaySpecialDay {
  const ymd = date.toISOString().slice(0, 10);
  const fromList = opts?.specialDays?.find((s) => s.date === ymd)?.kind;
  if (fromList && fromList !== 'NONE') return fromList;

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (month === 12 && day === 25) return 'CHRISTMAS';
  if (month === 12 && day === 26) return 'BOXING_DAY';
  if (month === 1 && day === 1) return 'NEW_YEAR';
  if (opts?.isBankHoliday) return 'BANK_HOLIDAY';
  return 'NONE';
}

/**
 * Whether a wall-clock minute falls in [start, end), supporting overnight bands (22:00–06:00).
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
  const e = end.hours * 60 + end.minutes;
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

function ruleSpecificity(rule: TimeBandRule): number {
  let score = 0;
  if (rule.startTime || rule.endTime) score += 10;
  const dayIdx = DAY_TYPE_PRIORITY.indexOf(rule.dayType);
  score += dayIdx >= 0 ? (DAY_TYPE_PRIORITY.length - dayIdx) : 0;
  score += (rule.priority ?? 0) * 100;
  return score;
}

/**
 * Collect boundaries (UTC) where bands or calendar days change within [start, end).
 */
export function collectBandBoundaries(
  start: Date,
  end: Date,
  rules: TimeBandRule[],
): Date[] {
  const points = new Set<number>();
  points.add(start.getTime());
  points.add(end.getTime());

  // Midnight UTC splits
  let cursor = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  while (cursor.getTime() < end.getTime()) {
    points.add(cursor.getTime());
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  for (const rule of rules) {
    for (const t of [rule.startTime, rule.endTime]) {
      if (!t) continue;
      const parsed = parseHhMm(t);
      if (!parsed) continue;
      let day = new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate(),
        parsed.hours,
        parsed.minutes,
        0, 0,
      ));
      // Walk days covering the activity
      const lastDay = new Date(Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth(),
        end.getUTCDate(),
        0, 0, 0, 0,
      ));
      while (day.getTime() <= lastDay.getTime() + 24 * 60 * 60 * 1000) {
        if (day.getTime() > start.getTime() && day.getTime() < end.getTime()) {
          points.add(day.getTime());
        }
        day = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      }
    }
  }

  return [...points].sort((a, b) => a - b).map((t) => new Date(t));
}

export function splitIntoTimeSegments(
  start: Date,
  end: Date,
  rules: TimeBandRule[],
  opts?: {
    isBankHolidayFn?: (d: Date) => boolean;
    specialDays?: Array<{ date: string; kind: PaySpecialDay }>;
  },
): TimeSegment[] {
  if (end.getTime() <= start.getTime()) return [];
  const boundaries = collectBandBoundaries(start, end, rules);
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
    });
    const calendar = resolveCalendarDayType(segStart);
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
  // 1) Explicit all-day base (no clock window)
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

  // 2) Weekday daytime window (07:00–19:00) as natural base when every rate is period-scoped
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

  // 3) Any absolute hourly
  const anyHourly = rules.find(
    (r) =>
      r.rateType === 'HOURLY' &&
      (r.enhancementMethod == null || r.enhancementMethod === 'ABSOLUTE_HOURLY'),
  );
  return anyHourly ? Number(anyHourly.amount) : 0;
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
): TimeBandRule[] {
  const midMinute = minutesOfDayUtc(
    new Date(segment.start.getTime() + Math.floor((segment.minutes * 60_000) / 2)),
  );
  return rules.filter((rule) => {
    if (!isVisitHourlyRule(rule)) return false;
    if (!dayTypeMatchesRule(rule.dayType, resolveCalendarDayType(segment.start), segment.specialDay)) {
      return false;
    }
    return minuteInTimeBand(midMinute, rule.startTime, rule.endTime);
  });
}

function chooseRulesByPolicy(
  candidates: TimeBandRule[],
  stackingPolicy: PayStackingPolicy,
): TimeBandRule[] {
  if (!candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => {
    const spec = ruleSpecificity(b) - ruleSpecificity(a);
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
    const base = pickBaseHourlyRate(candidates);
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
}): BandedPayResult | null {
  const {
    start,
    end,
    rules,
    stackingPolicy = 'PRIORITY',
    baseRateOverride,
    isBankHolidayFn,
    specialDays,
  } = input;

  const segments = splitIntoTimeSegments(start, end, rules, { isBankHolidayFn, specialDays });
  if (!segments.length) return null;

  const baseRate = baseRateOverride ?? pickBaseHourlyRate(rules);
  const segmentResults: SegmentPayResult[] = [];

  for (const segment of segments) {
    const matches = matchingHourlyRulesForSegment(rules, segment);
    const chosen = chooseRulesByPolicy(matches, stackingPolicy);

    let rate = baseRate;
    let label: string | null = null;
    let shiftAllowance = 0;
    const parts: string[] = [];

    if (!chosen.length) {
      parts.push(`base £${baseRate.toFixed(2)}/hr`);
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
      explanation: `${formatHhMmUtc(segment.start)}–${formatHhMmUtc(segment.end)} (${segment.minutes}m) @ £${rate.toFixed(2)}/hr${
        shiftAllowance > 0 ? ` + £${shiftAllowance.toFixed(2)} allowance` : ''
      } [${parts.join('; ')}]`,
    });
  }

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
 * Avoids fixed short-visit rates silently ignoring evening/weekend uplifts.
 */
export function shouldPreferBandedOverFixed(rules: TimeBandRule[]): boolean {
  return hasTimeBandedHourlyRules(rules) && pickBaseHourlyRate(rules) > 0;
}
