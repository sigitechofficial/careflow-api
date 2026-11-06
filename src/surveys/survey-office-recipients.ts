import type { Prisma, PrismaClient } from '@prisma/client';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { COMPANY_WIDE_IDENTITY_ROLES } from '../common/org-scope/org-scope.types';
import { ACCESS_SELECT, surveyAccessFor } from './survey-access';
import { surveyVisibleInScope } from './survey-scope.util';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Of `userIds` (office users who can open surveys), those who may see this survey's results: its
 * who-can-see settings (never the manager a "Feedback on your manager" copy rates) and, for users
 * limited to branches, the survey's branches. Used for notices about a survey's answers, which say
 * when answers came in and so must reach no one the results themselves would not.
 */
export async function usersWithResultsAccess(db: Db, surveyId: string, userIds: readonly string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const survey = await db.survey.findUnique({ where: { id: surveyId }, select: { ...ACCESS_SELECT, locationIds: true, isTemplate: true } });
  if (!survey) return [];
  const users = await db.user.findMany({
    where: { id: { in: [...userIds] }, deletedAt: null, isActive: true },
    select: { id: true, email: true, userRoles: { select: { role: { select: { name: true } } } }, userLocations: { select: { locationId: true } } },
  });
  const out: string[] = [];
  for (const u of users) {
    const roles = u.userRoles.map((r) => r.role.name);
    const companyWide = roles.some((r) => COMPANY_WIDE_IDENTITY_ROLES.has(r));
    // Users limited to branches see only surveys wholly in them (as everywhere on surveys). Their
    // branches are worked out as at sign-in (UsersService.getAuthContext): the branches given to the
    // account, else those of their own employment, else none at all (never "every branch").
    if (!companyWide) {
      const branches = u.userLocations.length ? u.userLocations.map((l) => l.locationId) : await employmentBranches(db, u.email);
      if (!surveyVisibleInScope({ locationIds: branches }, survey)) continue;
    }
    const actor = { id: u.id, email: u.email, roles, permissions: [], accountKind: 'user', assignedLocationIds: null } as RequestUser;
    if ((await surveyAccessFor(db, actor, survey)).results) out.push(u.id);
  }
  return out;
}

/** The branches of the employment record with this email (as UsersService works out a user's branches). */
async function employmentBranches(db: Db, email: string): Promise<string[]> {
  const personal = await db.employeePersonalDetail.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, employee: { deletedAt: null } },
    select: { employee: { select: { employment: { select: { locationId: true, baseLocationId: true, floorLocations: { select: { locationId: true } } } } } } },
  });
  const employment = personal?.employee?.employment;
  if (!employment) return [];
  const ids = new Set<string>();
  if (employment.locationId) ids.add(employment.locationId);
  if (employment.baseLocationId) ids.add(employment.baseLocationId);
  for (const f of employment.floorLocations) ids.add(f.locationId);
  return [...ids];
}
