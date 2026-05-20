import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

async function main() {
  try {
    const row = await prisma.organisationGeneralSettings.update({
      where: { id: DEFAULT_SETTINGS_ID },
      data: {
        enhancedRegularActionChecks: true,
        showRegularActionsInDailyList: true,
        allocateEmployeeBy: 'ZONE',
        shiftAccessMinutesBefore: 4,
        shiftAccessMinutesAfter: 3,
      },
    });
    console.log('OK', {
      allocateEmployeeBy: row.allocateEmployeeBy,
      shiftAccessMinutesBefore: row.shiftAccessMinutesBefore,
    });
  } catch (e) {
    console.error('FAIL', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
