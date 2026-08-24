import type { PrismaService } from '../../../prisma/prisma.service';

export type RecruitmentScope = {
  managerEmployeeId: string | null;
  isScopedManager: boolean;
};

export async function resolveRecruitmentScope(
  prisma: PrismaService,
  user: { id: string; email: string; permissions?: string[] },
): Promise<RecruitmentScope> {
  const perms = user.permissions ?? [];
  const hasFullVacancyWrite =
    perms.includes('hr.vacancies.create') || perms.includes('hr.vacancies.update');
  const hasFullCandidateWrite =
    perms.includes('hr.candidates.create') ||
    perms.includes('hr.candidates.update') ||
    perms.includes('hr.candidates.convert');

  if (hasFullVacancyWrite || hasFullCandidateWrite) {
    return { managerEmployeeId: null, isScopedManager: false };
  }

  const pd = await prisma.employeePersonalDetail.findFirst({
    where: {
      email: { equals: user.email, mode: 'insensitive' },
      deletedAt: null,
    },
    select: { employeeId: true },
  });

  return {
    managerEmployeeId: pd?.employeeId ?? null,
    isScopedManager: true,
  };
}

export function vacancyScopeWhere(scope: RecruitmentScope): { hiringManagerId?: string; id?: { in: string[] } } {
  if (!scope.isScopedManager) return {};
  if (!scope.managerEmployeeId) {
    return { id: { in: [] } };
  }
  return { hiringManagerId: scope.managerEmployeeId };
}

export async function candidateScopeWhere(
  prisma: PrismaService,
  scope: RecruitmentScope,
): Promise<{ vacancyId?: { in: string[] } }> {
  if (!scope.isScopedManager) return {};
  if (!scope.managerEmployeeId) {
    return { vacancyId: { in: [] } };
  }
  const vacancies = await prisma.vacancy.findMany({
    where: {
      hiringManagerId: scope.managerEmployeeId,
      deletedAt: null,
    },
    select: { id: true },
  });
  return { vacancyId: { in: vacancies.map((v) => v.id) } };
}
