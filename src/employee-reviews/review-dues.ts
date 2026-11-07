import type { Prisma, PrismaClient } from '@prisma/client';
import {
  effectiveNextDue,
  REVIEW_SCHEDULE_SELECT,
  reviewAppliesTo,
  type ReviewSchedule,
} from './employee-review-schedule.util';

export type ReviewTracker = {
  id: string;
  employeeId: string;
  reviewTypeId: string;
  lastDone: Date | null;
  nextDue: Date | null;
};

export type ReviewDue = {
  employeeId: string;
  reviewTypeId: string;
  typeName: string;
  typeCode: string | null;
  /** The EmployeeReview row, or null when nothing has been recorded yet (due from the start date). */
  trackerId: string | null;
  lastDone: Date | null;
  nextDue: Date;
};

export type StaffForReviews = { id: string; startDate: Date | null; nmcPinNumber: string | null };

type Db = Pick<PrismaClient, 'employee' | 'reviewType' | 'employeeReview'>;

export const reviewKey = (employeeId: string, reviewTypeId: string) => `${employeeId}:${reviewTypeId}`;

/**
 * Every review due for the given staff: one per carer and review type, from the latest record when
 * there is one, otherwise from the schedule and the carer's start date (new starters, probation
 * and induction milestones). Types that do not apply (NMC types for staff with no NMC PIN) are
 * skipped unless something was recorded for that carer anyway.
 */
export async function collectReviewDues(
  db: Db,
  employeeWhere: Prisma.EmployeeWhereInput,
): Promise<{ staff: StaffForReviews[]; dues: ReviewDue[]; latest: Map<string, ReviewTracker> }> {
  const [staffRows, types] = await Promise.all([
    db.employee.findMany({
      where: employeeWhere,
      select: { id: true, employment: { select: { startDate: true, nmcPinNumber: true } } },
    }),
    db.reviewType.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, code: true, ...REVIEW_SCHEDULE_SELECT },
    }),
  ]);
  const staff: StaffForReviews[] = staffRows.map((e) => ({
    id: e.id,
    startDate: e.employment?.startDate ?? null,
    nmcPinNumber: e.employment?.nmcPinNumber ?? null,
  }));
  const trackers = staff.length
    ? await db.employeeReview.findMany({
        where: { deletedAt: null, employeeId: { in: staff.map((s) => s.id) }, reviewTypeId: { not: null } },
        orderBy: [{ lastDone: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: { id: true, employeeId: true, reviewTypeId: true, lastDone: true, nextDue: true },
      })
    : [];
  const latest = new Map<string, ReviewTracker>();
  for (const t of trackers) {
    if (!t.reviewTypeId) continue;
    const key = reviewKey(t.employeeId, t.reviewTypeId);
    if (!latest.has(key)) latest.set(key, { ...t, reviewTypeId: t.reviewTypeId });
  }

  const dues: ReviewDue[] = [];
  for (const person of staff) {
    for (const type of types) {
      const tracker = latest.get(reviewKey(person.id, type.id)) ?? null;
      if (!tracker && !reviewAppliesTo(type, person)) continue;
      const nextDue = effectiveNextDue(type as ReviewSchedule, tracker, person.startDate);
      if (!nextDue) continue;
      dues.push({
        employeeId: person.id,
        reviewTypeId: type.id,
        typeName: type.name,
        typeCode: type.code,
        trackerId: tracker?.id ?? null,
        lastDone: tracker?.lastDone ?? null,
        nextDue,
      });
    }
  }
  return { staff, dues, latest };
}

/** Current staff: not deleted, active, and not past their leaving date (optionally one branch). */
export function currentStaffWhere(now: Date, locationId?: string | null): Prisma.EmployeeWhereInput {
  const current = { OR: [{ endDate: null }, { endDate: { gt: now } }] };
  if (locationId) {
    const branch = { OR: [{ locationId }, { AND: [{ locationId: null }, { baseLocationId: locationId }] }] };
    return { deletedAt: null, isActive: true, employment: { is: { AND: [current, branch] } } };
  }
  return { deletedAt: null, isActive: true, OR: [{ employment: { is: null } }, { employment: { is: current } }] };
}
