import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

function mapRow(row: Record<string, unknown>) {
  return {
    wellbeingLabels: [
      row.wellbeingLabel1,
      row.wellbeingLabel2,
      row.wellbeingLabel3,
      row.wellbeingLabel4,
      row.wellbeingLabel5,
    ],
    enhancedRegularActionChecks: row.enhancedRegularActionChecks,
    allocateEmployeeBy: row.allocateEmployeeBy,
    updatedAt: (row.updatedAt as Date).toISOString(),
  };
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'admin@careadmin.local', deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new Error('no admin user');

  const dto = {
    enhancedRegularActionChecks: true,
    showRegularActionsInDailyList: true,
    allocateEmployeeBy: 'ZONE' as const,
    shiftAccessMinutesBefore: 4,
    shiftAccessMinutesAfter: 3,
  };

  const row = await prisma.organisationGeneralSettings.update({
    where: { id: DEFAULT_SETTINGS_ID },
    data: {
      reviewCarePlanAfterDays: undefined,
      enhancedRegularActionChecks: dto.enhancedRegularActionChecks,
      showRegularActionsInDailyList: dto.showRegularActionsInDailyList,
      allocateEmployeeBy: dto.allocateEmployeeBy,
      shiftAccessMinutesBefore: dto.shiftAccessMinutesBefore,
      shiftAccessMinutesAfter: dto.shiftAccessMinutesAfter,
      updatedById: user.id,
    } as Record<string, unknown>,
  });

  console.log('mapped', mapRow(row as unknown as Record<string, unknown>));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
