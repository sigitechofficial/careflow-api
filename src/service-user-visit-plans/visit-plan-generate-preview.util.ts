import type { VisitPlanSlot } from '@prisma/client';
import { buildVisitPlanOccurrence, type SlotWithRelations } from './visit-plan-generate-occurrence.util';
import { activeServiceUserAbsenceWhere, calendarDayUtcNoon } from '../service-user-absences/active-absence.util';
import { computeGenerationStart, maxAllowedBackfillDays } from './visit-plan-slot-carer-resolve.util';

export type GenerateSchedulePreviewResult = {
  visitsToCreate: number;
  visitsSkippedAbsent: number;
  visitsSkippedSkip: number;
  visitsSkippedBankHoliday: number;
  visitsAlreadyExist: number;
  backfillDays: number;
  truncated: boolean;
};

type PreviewParams = {
  serviceUserId: string;
  planId: string;
  fromDate: Date;
  toDate: Date;
  backfillDays: number;
  enabledSlots: SlotWithRelations[];
  scheduleAnchor: Date;
  planEffectiveTo: Date | null;
  bankHolidayDates: Set<string>;
  absenceDays: Set<string>;
};

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function previewGenerateScheduleFromPlan(
  prisma: {
    serviceUserAbsence: { count: (args: unknown) => Promise<number> };
    scheduledVisit: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  },
  params: PreviewParams,
): Promise<GenerateSchedulePreviewResult> {
  const dayMs = 86400000;
  const rangeStart = new Date(params.fromDate);
  if (params.backfillDays > 0) {
    rangeStart.setUTCDate(rangeStart.getUTCDate() - params.backfillDays);
  }

  let visitsToCreate = 0;
  let visitsSkippedAbsent = 0;
  let visitsSkippedSkip = 0;
  let visitsSkippedBankHoliday = 0;
  let visitsAlreadyExist = 0;

  for (let t = rangeStart.getTime(); t <= params.toDate.getTime(); t += dayMs) {
    const day = new Date(t);
    const dateStr = utcDateKey(day);

    if (params.bankHolidayDates.has(dateStr)) {
      visitsSkippedBankHoliday += 1;
      continue;
    }

    if (params.absenceDays.has(dateStr)) {
      visitsSkippedAbsent += 1;
      continue;
    }

    const absentOnDay = await prisma.serviceUserAbsence.count({
      where: { serviceUserId: params.serviceUserId, ...activeServiceUserAbsenceWhere(calendarDayUtcNoon(day)) },
    });
    if (absentOnDay > 0) {
      visitsSkippedAbsent += 1;
      continue;
    }

    if (t < params.fromDate.getTime()) {
      const anySlotAllowsBackfill = params.enabledSlots.some((slot) => {
        const allowed = maxAllowedBackfillDays(slot.allowBackfillDays, params.backfillDays);
        if (allowed <= 0) return false;
        const slotStart = computeGenerationStart(params.fromDate, params.backfillDays, slot.slotEffectiveFrom);
        return day.getTime() >= slotStart.getTime();
      });
      if (!anySlotAllowsBackfill) continue;
    }

    for (const slot of params.enabledSlots) {
      if (t < params.fromDate.getTime()) {
        const allowed = maxAllowedBackfillDays(slot.allowBackfillDays, params.backfillDays);
        if (allowed <= 0) continue;
        const slotStart = computeGenerationStart(params.fromDate, params.backfillDays, slot.slotEffectiveFrom);
        if (day.getTime() < slotStart.getTime()) continue;
      }

      const occurrence = buildVisitPlanOccurrence(slot, day, params.scheduleAnchor, params.planEffectiveTo);
      if (!occurrence) {
        const hasSkip = (slot.exceptions ?? []).some(
          (ex) =>
            ex.exceptionType === 'SKIP' && utcDateKey(ex.exceptionDate) === dateStr,
        );
        if (hasSkip) visitsSkippedSkip += 1;
        continue;
      }

      const existingVisit = await prisma.scheduledVisit.findFirst({
        where: {
          visitPlanSlotId: slot.id,
          deletedAt: null,
          scheduledStartDateTime: occurrence.start,
        },
      });
      if (existingVisit) {
        visitsAlreadyExist += 1;
        continue;
      }

      visitsToCreate += 1;
    }
  }

  return {
    visitsToCreate,
    visitsSkippedAbsent,
    visitsSkippedSkip,
    visitsSkippedBankHoliday,
    visitsAlreadyExist,
    backfillDays: params.backfillDays,
    truncated: false,
  };
}

export function slotAsWithRelations(slot: VisitPlanSlot & {
  carerAssignments?: SlotWithRelations['carerAssignments'];
  exceptions?: SlotWithRelations['exceptions'];
}): SlotWithRelations {
  return slot as SlotWithRelations;
}
