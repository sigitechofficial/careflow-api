import type { PrismaService } from '../prisma/prisma.service';

/**
 * Where a member of staff can answer a survey without a personal link (anonymous surveys): the carer app
 * (an enabled carer-app account) and/or "My surveys" in the CareFlow web app (an active CareFlow login
 * with the same email as their staff record, the link CareFlow already uses between logins and staff
 * records). Neither: they answer on paper (e.g. leavers after their last day). Never a token.
 */
export type StaffAnswerPlaces = { app: boolean; web: boolean };

export async function staffAnswerPlaces(
  prisma: Pick<PrismaService, 'employeePortalAccount' | 'employeePersonalDetail' | 'user'> & { employee?: PrismaService['employee'] },
  employeeIds: string[],
): Promise<Map<string, StaffAnswerPlaces>> {
  const out = new Map<string, StaffAnswerPlaces>();
  const ids = [...new Set(employeeIds)];
  if (!ids.length) return out;
  try {
    await fill(prisma, ids, out);
  } catch {
    // Not known: callers fall back to the carer app wording (as before), never a link.
  }
  return out;
}

async function fill(
  prisma: Pick<PrismaService, 'employeePortalAccount' | 'employeePersonalDetail' | 'user'> & { employee?: PrismaService['employee'] },
  ids: string[],
  out: Map<string, StaffAnswerPlaces>,
): Promise<void> {
  const [apps, details] = await Promise.all([
    prisma.employeePortalAccount.findMany({
      where: { employeeId: { in: ids }, isEnabled: true, deletedAt: null },
      select: { employeeId: true },
    }),
    prisma.employeePersonalDetail.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, email: true } }),
  ]);
  const emails = [...new Set(details.map((d) => d.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))];
  const users = emails.length
    ? await prisma.user.findMany({
        where: { deletedAt: null, isActive: true, OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) },
        select: { email: true },
      })
    : [];
  const withLogin = new Set(users.map((u) => u.email.trim().toLowerCase()));
  // Staff who have left: neither the carer app nor CareFlow (both close on their last day).
  const left = new Set(
    prisma.employee
      ? (await prisma.employee.findMany({ where: { id: { in: ids }, isActive: false }, select: { id: true, isActive: true } })).filter((e) => e.isActive === false).map((e) => e.id)
      : [],
  );
  const appSet = new Set(apps.map((a) => a.employeeId));
  for (const id of ids) {
    const email = details.find((d) => d.employeeId === id)?.email?.trim().toLowerCase();
    out.set(id, left.has(id) ? { app: false, web: false } : { app: appSet.has(id), web: Boolean(email && withLogin.has(email)) });
  }
}

/** The staff record of a CareFlow web login (same email), or null when there is none or more than one. */
export async function employeeForWebUser(
  prisma: Pick<PrismaService, 'employeePersonalDetail'>,
  email: string | null | undefined,
): Promise<string | null> {
  const e = email?.trim();
  if (!e) return null;
  const rows = await prisma.employeePersonalDetail.findMany({
    where: { email: { equals: e, mode: 'insensitive' }, employee: { deletedAt: null } },
    select: { employeeId: true },
    take: 2,
  });
  return rows.length === 1 ? rows[0].employeeId : null;
}
