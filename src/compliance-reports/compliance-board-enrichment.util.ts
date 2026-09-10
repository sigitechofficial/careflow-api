import { EmployeeComplianceStatus } from '@prisma/client';

export type BoardDisplayStatus = 'BLOCKED' | 'ATTENTION' | 'COMPLIANT';

export type BoardDocumentStateFilter =
  | 'expired'
  | 'expiring_7'
  | 'expiring_8_30'
  | 'missing'
  | 'valid';

export type BoardSortMode = 'urgent' | 'nearest_expiry' | 'name';

export type BoardCellLike = {
  code: string;
  typeName?: string | null;
  applicable: boolean;
  effectiveStatus: EmployeeComplianceStatus | 'NOT_APPLICABLE';
  expiryDate: string | null;
  daysRemaining: number | null;
  critical: boolean;
  blocksRostering: boolean;
  isMandatory: boolean;
};

export type BoardNextAction = {
  typeCode: string | null;
  typeName: string | null;
  kind:
    | 'BLOCKING'
    | 'EXPIRED'
    | 'REJECTED'
    | 'MISSING'
    | 'EXPIRING_7'
    | 'EXPIRING_30'
    | 'WARNING'
    | 'NONE';
  expiryDate: string | null;
  daysRemaining: number | null;
  blocksAllocation: boolean;
  primary: string;
  secondary: string | null;
};

/**
 * Statuses that count as "satisfied" for mandatory compliance %.
 * Aligns with calculator outcomes that mean the employee is currently operationally OK
 * for that requirement (still valid, even if approaching renewal).
 *
 * SUBMITTED is almost never emitted by calculateComplianceStatus when verification is
 * required (becomes PENDING_REVIEW). We intentionally do NOT treat PENDING_REVIEW or
 * SUBMITTED as satisfied — verification still outstanding.
 */
const SATISFIED_FOR_PERCENT = new Set<string>([
  EmployeeComplianceStatus.VALID,
  EmployeeComplianceStatus.EXPIRING_SOON,
]);

const ATTENTION_STATUSES = new Set<string>([
  EmployeeComplianceStatus.MISSING,
  EmployeeComplianceStatus.REQUIRED,
  EmployeeComplianceStatus.EXPIRED,
  EmployeeComplianceStatus.REJECTED,
  EmployeeComplianceStatus.EXPIRING_SOON,
  EmployeeComplianceStatus.PENDING_REVIEW,
  EmployeeComplianceStatus.SUBMITTED,
]);

const CRITICAL_LIKE = new Set<string>([
  EmployeeComplianceStatus.MISSING,
  EmployeeComplianceStatus.REQUIRED,
  EmployeeComplianceStatus.EXPIRED,
  EmployeeComplianceStatus.REJECTED,
]);

function applicableCells(cells: BoardCellLike[]): BoardCellLike[] {
  return cells.filter((c) => c.applicable && c.effectiveStatus !== 'NOT_APPLICABLE');
}

/**
 * Mandatory applicable requirements excluding N/A and NO_LONGER_REQUIRED (removed from denom).
 * Optional requirements are excluded.
 */
export function computeCompliancePercent(cells: BoardCellLike[]): number | null {
  const mandatory = applicableCells(cells).filter(
    (c) =>
      c.isMandatory && c.effectiveStatus !== EmployeeComplianceStatus.NO_LONGER_REQUIRED,
  );
  if (mandatory.length === 0) return null;
  const satisfied = mandatory.filter((c) => SATISFIED_FOR_PERCENT.has(c.effectiveStatus)).length;
  return Math.round((satisfied / mandatory.length) * 100);
}

export function computeOverallDisplayStatus(input: {
  blocksAllocation: boolean;
  cells: BoardCellLike[];
  /** Board-visible warning issues only (not off-board allocation extras). */
  warningIssueCount: number;
}): BoardDisplayStatus {
  if (input.blocksAllocation) return 'BLOCKED';
  const hasAttentionCell = applicableCells(input.cells).some((c) =>
    ATTENTION_STATUSES.has(c.effectiveStatus),
  );
  if (hasAttentionCell || input.warningIssueCount > 0) return 'ATTENTION';
  return 'COMPLIANT';
}

