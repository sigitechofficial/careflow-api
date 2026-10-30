import type { EnquiryQuoteStatus } from '@prisma/client';

/** Allowed version status moves. Anything not listed is refused (409). */
export const QUOTE_TRANSITIONS: Record<
  EnquiryQuoteStatus,
  EnquiryQuoteStatus[]
> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SENT', 'SUPERSEDED', 'CANCELLED'],
  SENT: [
    'ACCEPTED',
    'DECLINED',
    'CHANGES_REQUESTED',
    'UNDER_NEGOTIATION',
    'EXPIRED',
    'SUPERSEDED',
    'CANCELLED',
  ],
  UNDER_NEGOTIATION: [
    'ACCEPTED',
    'DECLINED',
    'CHANGES_REQUESTED',
    'EXPIRED',
    'SUPERSEDED',
    'CANCELLED',
  ],
  CHANGES_REQUESTED: ['ACCEPTED', 'DECLINED', 'SUPERSEDED', 'CANCELLED'],
  EXPIRED: ['SUPERSEDED', 'CANCELLED'],
  ACCEPTED: [],
  DECLINED: [],
  SUPERSEDED: [],
  CANCELLED: [],
};

export function canTransition(
  from: EnquiryQuoteStatus,
  to: EnquiryQuoteStatus,
): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

/** Only drafts can be edited; everything else is an issued (frozen) version. */
export const isEditable = (status: EnquiryQuoteStatus) => status === 'DRAFT';

/** The client has the quote (sent or recorded as sent) and has not given a final answer. */
export const AWAITING_CLIENT: EnquiryQuoteStatus[] = [
  'SENT',
  'UNDER_NEGOTIATION',
  'CHANGES_REQUESTED',
];

/** Statuses a response can be recorded against. */
export const RESPONDABLE: EnquiryQuoteStatus[] = [
  'SENT',
  'UNDER_NEGOTIATION',
  'CHANGES_REQUESTED',
  'EXPIRED',
];

/** Versions that may be sent (first send or a re-send). */
export const SENDABLE: EnquiryQuoteStatus[] = [
  'APPROVED',
  'SENT',
  'UNDER_NEGOTIATION',
];

export const QUOTE_STATUS_LABELS: Record<EnquiryQuoteStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  SENT: 'Sent',
  CHANGES_REQUESTED: 'Changes requested',
  UNDER_NEGOTIATION: 'Under negotiation',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  SUPERSEDED: 'Superseded',
  CANCELLED: 'Cancelled',
};

export function formatQuotationNumber(year: number, sequence: number): string {
  return `EQ-${year}-${String(sequence).padStart(4, '0')}`;
}

/* ─── version comparison ──────────────────────────────────────────────── */

/** How a compared value is shown; money changes also get a difference (+£ / −£). */
export type DiffFormat =
  | 'text'
  | 'money'
  | 'hours'
  | 'date'
  | 'minutes'
  | 'days'
  | 'enum'
  | 'yesno';

export type DiffRow = {
  section: string;
  /** The visit, funder or extra the row belongs to ("Visit 2 · Morning visit"); null for quote fields. */
  item: string | null;
  field: string;
  from: string | null;
  to: string | null;
  change: 'changed' | 'added' | 'removed';
  /** For money fields: the new value minus the old one. */
  delta: number | null;
};

type Comparable = Record<string, unknown> & {
  patterns?: Array<Record<string, unknown>>;
  fundings?: Array<Record<string, unknown>>;
  extras?: Array<Record<string, unknown>>;
};

const ENUM_LABELS: Record<string, string> = {
  WEEKLY: 'Every week',
  FORTNIGHTLY: 'Every 2 weeks',
  FOUR_WEEKLY: 'Every 4 weeks',
  ONE_OFF: 'One-off',
  MONTHLY: 'Monthly',
  NONE: 'Day visit',
  SLEEPING_NIGHT: 'Sleeping night',
  WAKING_NIGHT: 'Waking night',
  FIXED: '£ per week',
  PERCENTAGE: '% of the weekly total',
  PER_VISIT: '£ per visit',
  PENDING_APPROVAL: 'Pending approval',
  CONFIRMED: 'Confirmed',
  PRIVATE_CLIENT: 'Private client',
  LOCAL_AUTHORITY: 'Local authority',
  DETAILED: 'Visits with times & rates',
  SUMMARY: 'Total amount & visit slots',
  PROVISIONAL_ESTIMATE: 'Provisional estimate',
  FINAL: 'Final quotation',
  SETUP_FEE: 'Set-up fee',
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const money = (n: number) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A value in words: £ amounts, hours, dates, day names and plain-English options. */
export function formatDiffValue(
  v: unknown,
  format: DiffFormat = 'text',
): string | null {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (format === 'days') {
      const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => v.includes(d));
      return days.length === 7
        ? 'Every day'
        : days.map((d) => DAY_NAMES[d]).join(', ');
    }
    if (format === 'date')
      return v.map((d) => formatDiffValue(d, 'date')).join(', ');
    return v.join(', ');
  }
  if (format === 'money' && typeof v === 'number') return money(v);
  if (format === 'hours' && typeof v === 'number') return `${v} h`;
  if (format === 'minutes' && typeof v === 'number') return `${v} min`;
  if (format === 'yesno') return v ? 'Yes' : 'No';
  if (format === 'date') {
    if (!(v instanceof Date) && typeof v !== 'string') return JSON.stringify(v);
    const iso = v instanceof Date ? v.toISOString() : v;
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        });
  }
  if (format === 'enum' && typeof v === 'string')
    return (
      ENUM_LABELS[v] ??
      v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ')
    );
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

