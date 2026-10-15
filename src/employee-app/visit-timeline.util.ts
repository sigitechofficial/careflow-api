import type { Prisma } from '@prisma/client';
import type {
  VisitTimelineApiItem,
  VisitTimelineEventType,
  VisitTimelineSourceType,
  VisitTimelineTone,
  VisitTimelineUpsertInput,
} from './visit-timeline.types';
import {
  formatHmInTimeZone,
  formatHmUtc,
} from '../common/utils/operational-day.util';
import { formatVisitObservationValue } from '../service-user-observations/visit-observations-catalog.service';
import { checkInMethodDetailLine } from './check-in-display.util';

const DETAIL_MAX = 280;

/**
 * Carer-written log entries keep their full text (visit note, handover, concern,
 * incident) so every carer on the visit can read the whole entry. Covers the
 * longest body (8000) plus a handover's outstanding action (2000).
 */
export const LOG_DETAIL_MAX = 12000;
export const FULL_DETAIL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'visit_note',
  'handover',
  'concern',
  'incident',
]);

/** Clock-face HH:mm for timeline — prefer org timezone when provided. */
export function formatTimelineHm(d: Date, timeZone?: string): string {
  if (timeZone) return formatHmInTimeZone(d, timeZone);
  return formatHmUtc(d);
}

