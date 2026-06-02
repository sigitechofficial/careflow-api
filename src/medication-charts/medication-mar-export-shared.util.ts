import type { MarChartCell } from './medication-charts.service';
import {
  PACK_ROW_UNSCHEDULED_KEY,
  resolvePackRowDueTime,
  roundDisplayNameForPackDueTime,
} from './medication-chart-rounds.util';
import { MAR_GIVEN_CODES } from './medication-mar-completion.util';

/** Blister pack export: summary = compartment round row only; full = summary + each medicine. */
export type PackExportDetailMode = 'summary' | 'full';

export type MarExportRenderOptions = {
  includeLegend?: boolean;
  forExcel?: boolean;
  packExportDetail?: PackExportDetailMode;
};

export function parsePackExportDetail(raw?: string | null): PackExportDetailMode {
  return raw === 'summary' ? 'summary' : 'full';
}

export function includePackMedicineRows(options?: MarExportRenderOptions): boolean {
  return parsePackExportDetail(options?.packExportDetail) !== 'summary';
}

export type MarExportContext = {
  organisationName: string | null;
  serviceUserId: string;
  serviceUserLabel: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  nhsNumber: string | null;
  locationName: string | null;
  allergySummary: string | null;
  reportMonth: string;
  reportMonthLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatedBy: string | null;
  medicationCount: number;
  administrationRowCount: number;
  monthStats: MarExportMonthStats;
};

export type MarExportMonthStats = {
  completionThroughDate: string;
  scheduledToDate: number;
  documented: number;
  stillOpen: number;
  given: number;
  notGiven: number;
  marCompletionPercent: number | null;
  prnAdministered: number;
  due: number;
  recorded: number;
  compliancePercent: number | null;
};

export function normalizeMarExportMonthStats(
  stats?: Partial<MarExportMonthStats> | null,
): MarExportMonthStats {
  const documented = stats?.documented ?? stats?.recorded ?? 0;
  const stillOpen = stats?.stillOpen ?? stats?.due ?? 0;
  const marCompletionPercent =
    stats?.marCompletionPercent ?? stats?.compliancePercent ?? null;
  return {
    completionThroughDate: stats?.completionThroughDate ?? '—',
    scheduledToDate: stats?.scheduledToDate ?? documented + stillOpen,
    documented,
    stillOpen,
    given: stats?.given ?? 0,
    notGiven: stats?.notGiven ?? 0,
    marCompletionPercent,
    prnAdministered: stats?.prnAdministered ?? 0,
    due: stillOpen,
    recorded: documented,
    compliancePercent: marCompletionPercent,
  };
}

export type MarExportMedicationRow = {
  medicationId: string;
  medicationName: string;
  packName: string | null;
  dose: string | null;
  strength: string | null;
  routeName: string | null;
  type: string | null;
  frequency: string | null;
  scheduleType: string;
  timeSlot: string;
  dueTime: string | null;
  roundWindowStart?: string | null;
  roundWindowEnd?: string | null;
  days: MarChartCell[];
};

export type MarExportChartPayload = {
  month: string;
  lastDay: number;
  periodStart?: string;
  periodEnd?: string;
  periodLabel?: string;
  dayDates?: string[];
  legend: Array<{ code: string; label: string; color?: string; textColor?: string }>;
  medications: MarExportMedicationRow[];
};

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function escapeCsvField(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsvField).join(',');
}

export function formatReportMonthLabel(month: string): string {
  const [yStr, mStr] = month.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || m < 1 || m > 12) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