const asNumber = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Differences between two versions in plain words: the quote's own fields, then each visit,
 * funder and extra (matched by position) with what was added, removed or changed.
 */
export function diffVersions(
  a: Comparable,
  b: Comparable,
  fields: Array<[string, string, string, DiffFormat?]>,
  options: { visitPrices?: boolean } = {},
): DiffRow[] {
  const rows: DiffRow[] = [];
  const push = (
    section: string,
    item: string | null,
    field: string,
    l: unknown,
    r: unknown,
    format: DiffFormat = 'text',
  ) => {
    const from = formatDiffValue(l, format);
    const to = formatDiffValue(r, format);
    if (from === to) return;
    const ln = asNumber(l);
    const rn = asNumber(r);
    rows.push({
      section,
      item,
      field,
      from,
      to,
      change: 'changed',
      delta:
        format === 'money' && ln != null && rn != null
          ? Math.round((rn - ln) * 100) / 100
          : null,
    });
  };
  for (const [section, key, label, format] of fields)
    push(section, null, label, a[key], b[key], format);

  const list = (
    section: string,
    noun: string,
    key: 'patterns' | 'fundings' | 'extras',
    name: (r: Record<string, unknown>) => string | null,
    keys: Array<
      [
        string,
        string,
        DiffFormat | ((r: Record<string, unknown>) => DiffFormat),
      ]
    >,
  ) => {
    const left = a[key] ?? [];
    const right = b[key] ?? [];
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      const l = left[i];
      const r = right[i];
      const item = `${noun} ${i + 1}${name(r ?? l) ? ` · ${name(r ?? l)}` : ''}`;
      if (!l || !r) {
        rows.push({
          section,
          item,
          field: noun,
          from: l ? 'Removed' : null,
          to: r ? 'Added' : null,
          change: l ? 'removed' : 'added',
          delta: null,
        });
        continue;
      }
      for (const [k, label, format] of keys)
        push(
          section,
          item,
          label,
          l[k],
          r[k],
          typeof format === 'function' ? format(r) : format,
        );
    }
  };
  list('Visits', 'Visit', 'patterns', (r) => formatDiffValue(r.label), [
    ['label', 'Name', 'text'],
    ['startTime', 'Start time', 'text'],
    ['endTime', 'End time', 'text'],
    ['windowEndTime', 'Window ends', 'text'],
    ['durationMinutes', 'Length', 'minutes'],
    ['daysOfWeek', 'Days', 'days'],
    ['frequency', 'How often', 'enum'],
    ['oneOffDates', 'Dates', 'date'],
    ['carersPerVisit', 'Carers', 'text'],
    ['nightDuty', 'Night type', 'enum'],
    // Not when either version is a "total amount" quote: its visits have no prices of their own.
    ...(options.visitPrices === false
      ? []
      : ([
          ['chargePerOccurrence', 'Price per visit', 'money'],
          ['weeklyTotal', 'Weekly price', 'money'],
        ] as Array<[string, string, DiffFormat]>)),
  ]);
  list(
    'Funding',
    'Funder',
    'fundings',
    (r) => formatDiffValue(r.payerName) ?? formatDiffValue(r.payerType, 'enum'),
    [
      ['payerType', 'Payer type', 'enum'],
      ['method', 'Pays', 'enum'],
      [
        'amount',
        'Amount',
        (r) => (r.method === 'PERCENTAGE' ? 'text' : 'money'),
      ],
      ['status', 'Status', 'enum'],
      ['weeklyAmount', 'Covers per week', 'money'],
    ],
  );
  list(
    'Extras',
    'Extra',
    'extras',
    (r) => formatDiffValue(r.description) ?? formatDiffValue(r.kind, 'enum'),
    [
      ['kind', 'Type', 'enum'],
      ['frequency', 'How often', 'enum'],
      ['amount', 'Amount', (r) => (r.isPercentage ? 'text' : 'money')],
      ['quantity', 'Quantity', 'text'],
      ['isPercentage', 'As a %', 'yesno'],
      ['total', 'Total', 'money'],
    ],
  );
  return rows;
}
