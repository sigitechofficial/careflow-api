import type { Prisma, PrismaClient } from '@prisma/client';
import { MIN_POOL_MANAGERS, MIN_TEAM } from './survey-manager-copies.util';

type Db = PrismaClient | Prisma.TransactionClient;

/** What a copy made for each manager remembers (Survey.managerCopy). */
export type ManagerCopyInfo = { managerUserIds: string[]; pooled: boolean; minTeam: number };

export function readManagerCopy(v: unknown): ManagerCopyInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const ids = Array.isArray(o.managerUserIds) ? o.managerUserIds.filter((x): x is string => typeof x === 'string') : [];
  if (!ids.length) return null;
  const min = typeof o.minTeam === 'number' && Number.isInteger(o.minTeam) ? Math.max(MIN_TEAM, o.minTeam) : MIN_TEAM;
  return { managerUserIds: ids, pooled: o.pooled === true, minTeam: min };
}

/**
 * Why a copy's team is now too small to send (null = fine). `staffByManager`: each rated manager's
 * staff still on the copy's list, still active and still named under them. The same rules as when
 * the drafts were made (planManagerCopies): a manager's own copy needs at least minTeam; the pooled
 * copy needs at least MIN_POOL_MANAGERS managers with staff, minTeam people in all, and no one
 * manager's staff more than half of it.
 */
export function managerCopyTeamProblem(info: ManagerCopyInfo, staffByManager: ReadonlyMap<string, number>): string | null {
  const counts = info.managerUserIds.map((id) => staffByManager.get(id) ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const again = 'Make the copies again (Make a copy for each manager) so the teams are up to date, or leave this one out this time.';
  if (!info.pooled) {
    return total >= info.minTeam
      ? null
      : `Fewer than ${info.minTeam} of this manager’s staff are still named under them, so the answers could point at someone. ${again}`;
  }
  const withStaff = counts.filter((n) => n > 0);
  if (withStaff.length < MIN_POOL_MANAGERS) {
    return `The smaller-teams copy now covers fewer than ${MIN_POOL_MANAGERS} managers, so its results would point at one of them. ${again}`;
  }
  if (total < info.minTeam) return `The smaller-teams copy now reaches fewer than ${info.minTeam} people, so the answers could point at someone. ${again}`;
  if (Math.max(...withStaff) * 2 > total) {
    return `One manager’s staff are now more than half of the smaller-teams copy, so its results would point at them. ${again}`;
  }
  return null;
}

/**
 * For a survey about to be sent or opened: null unless it is a copy made for each manager whose team
 * has shrunk (staff who left, were switched off or are now named under someone else) below its rules.
 */
export async function managerCopyTeamProblemFor(db: Db, surveyId: string, sentTo?: readonly string[]): Promise<string | null> {
  const survey = await db.survey.findUnique({ where: { id: surveyId }, select: { managerCopy: true, audienceEmployeeIds: true } });
  const info = readManagerCopy(survey?.managerCopy);
  if (!survey || !info) return null;
  // `sentTo`: the people a send actually reaches (with anyone already sent it), when the sender chose
  // other people than the copy's list (a few of them would point at someone just the same).
  const people = sentTo ? [...new Set(sentTo)] : survey.audienceEmployeeIds;
  const rows = people.length
    ? await db.employeeEmployment.findMany({
        where: {
          employeeId: { in: people },
          supervisorUserId: { in: info.managerUserIds },
          employee: { deletedAt: null, isActive: true },
        },
        select: { supervisorUserId: true },
      })
    : [];
  const byManager = new Map<string, number>();
  for (const r of rows) if (r.supervisorUserId) byManager.set(r.supervisorUserId, (byManager.get(r.supervisorUserId) ?? 0) + 1);
  return managerCopyTeamProblem(info, byManager);
}
