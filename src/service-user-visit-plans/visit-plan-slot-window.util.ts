import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  addDaysToOperationalIso,
  combineOperationalDateAndHm,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';

const DAY_MS = 86400000;
const HM_RE = /^(\d{2}):(\d{2})$/;

export type SlotTimeWindowInput = {
  plannedStartTime: string;
  plannedEndTime: string;
  durationMinutes?: number | null;
  slotKind?: 'STANDARD' | 'OVERNIGHT' | 'ONE_OFF';
};

export type ResolvedVisitWindow = {
  start: Date;
  end: Date;
  durationMinutes: number;
  isOvernight: boolean;
};

export function parseHm(time: string): { hours: number; minutes: number } {
  const m = HM_RE.exec(time.trim());
  if (!m) throw new Error(`Invalid time (HH:mm): ${time}`);
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

function dayIsoFromUtcCalendarDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/**
 * Combine a UTC-midnight calendar day + HH:mm wall clock in the org timezone
 * into a true UTC instant (e.g. Europe/London BST 07:00 → 06:00Z).
 */
export function combineDateAndTimeUtc(
  day: Date,
  time: string,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
  return combineOperationalDateAndHm(dayIsoFromUtcCalendarDay(day), time, timeZone);
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function hmToMinutes(time: string): number {
  const { hours, minutes } = parseHm(time.slice(0, 5));
  return hours * 60 + minutes;
}

/** Minutes from `startTime` to `endTime` on the clock face; an end at or before the start is the next day. */
export function clockSpanMinutes(startTime: string, endTime: string): number {
  const span = (hmToMinutes(endTime) - hmToMinutes(startTime) + 1440) % 1440;
  return span === 0 ? 1440 : span;
}

/**
 * The instant a visit ends: `endTime` on the clock, on the start day or — when it is at or before
 * `startTime` — the next day. Overnight visits therefore end at the planned time even on the nights
 * the clocks change (22:00–07:00 is 10 hours in October and 8 in March), instead of adding 24 hours.
 */
export function wallClockVisitEnd(
  dayIso: string,
  startTime: string,
  endTime: string,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
  const nextDay = hmToMinutes(endTime) <= hmToMinutes(startTime);
  return combineOperationalDateAndHm(nextDay ? addDaysToOperationalIso(dayIso, 1) : dayIso, endTime.slice(0, 5), timeZone);
}

/**
 * End of a visit that also has a duration: a duration that matches the planned start and end
 * times follows the clock (see `wallClockVisitEnd`); any other duration is kept as given.
 */
function visitEndFromDuration(
  dayIso: string,
  start: Date,
  startTime: string,
  endTime: string | null | undefined,
  durationMinutes: number,
  timeZone: string,
): Date {
  if (endTime?.trim() && clockSpanMinutes(startTime, endTime) === durationMinutes) {
    return wallClockVisitEnd(dayIso, startTime, endTime, timeZone);
  }
  return new Date(start.getTime() + durationMinutes * 60000);
}

/** Resolve absolute visit window for a calendar day from slot pattern fields. */
export function resolveSlotVisitWindow(
  day: Date,
  slot: SlotTimeWindowInput,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): ResolvedVisitWindow {
  const dayIso = dayIsoFromUtcCalendarDay(day);
  const start = combineOperationalDateAndHm(dayIso, slot.plannedStartTime, timeZone);
  const sameDayEnd = combineOperationalDateAndHm(dayIso, slot.plannedEndTime, timeZone);

  const overnightByKind = slot.slotKind === 'OVERNIGHT';
  const overnightByTime = sameDayEnd.getTime() <= start.getTime();

  let end: Date;
  if (slot.durationMinutes != null && slot.durationMinutes > 0) {
    end = visitEndFromDuration(dayIso, start, slot.plannedStartTime, slot.plannedEndTime, slot.durationMinutes, timeZone);
  } else if (overnightByTime) {
    end = wallClockVisitEnd(dayIso, slot.plannedStartTime, slot.plannedEndTime, timeZone);
  } else if (overnightByKind) {
    // Old "Overnight" rows with a same-day end time: the end time is on the next day.
    end = combineOperationalDateAndHm(addDaysToOperationalIso(dayIso, 1), slot.plannedEndTime, timeZone);
  } else {
    end = sameDayEnd;
  }

  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + DAY_MS);
  }

  return {
    start,
    end,
    durationMinutes: minutesBetween(start, end),
    isOvernight:
      dayKeyInTimeZone(end, timeZone) !== dayKeyInTimeZone(start, timeZone) ||
      overnightByKind ||
      overnightByTime,
  };
}

export type CarerWindowInput = {
  employeeId: string;
  role: 'LEAD' | 'SECONDARY';
  durationMinutes?: number | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  sortOrder: number;
};

export type ResolvedCarerWindow = CarerWindowInput & {
  start: Date;
  end: Date;
  durationMinutes: number;
  isLeadCarer: boolean;
};

/** Per-carer windows for an occurrence; falls back to shared slot window. */
export function resolveCarerWindows(
  day: Date,
  slot: SlotTimeWindowInput,
  carers: CarerWindowInput[],
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): ResolvedCarerWindow[] {
  const base = resolveSlotVisitWindow(day, slot, timeZone);
  if (!carers.length) return [];

  return carers.map((carer) => {
    const startTime = carer.plannedStartTime?.trim() || slot.plannedStartTime;
    const start = combineDateAndTimeUtc(day, startTime, timeZone);
    const dayIso = dayIsoFromUtcCalendarDay(day);
    let end: Date;

    if (carer.durationMinutes != null && carer.durationMinutes > 0) {
      end = visitEndFromDuration(dayIso, start, startTime, carer.plannedEndTime, carer.durationMinutes, timeZone);
    } else if (carer.plannedEndTime?.trim()) {
      end = wallClockVisitEnd(dayIso, startTime, carer.plannedEndTime, timeZone);
    } else {
      end = new Date(base.end);
      if (start.getTime() > base.start.getTime()) {
        end = new Date(start.getTime() + (base.durationMinutes || 60) * 60000);
      }
    }

    return {
      ...carer,
      start,
      end,
      durationMinutes: minutesBetween(start, end),
      isLeadCarer: carer.role === 'LEAD',
    };
  });
}

/** Job/visit window = envelope of all carer windows (or slot window if none). */
export function envelopeWindow(
  slotWindow: ResolvedVisitWindow,
  carerWindows: ResolvedCarerWindow[],
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): ResolvedVisitWindow {
  if (!carerWindows.length) return slotWindow;
  const starts = carerWindows.map((c) => c.start.getTime());
  const ends = carerWindows.map((c) => c.end.getTime());
  const start = new Date(Math.min(...starts));
  const end = new Date(Math.max(...ends));
  return {
    start,
    end,
    durationMinutes: minutesBetween(start, end),
    isOvernight: dayKeyInTimeZone(end, timeZone) !== dayKeyInTimeZone(start, timeZone),
  };
}

/** Derive durationMinutes from HH:mm window when not explicitly set. */
export function deriveDurationFromTimes(
  startTime: string,
  endTime: string,
  slotKind?: string,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): number {
  const baseDay = new Date(Date.UTC(2026, 0, 1));
  const w = resolveSlotVisitWindow(
    baseDay,
    {
      plannedStartTime: startTime,
      plannedEndTime: endTime,
      slotKind: slotKind as SlotTimeWindowInput['slotKind'],
    },
    timeZone,
  );
  return w.durationMinutes;
}
