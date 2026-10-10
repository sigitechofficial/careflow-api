import * as path from 'path';

/**
 * Carer voice notes (audio on visit note / handover / concern).
 *
 * Stored under a private root that is NOT served by the `/uploads` static
 * middleware — playback goes only through permission-checked endpoints.
 */
export const VISIT_VOICE_NOTE_STORAGE_DIR = path.join('storage', 'visit-voice-notes');

/** 5 min of AAC at 64 kbps ≈ 2.4 MB — keep generous headroom for higher bitrates. */
export const VISIT_VOICE_NOTE_MAX_BYTES = 15 * 1024 * 1024;

/** App caps recording at 5:00; allow a little slack for encoder rounding. */
export const VISIT_VOICE_NOTE_MAX_DURATION_MS = 5 * 60 * 1000 + 5000;

/** Log entries whose own write carries `voiceNoteIds` (note / handover / concern). */
export const VISIT_VOICE_NOTE_LOG_ENTRY_TYPES = ['visit_note', 'handover', 'concern'] as const;

/**
 * Records linked to their voice notes through `voiceNoteLinks` (PUT …/voice-notes/links)
 * instead of their own DTO — one generic path for every other dictation surface.
 */
export const VISIT_VOICE_NOTE_LINKED_ENTRY_TYPES = [
  'incident',
  'task',
  'medication',
  'observation',
  'body_map',
  'body_map_review',
  'check_in',
  'clock_out',
  'unable_to_start',
  'check_in_request',
  'sos',
] as const;

export const VISIT_VOICE_NOTE_ENTRY_TYPES = [
  ...VISIT_VOICE_NOTE_LOG_ENTRY_TYPES,
  ...VISIT_VOICE_NOTE_LINKED_ENTRY_TYPES,
] as const;
export type VisitVoiceNoteEntryType = (typeof VISIT_VOICE_NOTE_ENTRY_TYPES)[number];
export type VisitVoiceNoteLinkedEntryType = (typeof VISIT_VOICE_NOTE_LINKED_ENTRY_TYPES)[number];

/** Office-facing label for where a voice note was recorded. */
export const VISIT_VOICE_NOTE_ENTRY_LABELS: Record<VisitVoiceNoteEntryType, string> = {
  visit_note: 'Visit note',
  handover: 'Handover',
  concern: 'Concern',
  incident: 'Incident',
  task: 'Task',
  medication: 'Medication',
  observation: 'Observation',
  body_map: 'Body map',
  body_map_review: 'Body map review',
  check_in: 'Clock in',
  clock_out: 'Clock out',
  unable_to_start: 'Unable to start',
  check_in_request: 'Check-in request',
  sos: 'SOS',
};

/**
 * Entry types that must respect the mid-visit area lock (clinical records). Office-contact
 * types (SOS, check-in request, unable to start, clock in/out) must always get through.
 */
export const VISIT_VOICE_NOTE_AREA_LOCKED_TYPES: ReadonlySet<string> = new Set([
  'visit_note',
  'handover',
  'concern',
  'incident',
  'task',
  'medication',
  'observation',
  'body_map',
  'body_map_review',
]);

export function isVisitVoiceNoteLinkedEntryType(
  value: unknown,
): value is VisitVoiceNoteLinkedEntryType {
  return (
    typeof value === 'string' &&
    (VISIT_VOICE_NOTE_LINKED_ENTRY_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Key under `metadata.employeeApp.voiceNoteLinks`. One per record save when the save has
 * an idempotency key (MAR creates a new event per save), otherwise one per record.
 */
export function voiceNoteLinkKey(input: {
  entryType: string;
  entryId: string;
  writeIdempotencyKey?: string | null;
}): string {
  const key = input.writeIdempotencyKey?.trim();
  return key ? `idem:${key}` : `${input.entryType}:${input.entryId}`;
}

/** A stored link (metadata JSON) — the record and the voice notes it points at. */
export type StoredVoiceNoteLink = {
  entryType: string;
  entryId: string;
  writeIdempotencyKey: string | null;
  voiceNoteIds: string[];
  recordedByEmployeeId: string | null;
  updatedAt: string;
};

export function parseVoiceNoteLinks(
  employeeApp: Record<string, unknown> | null | undefined,
): StoredVoiceNoteLink[] {
  const raw = employeeApp?.voiceNoteLinks;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: StoredVoiceNoteLink[] = [];
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const entryType = typeof row.entryType === 'string' ? row.entryType : '';
    const entryId = typeof row.entryId === 'string' ? row.entryId : '';
    if (!entryType || !entryId) continue;
    out.push({
      entryType,
      entryId,
      writeIdempotencyKey:
        typeof row.writeIdempotencyKey === 'string' && row.writeIdempotencyKey
          ? row.writeIdempotencyKey
          : null,
      voiceNoteIds: voiceNoteIdsOfEntry(row),
      recordedByEmployeeId:
        typeof row.recordedByEmployeeId === 'string' ? row.recordedByEmployeeId : null,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    });
  }
  return out;
}

/**
 * Timeline source a linked record maps to when its save key isn't on a timeline event
 * (tasks/incidents keep one event per record; clock in/out and unable-to-start are
 * job-level events).
 */
export function timelineSourceForLink(
  link: Pick<StoredVoiceNoteLink, 'entryType' | 'entryId' | 'recordedByEmployeeId'>,
): { sourceType: string; sourceId: string } | null {
  switch (link.entryType) {
    case 'task':
      return { sourceType: 'task', sourceId: link.entryId };
    case 'incident':
      return { sourceType: 'incident', sourceId: link.entryId };
    case 'check_in':
      return link.recordedByEmployeeId
        ? { sourceType: 'check_in', sourceId: `check_in:${link.recordedByEmployeeId}` }
        : null;
    case 'clock_out':
      return { sourceType: 'complete', sourceId: 'complete' };
    case 'unable_to_start':
      return { sourceType: 'complete', sourceId: 'unable_to_start' };
    default:
      return null;
  }
}

/** Declared types the app / browsers send for AAC audio (bytes are checked separately). */
const ACCEPTED_DECLARED_TYPES = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/x-aac',
  'application/octet-stream',
]);