export function periodBounds(month: string, lastDay: number): { start: string; end: string } {
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function isoDateForDay(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function dayOfWeekShort(month: string, day: number): string {
  const [yStr, mStr] = month.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return '';
  return DOW_SHORT[new Date(y, m - 1, day).getDay()] ?? '';
}

export function dayOfWeekShortFromIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return DOW_SHORT[new Date(y, mo - 1, d).getDay()] ?? '';
}

export function marDayColumnHeader(isoDate: string, columnDay: number): string {
  const dow = dayOfWeekShortFromIso(isoDate);
  return dow ? `${columnDay}\n${dow}` : String(columnDay);
}

export function dayColumnHeader(month: string, day: number): string {
  const iso = isoDateForDay(month, day);
  const dow = dayOfWeekShort(month, day);
  return dow ? `${iso} (${dow})` : iso;
}

export function cellExportCode(cell: MarChartCell): string {
  if (cell.cellState === 'due') return 'Due';
  if (cell.cellState === 'na') return 'N/A';
  if (cell.cellState === 'prn') return 'PRN+';
  return cell.statusCode ?? '';
}

export function cellExportLabel(cell: MarChartCell): string {
  if (cell.cellState === 'due') return 'Due';
  if (cell.cellState === 'na') return 'Not scheduled';
  if (cell.cellState === 'prn') return 'PRN (log when given)';
  return cell.statusLabel ?? cell.statusCode ?? '';
}

export function cellExportDisplay(cell: MarChartCell): string {
  const code = cellExportCode(cell);
  if (cell.cellState === 'recorded' && cell.statusLabel) {
    return `${code} — ${cell.statusLabel}`;
  }
  return code;
}

export function scheduleTypeLabel(scheduleType: string): string {
  switch (scheduleType) {
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'interval':
      return 'Every N days';
    case 'prn':
      return 'PRN';
    case 'specific':
      return 'Specific days';
    default:
      return 'Daily';
  }
}

export type MedicationDetailField = { label: string; value: string };

/** Labelled medication lines for MAR grid exports (Medication:, Dose:, etc.). */
export function medicationDetailFields(row: MarExportMedicationRow): MedicationDetailField[] {
  const fields: MedicationDetailField[] = [
    { label: 'Medication', value: row.medicationName },
  ];
  if (row.strength) fields.push({ label: 'Strength', value: row.strength });
  if (row.dose) fields.push({ label: 'Dose', value: row.dose });
  if (row.routeName) fields.push({ label: 'Route', value: row.routeName });
  if (row.type) fields.push({ label: 'Type', value: row.type });
  if (row.frequency) fields.push({ label: 'Frequency', value: row.frequency });
  if (row.packName) fields.push({ label: 'Pack', value: row.packName });
  fields.push({ label: 'Schedule', value: scheduleTypeLabel(row.scheduleType) });
  return fields;
}

export function formatMedicationDetailText(
  row: MarExportMedicationRow,
  lineSeparator = '\n',
): string {
  return medicationDetailFields(row)
    .map(f => `${f.label}: ${f.value}`)
    .join(lineSeparator);
}

export function groupMedicationRows(
  rows: MarExportMedicationRow[],
): MarExportMedicationRow[][] {
  const map = new Map<string, MarExportMedicationRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    if (!map.has(row.medicationId)) {
      map.set(row.medicationId, []);
      order.push(row.medicationId);
    }
    map.get(row.medicationId)!.push(row);
  }
  return order.map(id => map.get(id)!);
}

/** Standard compartment order for blister-pack export rows */
const PACK_ROUND_TIMES = ['08:00', '12:00', '15:00', '18:00', '22:00'] as const;

function packRowSortKey(row: MarExportMedicationRow): number {
  const due = row.dueTime ?? '';
  const idx = PACK_ROUND_TIMES.indexOf(due as (typeof PACK_ROUND_TIMES)[number]);
  return idx >= 0 ? idx : 100 + due.localeCompare('');
}

export function sortPackExportRows(rows: MarExportMedicationRow[]): MarExportMedicationRow[] {
  return [...rows].sort((a, b) => {
    const diff = packRowSortKey(a) - packRowSortKey(b);
    if (diff !== 0) return diff;
    return a.medicationName.localeCompare(b.medicationName);
  });
}

