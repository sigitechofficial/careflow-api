/** Codes treated as medicine given for MAR completion breakdown (NICE/CQC: still documented). */
export const MAR_GIVEN_CODES = new Set(['G', 'F', 'I', 'S', 'T']);

/** Standard non-administration / withheld codes on the MAR. */
export const MAR_NOT_GIVEN_CODES = new Set([
  'N',
  'R',
  'U',
  'C',
  'H',
  'A',
  'O',
  'P',
  'PCI',
]);

export type MarMonthStats = {
  /** Last calendar date (YYYY-MM-DD UTC) included in completion stats */
  completionThroughDate: string;
  /** Scheduled dose-slots in the completion window */
  scheduledToDate: number;
  /** Slots with any administration record (given or coded not given) */
  documented: number;
  /** Scheduled slots with no record yet */
  stillOpen: number;
  /** Documented as given */
  given: number;
  /** Documented as refused, missed, held, etc. */
  notGiven: number;
  /** documented ÷ (documented + stillOpen) × 100, one decimal */
  marCompletionPercent: number | null;
  /** PRN administrations recorded in the completion window */
  prnAdministered: number;
  /** @deprecated Use `stillOpen` */
  due: number;
  /** @deprecated Use `documented` */
  recorded: number;
  /** @deprecated Use `marCompletionPercent` */
  compliancePercent: number | null;
};

export type MarMonthStatsAccumulator = Omit<
  MarMonthStats,
  'due' | 'recorded' | 'compliancePercent' | 'marCompletionPercent' | 'completionThroughDate'
>;

export function isMarGivenOutcomeCode(code: string | null | undefined): boolean {
  if (!code?.trim()) return false;
  return MAR_GIVEN_CODES.has(code.trim().toUpperCase());
}

export function isMarNotGivenOutcomeCode(code: string | null | undefined): boolean {
  if (!code?.trim()) return false;
  const c = code.trim().toUpperCase();
  if (MAR_GIVEN_CODES.has(c)) return false;
  if (MAR_NOT_GIVEN_CODES.has(c)) return true;
  return c !== 'DUE' && c !== 'N/A' && c !== 'PENDING';
}

/** Last date to include when aggregating MAR completion for a period. */
export function marCompletionThroughDate(
  periodStart: string,
  periodEnd: string,
  todayKey: string,
): string {
  if (todayKey < periodStart) return periodStart;
  if (todayKey > periodEnd) return periodEnd;
  return todayKey;
}

export function dateInMarCompletionWindow(
  date: string,
  periodStart: string,
  periodEnd: string,
  todayKey: string,
): boolean {
  if (todayKey < periodStart) return false;
  const through = todayKey > periodEnd ? periodEnd : todayKey;
  return date >= periodStart && date <= through;
}

export function createMarMonthStatsAccumulator(): MarMonthStatsAccumulator {
  return {
    scheduledToDate: 0,
    documented: 0,
    stillOpen: 0,
    given: 0,
    notGiven: 0,
    prnAdministered: 0,
  };
}

export type MarCompletionCell = {
  cellState: 'due' | 'na' | 'prn' | 'recorded';
  statusCode: string | null;
};

export function recordScheduledMarCompletion(
  acc: MarMonthStatsAccumulator,
  cell: MarCompletionCell,
): void {
  acc.scheduledToDate += 1;
  if (cell.cellState === 'due') {
    acc.stillOpen += 1;
    return;
  }
  if (cell.cellState !== 'recorded') return;
  acc.documented += 1;
  if (isMarGivenOutcomeCode(cell.statusCode)) {
    acc.given += 1;
  } else {
    acc.notGiven += 1;
  }
}

/** Key/value rows for MAR export header (HTML, Excel, CSV). */
export function marCompletionMetaRows(
  stats: MarMonthStats,
): Array<[string, string]> {
  return [
    ['MAR completion through', stats.completionThroughDate],
    ['Scheduled doses (to date)', String(stats.scheduledToDate)],
    ['Documented on MAR', String(stats.documented)],
    ['Still open (no record)', String(stats.stillOpen)],
    ['Given', String(stats.given)],
    ['Not given / refused / omitted', String(stats.notGiven)],
    [
      'MAR completion',
      stats.marCompletionPercent != null ? `${stats.marCompletionPercent}%` : '—',
    ],
    ['PRN administrations (to date)', String(stats.prnAdministered)],
  ];
}

export function finalizeMarMonthStats(
  acc: MarMonthStatsAccumulator,
  periodStart: string,
  periodEnd: string,
  todayKey: string,
): MarMonthStats {
  const completionThroughDate = marCompletionThroughDate(
    periodStart,
    periodEnd,
    todayKey,
  );
  const total = acc.documented + acc.stillOpen;
  const marCompletionPercent =
    total > 0 ? Math.round((acc.documented / total) * 1000) / 10 : null;
  return {
    completionThroughDate,
    scheduledToDate: acc.scheduledToDate,
    documented: acc.documented,
    stillOpen: acc.stillOpen,
    given: acc.given,
    notGiven: acc.notGiven,
    marCompletionPercent,
    prnAdministered: acc.prnAdministered,
    due: acc.stillOpen,
    recorded: acc.documented,
    compliancePercent: marCompletionPercent,
  };
}
