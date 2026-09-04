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
import { checkInMethodDetailLine } from './check-in-display.util';

const DETAIL_MAX = 280;

/** Clock-face HH:mm for timeline — prefer org timezone when provided. */
export function formatTimelineHm(d: Date, timeZone?: string): string {
  if (timeZone) return formatHmInTimeZone(d, timeZone);
  return formatHmUtc(d);
}

export function summarizeTimelineDetail(value: string | null | undefined): string | null {
  if (value == null) return null;
  // Collapse horizontal whitespace but PRESERVE line breaks so multi-line
  // details (e.g. a handover with an "Outstanding action:" line) stay multi-line.
  const trimmed = value
    .trim()
    .replace(/[^\S\n]+/g, ' ') // spaces/tabs → single space (keeps \n)
    .replace(/ *\n */g, '\n') // trim spaces around line breaks
    .replace(/\n{3,}/g, '\n\n'); // cap consecutive blank lines
  if (!trimmed) return null;
  if (trimmed.length <= DETAIL_MAX) return trimmed;
  return `${trimmed.slice(0, DETAIL_MAX - 1)}…`;
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
  if (opts.critical || opts.abnormal) return 'danger';
  return 'teal';
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
  const detail = summarizeTimelineDetail(input.detail);
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
