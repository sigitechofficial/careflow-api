import type { Prisma } from '@prisma/client';
import { formatHmInTimeZone } from '../../common/utils/operational-day.util';
import {
  dueTimeFallsInHmWindow,
  parseHmToMinutes,
} from '../../service-user-visit-plans/visit-medication-window.util';

/**
 * Finds the record a carer already saved for one dose on one visit, so a re-save
 * from the app ("Update") replaces it instead of adding a second record.
 *
 * Scheduled dose: same visit + medicine + administration time. The time is matched
 * by schedule id or due time, because editing a medicine recreates its schedule rows.
 * PRN: the app keeps one PRN entry per medicine per visit.
 */
export function visitDoseRecordWhere(input: {
  serviceUserId: string;
  visitId: string;
  medicationId: string;
  isPrn: boolean;
  schedule?: { id: string; dueTime: string | null } | null;
}): Prisma.MedicationAdministrationEventWhereInput {
  const base: Prisma.MedicationAdministrationEventWhereInput = {
    serviceUserId: input.serviceUserId,
    serviceUserMedicationId: input.medicationId,
    visitId: input.visitId,
    isPrn: input.isPrn,
    deletedAt: null,
  };
  if (input.isPrn || !input.schedule) return base;
  return {
    ...base,
    OR: [
      { medicationScheduleId: input.schedule.id },
      { medicationScheduleId: null },
      ...(input.schedule.dueTime ? [{ schedule: { dueTime: input.schedule.dueTime } }] : []),
    ],
  };
}

/** Columns needed to decide which visit dose a saved record belongs to. */
export const VISIT_DOSE_RECORD_SELECT = {
  serviceUserMedicationId: true,
  visitId: true,
  medicationScheduleId: true,
  scheduledDateTime: true,
  actualDateTime: true,
  schedule: { select: { dueTime: true } },
} as const;

export type VisitDoseRecord = {
  serviceUserMedicationId: string;
  visitId: string | null;
  medicationScheduleId?: string | null;
  scheduledDateTime?: Date | null;
  actualDateTime?: Date | null;
  schedule?: { dueTime: string | null } | null;
};

export type VisitDoseMatchContext = {
  visitId: string;
  /** Visit clock window in the organisation timezone; null when the visit has no end time. */
  window: { startHm: string; endHm: string } | null;
  timeZone: string;
};

/**
 * True when a saved record is for a dose due on this visit, not for another dose of
 * the same medicine that day (e.g. the morning dose must not tick the evening one).
 *
 * - Recorded on this visit → yes.
 * - Otherwise the record's administration time must be one of the times due on this
 *   visit (covers a dose the office recorded, or one given on an overlapping visit).
 * - A record with no administration time and no visit is placed by its clock time.
 */
export function recordIsForVisitDose(
  record: VisitDoseRecord,
  dueTimes: Array<string | null>,
  ctx: VisitDoseMatchContext,
): boolean {
  if (record.visitId === ctx.visitId) return true;
  // No window known: keep the day-wide match rather than hide a recorded dose.
  if (!ctx.window) return true;

  const recordDue = parseHmToMinutes(record.schedule?.dueTime);
  if (recordDue != null) {
    return dueTimes.some((t) => parseHmToMinutes(t) === recordDue);
  }
  if (record.visitId) return false;

  const at = record.scheduledDateTime ?? record.actualDateTime;
  if (!at) return false;
  return dueTimeFallsInHmWindow(
    formatHmInTimeZone(at, ctx.timeZone),
    ctx.window.startHm,
    ctx.window.endHm,
  );
}

/**
 * Per medicine, the record that covers its dose on this visit. Pass records newest
 * first so the latest save wins. A record saved on this visit is preferred over the
 * same dose recorded elsewhere (the office, or an overlapping visit), so the carer
 * sees and edits their own record. The map size is the number of medicines recorded.
 */
export function pickVisitDoseRecords<R extends VisitDoseRecord>(
  records: R[],
  dueTimesByMedication: Map<string, Array<string | null>>,
  ctx: VisitDoseMatchContext,
): Map<string, R> {
  const picked = new Map<string, R>();
  for (const record of records) {
    const medicationId = record.serviceUserMedicationId;
    if (record.visitId === ctx.visitId && !picked.has(medicationId)) {
      picked.set(medicationId, record);
    }
  }
  for (const record of records) {
    const medicationId = record.serviceUserMedicationId;
    if (picked.has(medicationId)) continue;
    if (recordIsForVisitDose(record, dueTimesByMedication.get(medicationId) ?? [], ctx)) {
      picked.set(medicationId, record);
    }
  }
  return picked;
}

/** Administration times of one medicine that fall inside the visit clock window. */
export function dueTimesInVisitWindow(
  schedules: Array<{ dueTime: string | null }>,
  window: { startHm: string; endHm: string },
): Array<string | null> {
  return schedules
    .filter((s) => dueTimeFallsInHmWindow(s.dueTime, window.startHm, window.endHm))
    .map((s) => s.dueTime);
}