export function isAcceptedVoiceNoteDeclaredType(mimeType: string | undefined): boolean {
  return ACCEPTED_DECLARED_TYPES.has((mimeType ?? '').toLowerCase().trim());
}

/**
 * Sniffs the real container from the bytes. Returns the stored mime + extension,
 * or null when the file is not MP4/M4A (`ftyp` box) or raw ADTS AAC.
 */
export function detectVoiceNoteFormat(
  buffer: Buffer | undefined,
): { mimeType: string; ext: string } | null {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    return { mimeType: 'audio/mp4', ext: '.m4a' };
  }
  // ADTS sync word 0xFFF + layer 00.
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) {
    return { mimeType: 'audio/aac', ext: '.aac' };
  }
  return null;
}

export function isVisitVoiceNoteEntryType(value: unknown): value is VisitVoiceNoteEntryType {
  return (
    typeof value === 'string' &&
    (VISIT_VOICE_NOTE_ENTRY_TYPES as readonly string[]).includes(value)
  );
}

/** `m:ss` label used in timeline detail when a note is voice-only. */
export function formatVoiceNoteDuration(durationMs: number | null | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return '';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Most voice notes one log entry can carry. */
export const VISIT_VOICE_NOTES_PER_ENTRY = 3;

/**
 * Timeline detail for a voice-only entry: "Voice note (0:42)" or
 * "3 voice notes (2:10)" ([durationMs] is the total length).
 */
export function voiceOnlyTimelineDetail(durationMs?: number | null, count = 1): string {
  const label = formatVoiceNoteDuration(durationMs);
  const what = count > 1 ? `${count} voice notes` : 'Voice note';
  return label ? `${what} (${label})` : what;
}

/** An entry's voice note ids — `voiceNoteIds`, or the legacy single `voiceNoteId`. */
export function voiceNoteIdsOfEntry(entry: {
  voiceNoteIds?: unknown;
  voiceNoteId?: unknown;
}): string[] {
  const raw = Array.isArray(entry.voiceNoteIds) ? entry.voiceNoteIds : [entry.voiceNoteId];
  const ids: string[] = [];
  for (const v of raw) {
    const id = typeof v === 'string' ? v.trim() : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, VISIT_VOICE_NOTES_PER_ENTRY);
}

/** Absolute path for a stored voice note; rejects paths escaping the private root. */
export function resolveVoiceNoteAbsolutePath(storagePath: string): string | null {
  const root = path.resolve(process.cwd(), VISIT_VOICE_NOTE_STORAGE_DIR);
  const abs = path.resolve(process.cwd(), storagePath);
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** Shape attached to admin / app timeline items. */
export type VisitVoiceNoteApiItem = {
  id: string;
  clientVoiceNoteId: string;
  durationMs: number | null;
  mimeType: string;
  sizeBytes: number;
  recordedAt: string | null;
  downloadUrl: string;
};

/**
 * logEntryId → clientVoiceNoteIds (in order) for saved notes / handover /
 * concerns in `ScheduledJob.metadata.employeeApp`. Only the voice notes the
 * entry currently points at are shown (removed recordings never resurface).
 */
export function voiceNoteIdsByLogEntryId(
  employeeApp: Record<string, unknown> | null | undefined,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!employeeApp) return map;
  const add = (entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const ids = voiceNoteIdsOfEntry(row);
    if (id && ids.length) map.set(id, ids);
  };
  if (Array.isArray(employeeApp.notes)) employeeApp.notes.forEach(add);
  if (Array.isArray(employeeApp.concerns)) employeeApp.concerns.forEach(add);
  add(employeeApp.handoverNote);
  return map;
}

/** Admin: one record's voice notes, with where it sits on the visit timeline. */
export type VisitVoiceNoteGroupApi = {
  entryType: string;
  /** Office label, e.g. "Task", "Medication", "SOS". */
  label: string;
  /** Carer-app record id (task key, incident id, MAR save key …). */
  entryId: string;
  timelineEventId: string | null;
  sourceType: string | null;
  /** Server record id where known (observation / MAR event / body map record / task key). */
  sourceId: string | null;
  /** Incident register row, for the admin incident page. */
  registerIncidentId: string | null;
  voiceNotes: VisitVoiceNoteApiItem[];
};