export type MarExportPackBundle = {
  packName: string;
  rows: MarExportMedicationRow[];
};

export function splitPackAndStandaloneExportRows(rows: MarExportMedicationRow[]): {
  packBundles: MarExportPackBundle[];
  standaloneRows: MarExportMedicationRow[];
} {
  const packMap = new Map<string, MarExportMedicationRow[]>();
  const standaloneRows: MarExportMedicationRow[] = [];

  for (const row of rows) {
    if (row.packName) {
      const list = packMap.get(row.packName) ?? [];
      list.push(row);
      packMap.set(row.packName, list);
    } else {
      standaloneRows.push(row);
    }
  }

  const packBundles = [...packMap.entries()]
    .map(([packName, packRows]) => ({
      packName,
      rows: sortPackExportRows(packRows),
    }))
    .sort((a, b) => a.packName.localeCompare(b.packName));

  return { packBundles, standaloneRows };
}

export type MarExportCompartmentSlice = {
  dueTime: string;
  roundName: string;
  emoji: string;
  label: string;
  rows: MarExportMedicationRow[];
};

const EXPORT_ROUNDS = [
  { time: '08:00', name: 'Morning', emoji: '🌅' },
  { time: '12:00', name: 'Midday', emoji: '☀' },
  { time: '15:00', name: 'Afternoon', emoji: '☀' },
  { time: '18:00', name: 'Evening', emoji: '🌆' },
  { time: '22:00', name: 'Night', emoji: '🌙' },
] as const;

function roundMetaForDueTime(dueTime: string): { name: string; emoji: string } {
  if (dueTime === PACK_ROW_UNSCHEDULED_KEY) {
    return { name: 'Unscheduled', emoji: '⚠' };
  }
  const match = EXPORT_ROUNDS.find(r => r.time === dueTime);
  if (match) return { name: match.name, emoji: match.emoji };
  const name = roundDisplayNameForPackDueTime(dueTime);
  return { name, emoji: '' };
}