function formatDateIso(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function cellPriority(cell: BoardCellLike): number {
  if (!cell.applicable || cell.effectiveStatus === 'NOT_APPLICABLE') return 999;
  if (cell.effectiveStatus === EmployeeComplianceStatus.NO_LONGER_REQUIRED) return 999;
  // Blocking critical gaps first (respects blocksRostering config).
  if (cell.blocksRostering && CRITICAL_LIKE.has(cell.effectiveStatus)) return 1;
  if (cell.effectiveStatus === EmployeeComplianceStatus.EXPIRED) return 2;
  if (cell.effectiveStatus === EmployeeComplianceStatus.REJECTED) return 3;
  if (
    cell.effectiveStatus === EmployeeComplianceStatus.MISSING ||
    cell.effectiveStatus === EmployeeComplianceStatus.REQUIRED
  ) {
    return 4;
  }
  if (cell.daysRemaining != null && cell.daysRemaining >= 0 && cell.daysRemaining <= 7) {
    return 5;
  }
  if (cell.daysRemaining != null && cell.daysRemaining >= 8 && cell.daysRemaining <= 30) {
    return 6;
  }
  if (ATTENTION_STATUSES.has(cell.effectiveStatus)) return 7;
  return 8;
}

function compareCellsForNextAction(a: BoardCellLike, b: BoardCellLike): number {
  const pa = cellPriority(a);
  const pb = cellPriority(b);
  if (pa !== pb) return pa - pb;
  const da = a.daysRemaining ?? Number.POSITIVE_INFINITY;
  const db = b.daysRemaining ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return a.code.localeCompare(b.code);
}

export function computeNextAction(input: {
  cells: BoardCellLike[];
  blocksAllocation: boolean;
  blockingLabels: string[];
}): BoardNextAction {
  const cells = applicableCells(input.cells).slice().sort(compareCellsForNextAction);
  const top = cells[0];

  // Off-board allocation block with no visible cell issues — surface allocation label.
  if ((!top || cellPriority(top) >= 8) && input.blocksAllocation) {
    const label = input.blockingLabels[0] ?? 'Blocked from rostering';
    return {
      typeCode: null,
      typeName: null,
      kind: 'BLOCKING',
      expiryDate: null,
      daysRemaining: null,
      blocksAllocation: true,
      primary: label,
      secondary: 'Additional compliance issue outside board columns',
    };
  }

  if (!top || cellPriority(top) >= 8) {
    const future = applicableCells(input.cells)
      .filter(
        (c) =>
          c.daysRemaining != null &&
          c.daysRemaining > 30 &&
          c.effectiveStatus !== EmployeeComplianceStatus.NO_LONGER_REQUIRED,
      )
      .sort(
        (a, b) =>
          (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0) || a.code.localeCompare(b.code),
      )[0];
    const futureName = future?.typeName?.trim() || future?.code || null;
    const dateLabel = formatDateIso(future?.expiryDate ?? null);
    return {
      typeCode: future?.code ?? null,
      typeName: future?.typeName ?? null,
      kind: 'NONE',
      expiryDate: future?.expiryDate ?? null,
      daysRemaining: future?.daysRemaining ?? null,
      blocksAllocation: false,
      primary: 'No current issues',
      secondary:
        futureName && dateLabel
          ? `Next expiry: ${futureName} · ${dateLabel}`
          : null,
    };
  }

  const name = top.typeName?.trim() || top.code;
  const days = top.daysRemaining;
  const dateLabel = formatDateIso(top.expiryDate);

  if (top.effectiveStatus === EmployeeComplianceStatus.EXPIRED) {
    const overdue = days != null && days < 0 ? Math.abs(days) : null;
    return {
      typeCode: top.code,
      typeName: top.typeName ?? null,
      kind: 'EXPIRED',
      expiryDate: top.expiryDate,
      daysRemaining: days,
      blocksAllocation: top.blocksRostering && input.blocksAllocation,
      primary: `${name} expired`,
      secondary:
        overdue != null
          ? `${overdue} day${overdue === 1 ? '' : 's'} overdue${dateLabel ? ` · ${dateLabel}` : ''}`
          : dateLabel,
    };
  }

  if (top.effectiveStatus === EmployeeComplianceStatus.REJECTED) {
    return {
      typeCode: top.code,
      typeName: top.typeName ?? null,
      kind: 'REJECTED',
      expiryDate: top.expiryDate,
      daysRemaining: days,
      blocksAllocation: top.blocksRostering && input.blocksAllocation,
      primary: `${name} rejected`,
      secondary: dateLabel,
    };
  }

  if (
    top.effectiveStatus === EmployeeComplianceStatus.MISSING ||
    top.effectiveStatus === EmployeeComplianceStatus.REQUIRED
  ) {
    const missingCount = applicableCells(input.cells).filter(
      (c) =>
        c.isMandatory &&
        (c.effectiveStatus === EmployeeComplianceStatus.MISSING ||
          c.effectiveStatus === EmployeeComplianceStatus.REQUIRED),
    ).length;
    return {
      typeCode: top.code,
      typeName: top.typeName ?? null,
      kind: 'MISSING',
      expiryDate: null,
      daysRemaining: null,
      blocksAllocation: top.blocksRostering && input.blocksAllocation,
      primary:
        missingCount > 1
          ? `${missingCount} required documents missing`
          : `${name} missing`,
      secondary: null,
    };
  }

  if (days != null && days >= 0 && days <= 7) {
    return {
      typeCode: top.code,
      typeName: top.typeName ?? null,
      kind: 'EXPIRING_7',
      expiryDate: top.expiryDate,
      daysRemaining: days,
      blocksAllocation: false,
      primary:
        days === 0
          ? `${name} expires today`
          : `${name} expires in ${days} day${days === 1 ? '' : 's'}`,
      secondary: dateLabel,
    };
  }

  if (days != null && days >= 8 && days <= 30) {
    return {
      typeCode: top.code,
      typeName: top.typeName ?? null,
      kind: 'EXPIRING_30',
      expiryDate: top.expiryDate,
      daysRemaining: days,
      blocksAllocation: false,
      primary: `${name} expires in ${days} days`,
      secondary: dateLabel,
    };
  }

  const blockingLabel = input.blockingLabels[0];
  if (input.blocksAllocation && blockingLabel) {
    return {
      typeCode: top.code,
      typeName: top.typeName ?? null,
      kind: 'BLOCKING',
      expiryDate: top.expiryDate,
      daysRemaining: days,
      blocksAllocation: true,
      primary: blockingLabel,
      secondary: dateLabel,
    };
  }

  return {
    typeCode: top.code,
    typeName: top.typeName ?? null,
    kind: 'WARNING',
    expiryDate: top.expiryDate,
    daysRemaining: days,
    blocksAllocation: false,
    primary: `${name} needs attention`,
    secondary: dateLabel,
  };
}

/** Board-visible compliance issues only (matched to matrix columns). */
export function countBoardIssues(cells: BoardCellLike[]): {
  blockingIssueCount: number;
  warningIssueCount: number;
  totalIssueCount: number;
} {
  const apps = applicableCells(cells);
  let blockingIssueCount = 0;
  let warningIssueCount = 0;
  for (const c of apps) {
    if (!ATTENTION_STATUSES.has(c.effectiveStatus)) continue;
    if (c.effectiveStatus === EmployeeComplianceStatus.NO_LONGER_REQUIRED) continue;
    if (c.blocksRostering && CRITICAL_LIKE.has(c.effectiveStatus)) blockingIssueCount += 1;
    else warningIssueCount += 1;
  }
  return {
    blockingIssueCount,
    warningIssueCount,
    totalIssueCount: blockingIssueCount + warningIssueCount,
  };
}

/**
 * Allocation issues whose labels do not clearly map to a visible board column code/name.
 * Used so the Issues column can show "N visible · M additional" when needed.
 */
export function countOffBoardAllocationIssues(input: {
  cells: BoardCellLike[];
  blockingLabels: string[];
  warningLabels: string[];
}): number {
  const visibleTokens = new Set(
    applicableCells(input.cells).flatMap((c) =>
      [c.code, c.typeName]
        .filter(Boolean)
        .map((s) => String(s).toUpperCase()),
    ),
  );
  const codes = new Set(applicableCells(input.cells).map((c) => c.code.toUpperCase()));

  const allLabels = [...input.blockingLabels, ...input.warningLabels];
  let off = 0;
  for (const label of allLabels) {
    const upper = label.toUpperCase();
    const matchesVisible = [...codes].some((code) => upper.includes(code.replace(/_/g, ' ')) || upper.includes(code));
    const matchesName = [...visibleTokens].some((t) => t.length > 2 && upper.includes(t));
    if (!matchesVisible && !matchesName) off += 1;
  }
  return off;
}

export function nearestExpiry(cells: BoardCellLike[]): {
  nearestExpiryDate: string | null;
  nearestExpiryDays: number | null;
} {
  let best: BoardCellLike | null = null;
  for (const c of applicableCells(cells)) {
    if (c.daysRemaining == null) continue;
    if (c.effectiveStatus === EmployeeComplianceStatus.NO_LONGER_REQUIRED) continue;
    if (!best || (c.daysRemaining ?? 0) < (best.daysRemaining ?? 0)) best = c;
  }
  return {
    nearestExpiryDate: best?.expiryDate ?? null,
    nearestExpiryDays: best?.daysRemaining ?? null,
  };
}

export function cellMatchesDocumentState(
  cells: BoardCellLike[],
  state: BoardDocumentStateFilter,
): boolean {
  const apps = applicableCells(cells);
  switch (state) {
    case 'expired':
      return apps.some((c) => c.effectiveStatus === EmployeeComplianceStatus.EXPIRED);
    case 'expiring_7':
      return apps.some(
        (c) => c.daysRemaining != null && c.daysRemaining >= 0 && c.daysRemaining <= 7,
      );
    case 'expiring_8_30':
      return apps.some(
        (c) => c.daysRemaining != null && c.daysRemaining >= 8 && c.daysRemaining <= 30,
      );
    case 'missing':
      return apps.some(
        (c) =>
          c.effectiveStatus === EmployeeComplianceStatus.MISSING ||
          c.effectiveStatus === EmployeeComplianceStatus.REQUIRED,
      );
    case 'valid':
      return (
        apps.length > 0 &&
        apps.every(
          (c) =>
            c.effectiveStatus === EmployeeComplianceStatus.VALID ||
            c.effectiveStatus === EmployeeComplianceStatus.NO_LONGER_REQUIRED,
        )
      );
    default:
      return true;
  }
}

export function urgencySortKey(row: {
  overallDisplayStatus: BoardDisplayStatus;
  nearestExpiryDays: number | null;
  blockingIssueCount: number;
  employeeName: string;
}): [number, number, string] {
  const statusRank =
    row.overallDisplayStatus === 'BLOCKED'
      ? 0
      : row.overallDisplayStatus === 'ATTENTION'
        ? 1
        : 2;
  const expiryRank =
    row.nearestExpiryDays == null
      ? Number.POSITIVE_INFINITY
      : row.nearestExpiryDays < 0
        ? row.nearestExpiryDays
        : row.nearestExpiryDays;
  return [statusRank, expiryRank, row.employeeName.toLowerCase()];
}

export function buildBoardEmployeeSummaries(rows: Array<{
  overallDisplayStatus: BoardDisplayStatus;
  cells: BoardCellLike[];
}>): {
  needsActionCount: number;
  expiredCount: number;
  expiring7Count: number;
  expiring8To30Count: number;
  fullyCompliantCount: number;
} {
  let needsActionCount = 0;
  let expiredCount = 0;
  let expiring7Count = 0;
  let expiring8To30Count = 0;
  let fullyCompliantCount = 0;

  for (const row of rows) {
    if (row.overallDisplayStatus === 'BLOCKED' || row.overallDisplayStatus === 'ATTENTION') {
      needsActionCount += 1;
    }
    if (row.overallDisplayStatus === 'COMPLIANT') fullyCompliantCount += 1;

    const apps = applicableCells(row.cells);
    const hasExpired = apps.some((c) => c.effectiveStatus === EmployeeComplianceStatus.EXPIRED);
    const has7 = apps.some(
      (c) => c.daysRemaining != null && c.daysRemaining >= 0 && c.daysRemaining <= 7,
    );
    const has830 = apps.some(
      (c) => c.daysRemaining != null && c.daysRemaining >= 8 && c.daysRemaining <= 30,
    );

    if (hasExpired) expiredCount += 1;
    // Mutually exclusive urgency buckets: ≤7 wins over 8–30 for the same employee.
    if (has7) expiring7Count += 1;
    else if (has830) expiring8To30Count += 1;
  }

  return {
    needsActionCount,
    expiredCount,
    expiring7Count,
    expiring8To30Count,
    fullyCompliantCount,
  };
}
