import {
  Prisma,
  VisitPlanSlotExceptionType,
  VisitPlanSlotKind,
  VisitPlanStatus,
} from '@prisma/client';
import { visitPlanSlotMatchesDay } from './visit-plan-schedule-match.util';
import {
  hasSkipException,
  type VisitPlanSlotExceptionShape,
  type VisitPlanSlotLifecycleShape,
} from './visit-plan-slot-carer-resolve.util';
import type { VisitPlanSlotScheduleShape } from './visit-plan-schedule-match.util';
import { calendarDayUtc, resolveImpactEndDate } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';

export type AbsenceSkipSyncResult = {
  slotsUpdated: number;
  exceptionsAdded: number;
};

type SlotRow = VisitPlanSlotScheduleShape &
  VisitPlanSlotLifecycleShape & {
    id: string;
    exceptions: VisitPlanSlotExceptionShape[];
  };

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isSameUtcDate(a: Date, b: Date): boolean {
  return utcDateOnly(a).getTime() === utcDateOnly(b).getTime();
}

function isWithinInclusive(day: Date, from: Date | null, to: Date | null): boolean {
  const d = utcDateOnly(day).getTime();
  if (from && d < utcDateOnly(from).getTime()) return false;
  if (to && d > utcDateOnly(to).getTime()) return false;
  return true;
}

function slotScheduledOnDay(slot: SlotRow, day: Date, planAnchor: Date): boolean {
  if (!slot.isEnabled) return false;
  if (!isWithinInclusive(day, slot.slotEffectiveFrom, slot.slotEffectiveTo)) return false;
  if (slot.slotKind === VisitPlanSlotKind.ONE_OFF) {
    return slot.oneOffDate != null && isSameUtcDate(slot.oneOffDate, day);
  }
  return visitPlanSlotMatchesDay(slot, day, planAnchor);
}

function iterateAbsenceDays(from: Date, to: Date | null): Date[] {
  const start = utcDateOnly(from);
  const end = utcDateOnly(resolveImpactEndDate(start, to));
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function syncVisitPlanSkipExceptionsForAbsence(
  tx: Prisma.TransactionClient,
  serviceUserId: string,
  fromDate: Date,
  toDate: Date | null,
  absenceId: string,
  reasonLabel?: string,
): Promise<AbsenceSkipSyncResult> {
  const plan = await tx.serviceUserVisitPlan.findFirst({
    where: { serviceUserId, status: VisitPlanStatus.ACTIVE, deletedAt: null, isActive: true },
    include: {
      slots: {
        where: { isEnabled: true },
        include: { exceptions: true },
      },
    },
  });
  if (!plan?.slots.length) return { slotsUpdated: 0, exceptionsAdded: 0 };

  const planAnchor = calendarDayUtc(plan.effectiveFrom ?? plan.createdAt);
  const planEffectiveTo = plan.effectiveTo ?? null;
  const days = iterateAbsenceDays(fromDate, toDate);
  const note = `Auto: service user absence${reasonLabel ? ` (${reasonLabel})` : ''} [${absenceId}]`;

  let exceptionsAdded = 0;
  const slotsUpdated = new Set<string>();

  for (const slot of plan.slots) {
    const slotRow: SlotRow = {
      id: slot.id,
      slotCode: slot.slotCode,
      daysOfWeek: slot.daysOfWeek,
      scheduleFrequency: slot.scheduleFrequency,
      repeatEvery: slot.repeatEvery,
      monthlyDayMode: slot.monthlyDayMode,
      monthlyDaysOfMonth: slot.monthlyDaysOfMonth,
      monthlyPatternOrdinal: slot.monthlyPatternOrdinal,
      monthlyPatternWeekday: slot.monthlyPatternWeekday,
      slotKind: slot.slotKind,
      slotEffectiveFrom: slot.slotEffectiveFrom,
      slotEffectiveTo: slot.slotEffectiveTo,
      oneOffDate: slot.oneOffDate,
      isEnabled: slot.isEnabled,
      exceptions: slot.exceptions.map((ex) => ({
        exceptionDate: ex.exceptionDate,
        exceptionType: ex.exceptionType,
      })),
    };

    for (const day of days) {
      if (planEffectiveTo && utcDateOnly(day).getTime() > utcDateOnly(planEffectiveTo).getTime()) continue;
      if (!slotScheduledOnDay(slotRow, day, planAnchor)) continue;
      if (hasSkipException(slotRow.exceptions, day)) continue;

      await tx.visitPlanSlotException.create({
        data: {
          visitPlanSlotId: slot.id,
          exceptionDate: utcDateOnly(day),
          exceptionType: VisitPlanSlotExceptionType.SKIP,
          notes: note,
        },
      });
      exceptionsAdded += 1;
      slotsUpdated.add(slot.id);
      slotRow.exceptions.push({
        exceptionDate: utcDateOnly(day),
        exceptionType: VisitPlanSlotExceptionType.SKIP,
      });
    }
  }

  return { slotsUpdated: slotsUpdated.size, exceptionsAdded };
}

export async function removeAutoSkipExceptionsForAbsence(
  tx: Prisma.TransactionClient,
  absenceId: string,
): Promise<number> {
  const marker = `[${absenceId}]`;
  const rows = await tx.visitPlanSlotException.findMany({
    where: {
      exceptionType: VisitPlanSlotExceptionType.SKIP,
      notes: { contains: marker },
    },
    select: { id: true },
  });
  if (!rows.length) return 0;
  await tx.visitPlanSlotException.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  });
  return rows.length;
}