export function buildPackExportCompartments(rows: MarExportMedicationRow[]): MarExportCompartmentSlice[] {
  const byTime = new Map<string, MarExportMedicationRow[]>();
  for (const row of rows) {
    const dueTime = resolvePackRowDueTime(row) ?? PACK_ROW_UNSCHEDULED_KEY;
    const list = byTime.get(dueTime) ?? [];
    list.push(row);
    byTime.set(dueTime, list);
  }

  const order = EXPORT_ROUNDS.map(r => r.time);
  const sortedTimes = [...byTime.keys()].sort((a, b) => {
    const ia = order.indexOf(a as (typeof order)[number]);
    const ib = order.indexOf(b as (typeof order)[number]);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  return sortedTimes.map(dueTime => {
    const { name, emoji } = roundMetaForDueTime(dueTime);
    return {
      dueTime,
      roundName: name,
      emoji,
      label: `${emoji ? `${emoji} ` : ''}${name} Compartment`.trim(),
      rows: (byTime.get(dueTime) ?? []).sort((a, b) => a.medicationName.localeCompare(b.medicationName)),
    };
  });
}

export type MarExportSection =
  | { kind: 'pack'; packName: string; rows: MarExportMedicationRow[]; compartments: MarExportCompartmentSlice[] }
  | { kind: 'standalone'; groups: MarExportMedicationRow[][] };

/** Pack bundles first (compartment order inside each pack), then standalone medicines. */
export function buildMarExportSections(rows: MarExportMedicationRow[]): MarExportSection[] {
  const { packBundles, standaloneRows } = splitPackAndStandaloneExportRows(rows);
  const sections: MarExportSection[] = packBundles.map(bundle => ({
    kind: 'pack',
    packName: bundle.packName,
    rows: bundle.rows,
    compartments: buildPackExportCompartments(bundle.rows),
  }));
  const standaloneGroups = groupMedicationRows(standaloneRows);
  if (standaloneGroups.length > 0) {
    sections.push({ kind: 'standalone', groups: standaloneGroups });
  }
  return sections;
}

export function packExportHeaderLabel(packName: string, rows: MarExportMedicationRow[]): string {
  const medCount = new Set(rows.map(r => r.medicationId)).size;
  const compartmentCount = buildPackExportCompartments(rows).length;
  return `Blister pack — ${packName} · ${medCount} medicine${medCount === 1 ? '' : 's'} · ${compartmentCount} compartment${compartmentCount === 1 ? '' : 's'}`;
}

export function compartmentExportHeaderLabel(compartment: MarExportCompartmentSlice): string {
  return `${compartment.label} · ${compartment.dueTime} · ${compartment.rows.length} medicine${compartment.rows.length === 1 ? '' : 's'}`;
}

/** Display-only — collapsed blister compartment summary; not a recordable MAR code. */
export const PARTIAL_ROUND_LEGEND_ITEM = {
  code: 'PR',
  label: 'Partial Round — mixed statuses among scheduled medicines',
  color: '#ffedd5',
  textColor: '#c2410c',
} as const;

export function chartHasPackMedications(rows: MarExportMedicationRow[]): boolean {
  return rows.some(r => Boolean(r.packName));
}

export function exportLegendItems(
  chart: Pick<MarExportChartPayload, 'legend' | 'medications'>,
): Array<{ code: string; label: string; color?: string; textColor?: string }> {
  const items = [...chart.legend];
  if (chartHasPackMedications(chart.medications) && !items.some(i => i.code === 'PR')) {
    items.push({ ...PARTIAL_ROUND_LEGEND_ITEM });
  }
  return items;
}

export function exportChartTodayDay(month: string): number | null {
  const now = new Date();
  const [yStr, mStr] = month.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return null;
  if (now.getFullYear() !== y || now.getMonth() + 1 !== m) return null;
  return now.getDate();
}

function exportCellCodeFromChartCell(cell: MarChartCell | undefined): string | null {
  if (!cell) return null;
  if (cell.cellState === 'due') return 'Due';
  if (cell.cellState === 'recorded') return cell.statusCode ?? 'G';
  if (cell.cellState === 'na') return 'NA';
  return null;
}

export type CompartmentExportDayCounts = {
  members: number;
  scheduled: number;
  G: number;
  R: number;
  N: number;
  U: number;
  due: number;
  recorded: number;
};

export function summarizeCompartmentExportDay(
  rows: MarExportMedicationRow[],
  day: number,
): CompartmentExportDayCounts {
  const counts: CompartmentExportDayCounts = {
    members: rows.length,
    scheduled: 0,
    G: 0,
    R: 0,
    N: 0,
    U: 0,
    due: 0,
    recorded: 0,
  };
  for (const row of rows) {
    const code = exportCellCodeFromChartCell(row.days.find(c => c.day === day));
    if (!code || code === 'NA') continue;
    counts.scheduled++;
    if (code === 'Due') counts.due++;
    else {
      counts.recorded++;
      if (code === 'G') counts.G++;
      else if (code === 'R') counts.R++;
      else if (code === 'N') counts.N++;
      else if (code === 'U') counts.U++;
    }
  }
  return counts;
}

/** PR only when a medicine scheduled this day was not fully given; N/A rows are excluded. */
export function isCompartmentPartialRoundExport(counts: CompartmentExportDayCounts): boolean {
  if (counts.scheduled === 0) return false;
  if (counts.due === counts.scheduled) return false;
  if (counts.due > 0) return true;
  if (counts.R > 0 || counts.N > 0) return true;
  if (counts.G === counts.scheduled && counts.due === 0) return false;
  if (counts.recorded === counts.scheduled && counts.due === 0) return false;
  return false;
}

export type CompartmentExportHeadline = {
  text: string;
  tone: 'open' | 'complete' | 'partial' | 'mixed-due';
  icon: string;
};

export function compartmentExportCollapsedHeadline(
  counts: CompartmentExportDayCounts,
): CompartmentExportHeadline {
  if (counts.scheduled === 0) {
    return { text: 'Not scheduled', tone: 'complete', icon: '—' };
  }
  if (counts.due === counts.scheduled) {
    return { text: `${counts.scheduled} due`, tone: 'open', icon: '⏳' };
  }
  if (
    counts.recorded === counts.scheduled &&
    counts.due === 0 &&
    counts.R === 0 &&
    counts.N === 0 &&
    counts.U === 0
  ) {
    return { text: 'All given', tone: 'complete', icon: '✓' };
  }
  if (counts.G === counts.scheduled && counts.due === 0) {
    return { text: 'All given', tone: 'complete', icon: '✓' };
  }
  const parts: string[] = [];
  if (counts.G) parts.push(`${counts.G} given`);
  if (counts.R) parts.push(`${counts.R} refused`);
  if (counts.N) parts.push(`${counts.N} missed`);
  if (counts.U) parts.push(`${counts.U} unavail`);
  if (counts.due) parts.push(`${counts.due} due`);
  const tone =
    counts.due > 0 && counts.recorded > 0
      ? 'mixed-due'
      : isCompartmentPartialRoundExport(counts)
        ? 'partial'
        : 'complete';
  const icon =
    counts.due > 0 && counts.recorded > 0 ? '◐' : isCompartmentPartialRoundExport(counts) ? '⚠' : '✓';
  return { text: parts.join(' · '), tone, icon };
}

export type CompartmentExportStatusPill = {
  label: string;
  tone: CompartmentExportHeadline['tone'];
  text: string;
  icon: string;
};

export function compartmentExportStatusPill(
  counts: CompartmentExportDayCounts,
): CompartmentExportStatusPill {
  const headline = compartmentExportCollapsedHeadline(counts);
  const isPartial = isCompartmentPartialRoundExport(counts);
  const label =
    counts.due === counts.scheduled
      ? 'OPEN'
      : counts.recorded === counts.scheduled &&
          counts.due === 0 &&
          counts.R === 0 &&
          counts.N === 0 &&
          counts.U === 0
        ? 'Given'
        : counts.G === counts.scheduled && counts.due === 0
          ? 'Given'
          : isPartial
            ? 'PR'
            : 'Complete';
  return {
    label,
    tone: headline.tone,
    text: isPartial ? 'Partial round' : headline.text,
    icon: isPartial ? 'PR' : headline.icon,
  };
}

/** OPEN is implied by Due day cells — no pill on the compartment band. */
export function showCompartmentExportStatusPill(
  pill: CompartmentExportStatusPill | null | undefined,
): pill is CompartmentExportStatusPill {
  return pill != null && pill.label !== 'OPEN';
}

export function compartmentMedicineContentsLine(
  rows: Array<{ medicationName: string }>,
): string {
  return [...new Set(rows.map(r => r.medicationName))]
    .sort((a, b) => a.localeCompare(b))
    .join(' · ');
}

export function compartmentExportCollapsedMeta(
  compartment: MarExportCompartmentSlice,
  _todayDay: number | null,
): string {
  return compartmentMedicineContentsLine(compartment.rows);
}

function findCompartmentUniformCell(
  rows: MarExportMedicationRow[],
  day: number,
  counts: CompartmentExportDayCounts,
  isPartial: boolean,
): MarChartCell | null {
  if (isPartial) return null;

  const tryCode = (code: string): MarChartCell | null => {
    for (const row of rows) {
      const cell = row.days.find(c => c.day === day);
      if (exportCellCodeFromChartCell(cell) === code && cell) return cell;
    }
    return null;
  };

  if (counts.G === counts.scheduled) {
    const cell = tryCode('G');
    if (cell) return cell;
  }
  if (counts.R === counts.scheduled) {
    const cell = tryCode('R');
    if (cell) return cell;
  }
  if (counts.N === counts.scheduled) {
    const cell = tryCode('N');
    if (cell) return cell;
  }
  if (counts.U === counts.scheduled) {
    const cell = tryCode('U');
    if (cell) return cell;
  }

  if (counts.recorded === counts.scheduled && counts.due === 0) {
    let allGiven = true;
    for (const row of rows) {
      const code = exportCellCodeFromChartCell(row.days.find(c => c.day === day));
      if (!code || code === 'NA') continue;
      if (!MAR_GIVEN_CODES.has(code)) {
        allGiven = false;
        break;
      }
    }
    if (allGiven) {
      const gCell = tryCode('G');
      if (gCell) return gCell;
      for (const row of rows) {
        const cell = row.days.find(c => c.day === day);
        const code = exportCellCodeFromChartCell(cell);
        if (cell && code && MAR_GIVEN_CODES.has(code)) return cell;
      }
    }
  }

  return null;
}

function partialExportSummaryText(
  codes: Array<{ code: string; name: string }>,
): string {
  const g = codes.filter(c => c.code === 'G').length;
  const r = codes.filter(c => c.code === 'R').length;
  const n = codes.filter(c => c.code === 'N').length;
  const u = codes.filter(c => c.code === 'U').length;
  const due = codes.filter(c => c.code === 'Due').length;
  const parts: string[] = [];
  if (g) parts.push(`${g}G`);
  if (r) parts.push(`${r}R`);
  if (n) parts.push(`${n}N`);
  if (u) parts.push(`${u}U`);
  if (due) parts.push(`${due} due`);
  return parts.join(' · ') || 'Partial';
}

export type CompartmentExportAggregateCell =
  | { kind: 'empty' }
  | { kind: 'na' }
  | { kind: 'due' }
  | { kind: 'uniform'; cell: MarChartCell }
  | { kind: 'partial'; tooltip: string; needsReview: boolean };

export function aggregateCompartmentExportCell(
  rows: MarExportMedicationRow[],
  day: number,
  todayDay: number | null,
): CompartmentExportAggregateCell {
  if (!rows.length) return { kind: 'empty' };

  const counts = summarizeCompartmentExportDay(rows, day);
  if (counts.scheduled === 0) return { kind: 'na' };

  const isFuture = todayDay != null && day > todayDay;
  if (isFuture || counts.due === counts.scheduled) {
    return { kind: 'due' };
  }

  if (!isCompartmentPartialRoundExport(counts)) {
    const uniformCell = findCompartmentUniformCell(
      rows,
      day,
      counts,
      false,
    );
    if (uniformCell) {
      return { kind: 'uniform', cell: uniformCell };
    }
  }

  const medStatuses = rows
    .map(row => {
      const cell = row.days.find(c => c.day === day);
      const code = exportCellCodeFromChartCell(cell);
      if (!code || code === 'NA') return null;
      return {
        code,
        name: row.medicationName,
        needsReview: Boolean(cell?.requiresReview),
      };
    })
    .filter((s): s is { code: string; name: string; needsReview: boolean } => s != null);

  const summary = partialExportSummaryText(medStatuses);
  const tooltip = [
    summary,
    '',
    ...medStatuses.map(m => `${m.name}: ${m.code === 'Due' ? 'Due' : m.code}`),
    '',
    'Expand for individual G/R/N per medicine',
  ].join('\n');
  const needsReview = medStatuses.some(s => s.needsReview) && day === todayDay;

  return { kind: 'partial', tooltip, needsReview };
}

export function compartmentSummaryExportCode(
  aggregate: CompartmentExportAggregateCell,
): string {
  switch (aggregate.kind) {
    case 'empty':
      return '';
    case 'na':
      return 'N/A';
    case 'due':
      return 'Due';
    case 'uniform':
      return cellExportCode(aggregate.cell);
    case 'partial':
      return 'PR';
  }
}

export function formatUkDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB');
}

export function formatUkDateTime(d: Date = new Date()): string {
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
