import type { RecruitmentEmploymentType } from '@prisma/client';

/** Maps recruitment employment type to lookups.ContractType.name seeds. */
export const RECRUITMENT_TO_CONTRACT_TYPE_NAMES: Record<RecruitmentEmploymentType, string[]> = {
  PERMANENT: ['Salaried', 'Hourly paid'],
  FIXED_TERM: ['Salaried', 'Hourly paid'],
  BANK: ['Bank staff'],
  AGENCY: ['Agency'],
  APPRENTICE: ['Hourly paid', 'Salaried'],
  VOLUNTEER: ['Voluntary'],
};

export async function resolveContractTypeIdForRecruitmentType(
  prisma: { contractType: { findFirst: (args: unknown) => Promise<{ id: string } | null> } },
  employmentType: RecruitmentEmploymentType,
): Promise<string | null> {
  const names = RECRUITMENT_TO_CONTRACT_TYPE_NAMES[employmentType];
  for (const name of names) {
    const row = await prisma.contractType.findFirst({
      where: { name, deletedAt: null, isActive: true },
    });
    if (row) return row.id;
  }
  return null;
}