export function summarizeTimelineDetail(
  value: string | null | undefined,
  maxLength: number = DETAIL_MAX,
): string | null {
  if (value == null) return null;
  // Collapse horizontal whitespace but PRESERVE line breaks so multi-line
  // details (e.g. a handover with an "Outstanding action:" line) stay multi-line.
  const trimmed = value
    .trim()
    .replace(/[^\S\n]+/g, ' ') // spaces/tabs → single space (keeps \n)
    .replace(/ *\n */g, '\n') // trim spaces around line breaks
    .replace(/\n{3,}/g, '\n\n'); // cap consecutive blank lines
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function timelineIdempotencyKey(
  scheduledJobId: string,
  sourceType: VisitTimelineSourceType,
  sourceId: string,
  eventType: VisitTimelineEventType,
  writeIdempotencyKey?: string | null,
): string {
  // Prefer deterministic composite so retries of the same source upsert cleanly.
  // Optionally incorporate write key when present for audit correlation.
  const base = `${scheduledJobId}:${sourceType}:${sourceId}:${eventType}`;
  if (writeIdempotencyKey?.trim()) {
    return `${base}:${writeIdempotencyKey.trim()}`.slice(0, 128);
  }
  return base.slice(0, 128);
}

export function taskOutcomeTimelineDetail(outcome: string): string {
  switch (outcome.toUpperCase()) {
    case 'COMPLETED':
      return 'Completed';
    case 'PARTIAL':
      return 'Partially completed';
    case 'DECLINED':
      return 'Declined';
    default:
      return outcome;
  }
}

export function taskOutcomeTimelineTone(outcome: string): VisitTimelineTone {
  const upper = outcome.toUpperCase();
  if (upper === 'DECLINED' || upper === 'UNABLE' || upper === 'REFUSED') return 'danger';
  return 'success';
}

export function medicationTimelineTone(status: string): VisitTimelineTone {
  const upper = status.toUpperCase();
  if (
    upper === 'REFUSED' ||
    upper === 'NOT_GIVEN' ||
    upper === 'CANCELLED' ||
    upper === 'HELD' ||
    upper === 'R'
  ) {
    return 'danger';
  }
  return 'success';
}

export function medicationOutcomeLabel(
  outcomeLabel: string | null | undefined,
  status: string,
): string {
  if (outcomeLabel?.trim()) return outcomeLabel.trim();
  switch (status.toUpperCase()) {
    case 'GIVEN':
      return 'Given';
    case 'REFUSED':
      return 'Refused';
    case 'NOT_GIVEN':
      return 'Not given';
    case 'CANCELLED':
      return 'Cancelled';
    case 'HELD':
      return 'Held';
    default:
      return status;
  }
}

export function observationTimelineTone(opts: {
  abnormal?: boolean | null;
  critical?: boolean | null;
}): VisitTimelineTone {
  if (opts.critical) return 'danger';
  if (opts.abnormal) return 'warning';
  return 'teal';
}

function observationRangeWarning(opts: {
  payload?: Record<string, unknown> | null;
  abnormal?: boolean | null;
  critical?: boolean | null;
}): string | null {
  const payload = opts.payload ?? {};
  const critical = Boolean(opts.critical ?? payload.critical);
  const abnormal = Boolean(opts.abnormal ?? payload.abnormal);
  if (critical) return 'Critical — outside expected range';
  if (abnormal) return 'Outside expected range';
  return null;
}

/** Log-tab detail: BP must be systolic/diastolic, not the systolic-only numericValue. */
export function observationTimelineDetail(input: {
  typeCode?: string | null;
  numericValue?: number | null;
  unit?: string | null;
  payload?: Record<string, unknown> | null;
  value?: unknown;
  outcome?: string | null;
  unableReasonCode?: string | null;
  abnormal?: boolean | null;
  critical?: boolean | null;
}): string | null {
  const outcome = (input.outcome ?? '').trim().toLowerCase();
  if (outcome === 'unable') {
    return input.unableReasonCode?.trim() || 'Unable';
  }
  const formatted = formatVisitObservationValue({
    numericValue: input.numericValue ?? null,
    unit: input.unit ?? null,
    payload: (input.payload ?? null) as Prisma.JsonValue | null,
    observationType: input.typeCode ? { code: input.typeCode } : undefined,
  });
  const warn = observationRangeWarning({
    payload: input.payload,
    abnormal: input.abnormal,
    critical: input.critical,
  });
  if (formatted?.trim()) {
    const value = formatted.trim();
    return warn ? `${value} · ${warn}` : value;
  }
  if (input.value != null) {
    const raw = String(input.value).trim();
    if (raw) return warn ? `${raw} · ${warn}` : raw;
  }
  if (input.numericValue != null && Number.isFinite(input.numericValue)) {
    const raw = String(input.numericValue);
    return warn ? `${raw} · ${warn}` : raw;
  }
  return warn ?? (input.outcome?.trim() || null);
}

export function concernTimelineTone(severity?: string | null): VisitTimelineTone {
  const s = (severity ?? '').toLowerCase();
  if (s === 'high' || s === 'critical' || s === 'urgent') return 'danger';
  if (s === 'medium' || s === 'moderate') return 'warning';
  return 'warning';
}

export function handoverTimelineTone(priority?: string | null): VisitTimelineTone {
  const p = (priority ?? '').toLowerCase();
  if (p === 'high' || p === 'urgent' || p === 'important') return 'warning';
  return 'ink';
}

export function checkInTimelineDetail(method?: string | null): string {
  return checkInMethodDetailLine(method);
}

export function parseOccurredAt(
  deviceRecordedAt: string | Date | null | undefined,
  fallback: Date = new Date(),
): Date {
  if (deviceRecordedAt instanceof Date && !Number.isNaN(deviceRecordedAt.getTime())) {
    return deviceRecordedAt;
  }
  if (typeof deviceRecordedAt === 'string' && deviceRecordedAt.trim()) {
    const d = new Date(deviceRecordedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

export function mapRowToTimelineApiItem(
  row: {
    id: string;
    eventType: string;
    occurredAt: Date;
    timeLabel: string | null;
    title: string;
    detail: string | null;
    tone: string | null;
    sourceType: string;
    sourceId: string;
    logEntryId: string | null;
  },
  timeZone?: string,
): VisitTimelineApiItem {
  /** Prefer org-TZ clock face from occurredAt when TZ known (ignore stale UTC-stored labels). */
  const time = timeZone
    ? formatTimelineHm(row.occurredAt, timeZone)
    : row.timeLabel?.trim() || formatTimelineHm(row.occurredAt);
  const detail = row.detail ?? null;
  return {
    id: row.id,
    time,
    timeLabel: time,
    title: row.title,
    detail,
    subtitle: detail,
    tone: (row.tone as VisitTimelineTone | null) ?? null,
    type: row.eventType as VisitTimelineEventType,
    occurredAt: row.occurredAt.toISOString(),
    at: row.occurredAt.toISOString(),
    sourceType: row.sourceType as VisitTimelineSourceType,
    sourceId: row.sourceId,
    logEntryId: row.logEntryId,
  };
}

/** Ascending by occurredAt, then id (stable). */
export function sortTimelineRows<T extends { occurredAt: Date; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const t = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

export function buildTimelineUpsertData(input: VisitTimelineUpsertInput, timeZone?: string) {
  const occurredAt = input.occurredAt;
  const timeLabel = formatTimelineHm(occurredAt, timeZone);
  const detail = summarizeTimelineDetail(
    input.detail,
    FULL_DETAIL_EVENT_TYPES.has(input.eventType) ? LOG_DETAIL_MAX : undefined,
  );
  const idempotencyKey = timelineIdempotencyKey(
    input.scheduledJobId,
    input.sourceType,
    input.sourceId,
    input.eventType,
  );
  return {
    scheduledJobId: input.scheduledJobId,
    scheduledVisitId: input.scheduledVisitId ?? null,
    eventType: input.eventType,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title.trim() || 'Activity',
    detail,
    tone: input.tone ?? null,
    occurredAt,
    timeLabel,
    logEntryId: input.logEntryId ?? null,
    isDraft: Boolean(input.isDraft),
    createdByEmployeeId: input.createdByEmployeeId ?? null,
    idempotencyKey,
  };
}
