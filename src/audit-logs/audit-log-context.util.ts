import type { AuditLog, AuditEventType } from '@prisma/client';
import { resolveAuditEventType } from './audit-event-type.util';

export type AuditLogContext = {
  serviceUserId: string | null;
  serviceUserName: string | null;
  subject: string | null;
  eventLabel: string;
  summary: string;
  eventType: AuditEventType;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function formatServiceUserDisplayName(user: {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  serviceUserNumber?: string | null;
}): string {
  const base =
    user.preferredName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    'Service user';
  if (user.serviceUserNumber?.trim()) {
    return `${base} (#${user.serviceUserNumber.trim()})`;
  }
  return base;
}

export function pickMedicationNameFromAuditRow(row: {
  metadata: unknown;
  newValues: unknown;
  oldValues: unknown;
}): string | null {
  const meta = asRecord(row.metadata);
  const fromMeta = str(meta?.medicationName);
  if (fromMeta) return fromMeta;
  const nv = asRecord(row.newValues);
  const ov = asRecord(row.oldValues);
  return str(nv?.medicationName) ?? str(ov?.medicationName);
}

export function pickObservationSubjectFromAuditRow(row: {
  metadata: unknown;
  newValues: unknown;
  oldValues: unknown;
}): string | null {
  const meta = asRecord(row.metadata);
  const typeName = str(meta?.observationTypeName);
  const valueLabel = str(meta?.valueLabel);
  if (typeName && valueLabel) return `${typeName}: ${valueLabel}`;
  if (typeName) return typeName;

  const snap = asRecord(row.newValues) ?? asRecord(row.oldValues);
  if (!snap) return null;

  const obsType = asRecord(snap.observationType);
  const name = str(obsType?.name);
  const numericValue = snap.numericValue;
  const unit = str(snap.unit);
  if (name && numericValue != null && numericValue !== '') {
    return unit ? `${name}: ${numericValue} ${unit}` : `${name}: ${numericValue}`;
  }
  return name;
}

export function pickLocationSubjectFromAuditRow(row: {
  action: string;
  newValues?: unknown;
  oldValues?: unknown;
}): string | null {
  if (!row.action.startsWith('location.')) return null;
  const snap = asRecord(row.newValues) ?? asRecord(row.oldValues);
  if (!snap) return null;
  const name = str(snap.name);
  if (name) return name;
  const parts = [str(snap.zoneName), str(snap.branchName), str(snap.areaName), str(snap.postcode)].filter(
    Boolean,
  );
  return parts.length ? parts.join(' / ') : null;
}

export function resolveServiceUserIdFromAuditRow(row: {
  recordType: string | null;
  recordId: string | null;
  metadata: unknown;
  newValues?: unknown;
  oldValues?: unknown;
}): string | null {
  const meta = asRecord(row.metadata);
  const fromMeta = str(meta?.serviceUserId);
  if (fromMeta) return fromMeta;

  const nv = asRecord(row.newValues);
  const ov = asRecord(row.oldValues);
  const fromSnap = str(nv?.serviceUserId) ?? str(ov?.serviceUserId);
  if (fromSnap) return fromSnap;

  const recordType = row.recordType ?? '';
  const recordId = str(row.recordId);
  if (!recordId) return null;

  if (
    recordType === 'ServiceUser' ||
    recordType === 'MedicationChart' ||
    recordType === 'ServiceUserCalendarView'
  ) {
    return recordId;
  }

  return null;
}

const ACTION_EVENT_LABELS: Record<string, string> = {
  medication_chart_viewed: 'Opened MAR chart',
  medication_created: 'Added medication',
  medication_updated: 'Updated medication',
  medication_archived: 'Archived medication',
  medication_restored: 'Restored medication',
  medication_status_changed: 'Changed medication status',
  medication_administration_recorded: 'Recorded administration',
  medication_administration_corrected: 'Corrected administration',
  medication_administration_reviewed: 'Reviewed administration',
  service_user_profile_viewed: 'Opened profile',
  service_user_flash_message_viewed: 'Viewed flash message',
  service_user_global_calendar_viewed: 'Opened global calendar',
  service_user_observation_created: 'Recorded observation',
  service_user_observation_updated: 'Updated observation',
  service_user_observation_deleted: 'Removed observation',
  'location.zone.created': 'Created zone',
  'location.zone.updated': 'Updated zone',
  'location.branch.created': 'Created branch',
  'location.branch.updated': 'Updated branch',
  'location.branch.deleted': 'Deleted branch',
  'location.area.created': 'Created area',
  'location.area.updated': 'Updated area',
  'location.area.deleted': 'Deleted area',
  'location.area.postcodes.updated': 'Updated area postcodes',
  'location.service_user.assigned': 'Assigned service user location',
  'location.employee.assigned': 'Assigned employee location',
};

function formatActionFallback(action: string): string {
  return action.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildEventLabel(row: { action: string; metadata: unknown }): string {
  const meta = asRecord(row.metadata);
  const base =
    ACTION_EVENT_LABELS[row.action] ?? formatActionFallback(row.action);

  if (row.action === 'medication_chart_viewed') {
    const chart = str(meta?.chart);
    if (chart === 'regular' || chart === 'prn') {
      return `${base} (${chart.toUpperCase()})`;
    }
  }

  return base;
}

function buildSummaryText(
  row: {
    action: string;
    description: string | null;
    metadata: unknown;
  },
  ctx: {
    serviceUserName: string | null;
    subject: string | null;
    eventLabel: string;
  },
): string {
  if (row.description?.trim()) return row.description.trim();

  const meta = asRecord(row.metadata);
  if (meta?.autoEndDate === true) {
    const med = ctx.subject;
    return med
      ? `${med} ended automatically (prescription end date passed)`
      : 'Medication ended automatically (prescription end date passed)';
  }
  if (meta?.correction === true) {
    return ctx.subject
      ? `Corrected administration record for ${ctx.subject}`
      : 'Administration record corrected';
  }
  if (meta?.managerReview === true) {
    return ctx.subject
      ? `Manager review for ${ctx.subject}`
      : 'Manager review recorded';
  }
  if (meta?.restored === true || row.action === 'medication_restored') {
    return ctx.subject
      ? `Restored ${ctx.subject} from archive`
      : 'Medication restored from archive';
  }

  const parts: string[] = [ctx.eventLabel];
  if (ctx.subject) parts.push(`— ${ctx.subject}`);
  if (ctx.serviceUserName) parts.push(`for ${ctx.serviceUserName}`);
  return parts.join(' ');
}

export function buildAuditLogContext(
  row: Pick<
    AuditLog,
    | 'action'
    | 'eventType'
    | 'description'
    | 'metadata'
    | 'newValues'
    | 'oldValues'
    | 'recordType'
    | 'recordId'
  >,
  maps: {
    serviceUserNames: Map<string, string>;
    medicationById: Map<string, { medicationName: string; serviceUserId: string }>;
    observationById: Map<
      string,
      { serviceUserId: string; observationTypeName: string; valueLabel: string | null }
    >;
  },
): AuditLogContext {
  let serviceUserId = resolveServiceUserIdFromAuditRow(row);
  let subject = pickMedicationNameFromAuditRow(row) ?? pickLocationSubjectFromAuditRow(row);

  const recordType = row.recordType ?? '';
  const recordId = str(row.recordId);

  if (recordType === 'ServiceUserMedication' && recordId) {
    const med = maps.medicationById.get(recordId);
    if (med) {
      subject = subject ?? med.medicationName;
      serviceUserId = serviceUserId ?? med.serviceUserId;
    }
  }

  if (recordType === 'ServiceUserObservation' && recordId) {
    const obs = maps.observationById.get(recordId);
    if (obs) {
      serviceUserId = serviceUserId ?? obs.serviceUserId;
      subject =
        subject ??
        (obs.valueLabel
          ? `${obs.observationTypeName}: ${obs.valueLabel}`
          : obs.observationTypeName);
    } else {
      subject = subject ?? pickObservationSubjectFromAuditRow(row);
    }
  }

  if (recordType === 'MedicationAdministrationEvent' && recordId && !subject) {
    const nv = asRecord(row.newValues);
    subject = str(nv?.medicationNameSnapshot) ?? str(nv?.medicationName);
  }

  const serviceUserName = serviceUserId
    ? (maps.serviceUserNames.get(serviceUserId) ?? null)
    : null;

  const eventLabel = buildEventLabel(row);
  const eventType = resolveAuditEventType(row.action, row.metadata, row.eventType);
  const summary = buildSummaryText(row, { serviceUserName, subject, eventLabel });

  return {
    serviceUserId,
    serviceUserName,
    subject,
    eventLabel,
    summary,
    eventType,
  };
}

export function collectAuditEnrichmentIds(
  rows: Array<
    Pick<AuditLog, 'recordType' | 'recordId' | 'metadata' | 'newValues' | 'oldValues'>
  >,
): { serviceUserIds: string[]; medicationIds: string[]; observationIds: string[] } {
  const serviceUserIds = new Set<string>();
  const medicationIds = new Set<string>();
  const observationIds = new Set<string>();

  for (const row of rows) {
    const suId = resolveServiceUserIdFromAuditRow({
      recordType: row.recordType,
      recordId: row.recordId,
      metadata: row.metadata,
      newValues: row.newValues,
      oldValues: row.oldValues,
    });
    if (suId) serviceUserIds.add(suId);

    if (row.recordType === 'ServiceUserMedication') {
      const id = str(row.recordId);
      if (id) medicationIds.add(id);
    }

    if (row.recordType === 'ServiceUserObservation') {
      const id = str(row.recordId);
      if (id) observationIds.add(id);
    }
  }

  return {
    serviceUserIds: [...serviceUserIds],
    medicationIds: [...medicationIds],
    observationIds: [...observationIds],
  };
}
