/** Resolve MAR time-slot labels from administration rounds + due times (spec §5). */

export type AdministrationRoundRow = {
  id: string;
  name: string;
  code: string;
  time: string;
  windowStart: string | null;
  windowEnd: string | null;
  sortOrder: number;
};

const HM_TO_ROUND_NAME: Record<string, string> = {
  '08:00': 'Morning',
  '09:00': 'Morning',
  '12:00': 'Midday',
  '15:00': 'Afternoon',
  '18:00': 'Evening',
  '22:00': 'Night',
};

export function formatHm(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim());
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Match due time to a round by administration window (e.g. 07:00 → Morning 07:00–10:00). */
export function findRoundByWindow(
  dueHm: string,
  rounds: AdministrationRoundRow[],
): AdministrationRoundRow | null {
  const dueM = hmToMinutes(dueHm);
  const sorted = [...rounds].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const r of sorted) {
    const ws = formatHm(r.windowStart);
    const we = formatHm(r.windowEnd);
    if (!ws || !we) continue;
    if (dueM >= hmToMinutes(ws) && dueM <= hmToMinutes(we)) return r;
  }
  return null;
}

export function findRoundForDueTime(
  dueTime: string | null | undefined,
  rounds: AdministrationRoundRow[],
  roundsByTime: Map<string, AdministrationRoundRow>,
): AdministrationRoundRow | null {
  const hm = formatHm(dueTime);
  if (!hm) return null;
  const exact = roundsByTime.get(hm);
  if (exact) return exact;
  const byWindow = findRoundByWindow(hm, rounds);
  if (byWindow) return byWindow;
  const legacyName = roundNameFromDueTime(hm);
  if (!legacyName) return null;
  return rounds.find((r) => r.name === legacyName) ?? null;
}

export function indexRoundsByTime(
  rounds: AdministrationRoundRow[],
): Map<string, AdministrationRoundRow> {
  const map = new Map<string, AdministrationRoundRow>();
  for (const r of rounds) {
    const hm = formatHm(r.time);
    if (hm) map.set(hm, r);
  }
  return map;
}

export function roundNameFromDueTime(dueTime: string | null | undefined): string | null {
  const hm = formatHm(dueTime);
  if (!hm) return null;
  return HM_TO_ROUND_NAME[hm] ?? null;
}

/** Map standard round labels (and codes) to anchor due times for blister-pack grouping. */
const ROUND_LABEL_TO_TIME: Record<string, string> = {
  morning: '08:00',
  midday: '12:00',
  afternoon: '15:00',
  evening: '18:00',
  night: '22:00',
  MORNING: '08:00',
  MIDDAY: '12:00',
  AFTERNOON: '15:00',
  EVENING: '18:00',
  NIGHT: '22:00',
};

/** Internal grouping key when a pack row has no resolvable administration time. */
export const PACK_ROW_UNSCHEDULED_KEY = '__unscheduled__';

/** Resolve HH:mm for blister-pack compartment grouping from chart/export row fields. */
export function resolvePackRowDueTime(row: {
  dueTime?: string | null;
  timeSlot?: string | null;
}): string | null {
  const fromDue = formatHm(row.dueTime);
  if (fromDue) return fromDue;

  const slot = row.timeSlot?.trim();
  if (!slot || slot === 'Administration' || slot === 'PRN') return null;

  const fromSlotHm = formatHm(slot);
  if (fromSlotHm) return fromSlotHm;

  const key = slot.toLowerCase();
  return ROUND_LABEL_TO_TIME[slot] ?? ROUND_LABEL_TO_TIME[key] ?? null;
}

export function roundDisplayNameForPackDueTime(dueTime: string): string {
  if (dueTime === PACK_ROW_UNSCHEDULED_KEY) return 'Unscheduled';
  return roundNameFromDueTime(dueTime) ?? dueTime;
}

export function isPackCompartmentScheduleId(scheduleId: string | null | undefined): boolean {
  return Boolean(scheduleId?.startsWith('pack-compartment-'));
}

/** Due time (HH:mm) from an administration event anchor datetime (UTC, as stored for MAR). */
export function chartEventDueHm(event: {
  scheduledDateTime?: Date | null;
  actualDateTime?: Date | null;
}): string | null {
  const anchor = event.scheduledDateTime ?? event.actualDateTime;
  if (!anchor) return null;
  const d = new Date(anchor);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export type ChartEventSlotIndexes<T> = {
  eventsBySlotDay: Map<string, T>;
  eventsByMedDueDay: Map<string, T>;
};

/** Resolve a MAR cell event for a chart row (pack compartment rows need due-time fallback). */
export function resolveChartSlotEvent<T>(
  indexes: ChartEventSlotIndexes<T>,
  medId: string,
  scheduleId: string | null,
  dueTime: string | null,
  date: string,
): T | undefined {
  const slotKey = `${medId}:${scheduleId ?? 'none'}:${date}`;
  const direct = indexes.eventsBySlotDay.get(slotKey);
  if (direct) return direct;

  const dueHm = formatHm(dueTime);
  if (dueHm && isPackCompartmentScheduleId(scheduleId)) {
    const byDue = indexes.eventsByMedDueDay.get(`${medId}:${dueHm}:${date}`);
    if (byDue) return byDue;
    return indexes.eventsBySlotDay.get(`${medId}:none:${date}`);
  }

  return undefined;
}

export function resolveScheduleSlot(
  sch: {
    round?: AdministrationRoundRow | null;
    dueTime?: string | null;
    dueVisitName?: string | null;
  },
  roundsByTime: Map<string, AdministrationRoundRow>,
  allRounds: AdministrationRoundRow[] = [],
): {
  timeSlot: string;
  dueTime: string | null;
  roundWindowStart: string | null;
  roundWindowEnd: string | null;
  sortOrder: number;
} {
  const dueTime = formatHm(sch.dueTime ?? sch.round?.time ?? null);
  const round =
    sch.round ??
    (dueTime ? findRoundForDueTime(dueTime, allRounds, roundsByTime) : null);
  const timeSlot =
    round?.name ??
    (sch.dueVisitName?.trim() || roundNameFromDueTime(dueTime) || dueTime || 'Administration');
  return {
    timeSlot,
    dueTime,
    roundWindowStart: formatHm(round?.windowStart ?? null),
    roundWindowEnd: formatHm(round?.windowEnd ?? null),
    sortOrder: round?.sortOrder ?? 99,
  };
}

export function matchRoundIdByDueTime(
  rounds: AdministrationRoundRow[],
  dueTime: string,
): string | undefined {
  const hm = formatHm(dueTime);
  if (!hm) return undefined;
  const exact = rounds.find((r) => formatHm(r.time) === hm);
  if (exact) return exact.id;
  const name = roundNameFromDueTime(hm);
  if (!name) return undefined;
  return rounds.find((r) => r.name === name)?.id;
}
