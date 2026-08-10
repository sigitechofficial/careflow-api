/** Visit timeline event types persisted for employee-app details → data.log.timeline */
export type VisitTimelineEventType =
  | 'clock_in'
  | 'clock_out'
  | 'task'
  | 'medication'
  | 'observation'
  | 'visit_note'
  | 'handover'
  | 'concern'
  | 'incident'
  | 'presence'
  | 'body_map';

export type VisitTimelineSourceType =
  | 'check_in'
  | 'task'
  | 'medication'
  | 'observation'
  | 'log_note'
  | 'handover'
  | 'concern'
  | 'incident'
  | 'complete'
  | 'presence'
  | 'body_map';

export type VisitTimelineTone =
  | 'primary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'teal'
  | 'ink';

/** Singleton source ids so visit note / handover stay one row per visit. */
export const VISIT_NOTE_TIMELINE_SOURCE_ID = 'visit_note';
export const HANDOVER_TIMELINE_SOURCE_ID = 'handover';

export type VisitTimelineUpsertInput = {
  scheduledJobId: string;
  scheduledVisitId?: string | null;
  eventType: VisitTimelineEventType;
  sourceType: VisitTimelineSourceType;
  sourceId: string;
  title: string;
  detail?: string | null;
  tone?: VisitTimelineTone | null;
  occurredAt: Date;
  logEntryId?: string | null;
  isDraft?: boolean;
  createdByEmployeeId?: string | null;
  /** Optional mobile write idempotency key (namespaced when stored). */
  writeIdempotencyKey?: string | null;
};

export type VisitTimelineApiItem = {
  id: string;
  time: string;
  title: string;
  detail: string | null;
  subtitle: string | null;
  tone: VisitTimelineTone | null;
  type: VisitTimelineEventType;
  occurredAt: string;
  sourceType: VisitTimelineSourceType;
  sourceId: string;
  logEntryId: string | null;
  /** Legacy alias used by older mobile parsers */
  at: string;
  timeLabel: string;
};
