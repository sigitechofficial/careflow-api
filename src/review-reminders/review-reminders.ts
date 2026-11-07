import { Prisma, type ReviewReminderSubject } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { resolveManagerUserIds } from '../notifications/resolve-manager-recipients';

/**
 * Care plan and assessment review reminders share one claim-first log (ReviewReminderLog), the
 * same pattern as supervision reminders: a reminder is claimed (unique per subject, due date and
 * kind) before it is sent, so it goes out once whether the hourly job, a retry or the "Send
 * reminders" button sends it. A claim is released when nothing could be delivered.
 */

const DAY_MS = 86_400_000;

/** Whole calendar days (UTC) from `today` to `due`; negative when overdue. */
export function calendarDaysUntil(due: Date, today: Date): number {
  const d = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d - t) / DAY_MS);
}

/**
 * Which reminder a review needs today: one `DUE_SOON` per due date while it is due soon, then
 * `OVERDUE_0` on the first overdue day and another (`OVERDUE_1`, `OVERDUE_2` …) every
 * `repeatDays` while it stays overdue. A day the job did not run is caught up on the next run.
 */
export function reviewReminderKind(
  status: string,
  due: Date | null,
  today: Date,
  repeatDays: number,
): string | null {
  if (!due) return null;
  if (status === 'due_soon') return 'DUE_SOON';
  if (status !== 'overdue') return null;
  const overdueDays = Math.max(1, -calendarDaysUntil(due, today));
  return `OVERDUE_${Math.floor((overdueDays - 1) / Math.max(1, repeatDays))}`;
}

export type ReviewReminderClaim = {
  subjectType: ReviewReminderSubject;
  subjectId: string;
  serviceUserId: string;
  dueDate: Date;
  kind: string;
};

/** Claims a reminder; returns the log id, or null when it was already sent. */
export async function claimReviewReminder(
  prisma: PrismaService,
  claim: ReviewReminderClaim,
): Promise<string | null> {
  try {
    const row = await prisma.reviewReminderLog.create({ data: claim, select: { id: true } });
    return row.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
}

/** True when this reminder has already been sent (used by dry runs, which claim nothing). */
export async function reviewReminderAlreadySent(
  prisma: PrismaService,
  claim: Omit<ReviewReminderClaim, 'serviceUserId'>,
): Promise<boolean> {
  const row = await prisma.reviewReminderLog.findUnique({
    where: {
      subjectType_subjectId_dueDate_kind: {
        subjectType: claim.subjectType,
        subjectId: claim.subjectId,
        dueDate: claim.dueDate,
        kind: claim.kind,
      },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function completeReviewReminder(prisma: PrismaService, id: string, recipientUserIds: string[]) {
  await prisma.reviewReminderLog.update({ where: { id }, data: { recipientUserIds } });
}

export async function releaseReviewReminder(prisma: PrismaService, id: string) {
  await prisma.reviewReminderLog.delete({ where: { id } }).catch(() => undefined);
}

async function userIdForEmployee(prisma: PrismaService, employeeId: string): Promise<string | null> {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: { personalDetail: { select: { email: true } } },
  });
  const email = emp?.personalDetail?.email?.trim();
  if (!email) return null;
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, isActive: true },
    select: { id: true },
  });
  return user?.id ?? null;
}

/** Key worker, named nurse and the branch managers of a service user (user ids). */
export async function resolveCareTeamUserIds(prisma: PrismaService, serviceUserId: string): Promise<string[]> {
  const su = await prisma.serviceUser.findFirst({
    where: { id: serviceUserId, deletedAt: null },
    select: { keyWorkerId: true, namedNurseId: true, locationId: true },
  });
  if (!su) return [];
  const ids = new Set<string>();
  for (const employeeId of [su.keyWorkerId, su.namedNurseId]) {
    if (!employeeId) continue;
    const uid = await userIdForEmployee(prisma, employeeId);
    if (uid) ids.add(uid);
  }
  for (const uid of await resolveManagerUserIds(prisma, { locationId: su.locationId })) {
    ids.add(uid);
  }
  return [...ids];
}
