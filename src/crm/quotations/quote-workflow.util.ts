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

export type DiffRow = {
  section: string;
  field: string;
  from: string | null;
  to: string | null;
};

type Comparable = Record<string, unknown> & {
  patterns?: Array<Record<string, unknown>>;
  fundings?: Array<Record<string, unknown>>;
  extras?: Array<Record<string, unknown>>;
};

const show = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};

/** Field-level differences between two versions (general fields, totals, patterns, funding, extras). */
export function diffVersions(
  a: Comparable,
  b: Comparable,
  fields: Array<[string, string, string]>,
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const [section, key, label] of fields) {
    const from = show(a[key]);
    const to = show(b[key]);
    if (from !== to) rows.push({ section, field: label, from, to });
  }
  const list = (
    section: string,
    key: 'patterns' | 'fundings' | 'extras',
    name: (r: Record<string, unknown>) => string,
    keys: string[],
  ) => {
    const left = a[key] ?? [];
    const right = b[key] ?? [];
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      const l = left[i];
      const r = right[i];
      if (!l) rows.push({ section, field: name(r), from: null, to: 'Added' });
      else if (!r)
        rows.push({ section, field: name(l), from: 'Removed', to: null });
      else
        for (const k of keys) {
          const from = show(l[k]);
          const to = show(r[k]);
          if (from !== to)
            rows.push({ section, field: `${name(r)} · ${k}`, from, to });
        }
    }
  };
  list('Visit schedule', 'patterns', (r) => show(r.label) ?? 'Visit', [
    'label',
    'startTime',
    'endTime',
    'windowEndTime',
    'durationMinutes',
    'daysOfWeek',
    'frequency',
    'oneOffDates',
    'carersPerVisit',
    'nightDuty',
    'chargePerOccurrence',
    'weeklyTotal',
  ]);
  list(
    'Funding',
    'fundings',
    (r) => show(r.payerName) ?? show(r.payerType) ?? 'Payer',
    ['payerType', 'method', 'amount', 'status', 'weeklyAmount'],
  );
  list(
    'Extras',
    'extras',
    (r) => show(r.description) ?? show(r.kind) ?? 'Extra',
    ['kind', 'frequency', 'amount', 'quantity', 'isPercentage', 'total'],
  );
  return rows;
}
