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

export function combineDateAndTimeUtc(day: Date, time: string): Date {
  const { hours, minutes } = parseHm(time);
  const dt = new Date(day);
  dt.setUTCHours(hours, minutes, 0, 0);
  return dt;
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

/** Resolve absolute visit window for a calendar day from slot pattern fields. */
export function resolveSlotVisitWindow(day: Date, slot: SlotTimeWindowInput): ResolvedVisitWindow {
  const start = combineDateAndTimeUtc(day, slot.plannedStartTime);
  let end = combineDateAndTimeUtc(day, slot.plannedEndTime);

  const overnightByKind = slot.slotKind === 'OVERNIGHT';
  const overnightByTime = end.getTime() <= start.getTime();

  if (slot.durationMinutes != null && slot.durationMinutes > 0) {
    end = new Date(start.getTime() + slot.durationMinutes * 60000);
    if (overnightByKind || overnightByTime) {
      const span = slot.durationMinutes;
      const sameDayEnd = combineDateAndTimeUtc(day, slot.plannedEndTime);
      if (sameDayEnd.getTime() <= start.getTime() && span > minutesBetween(start, sameDayEnd)) {
        // duration spans past midnight when end time is on next day
        if (end.getTime() <= start.getTime() || overnightByTime) {
          // keep duration-based end
        }
      }
    }
  } else if (overnightByKind || overnightByTime) {
    end = new Date(end.getTime() + DAY_MS);
  }

  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + DAY_MS);
  }

  return {
    start,
    end,
    durationMinutes: minutesBetween(start, end),
    isOvernight: end.getUTCDate() !== start.getUTCDate() || overnightByKind || overnightByTime,
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
): ResolvedCarerWindow[] {
  const base = resolveSlotVisitWindow(day, slot);
  if (!carers.length) return [];

  return carers.map((carer) => {
    const startTime = carer.plannedStartTime?.trim() || slot.plannedStartTime;
    const start = combineDateAndTimeUtc(day, startTime);
    let end: Date;

    if (carer.durationMinutes != null && carer.durationMinutes > 0) {
      end = new Date(start.getTime() + carer.durationMinutes * 60000);
    } else if (carer.plannedEndTime?.trim()) {
      end = combineDateAndTimeUtc(day, carer.plannedEndTime);
      if (end.getTime() <= start.getTime()) {
        end = new Date(end.getTime() + DAY_MS);
      }
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
    isOvernight: end.getUTCDate() !== start.getUTCDate(),
  };
}

/** Derive durationMinutes from HH:mm window when not explicitly set. */
export function deriveDurationFromTimes(startTime: string, endTime: string, slotKind?: string): number {
  const baseDay = new Date(Date.UTC(2026, 0, 1));
  const w = resolveSlotVisitWindow(baseDay, {
    plannedStartTime: startTime,
    plannedEndTime: endTime,
    slotKind: slotKind as SlotTimeWindowInput['slotKind'],
  });
  return w.durationMinutes;
}
