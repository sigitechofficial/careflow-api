import type { PrismaClient } from '@prisma/client';
import { ensureEnterpriseImmigrationStatusLookups } from './employee-immigration-statuses.seed';

const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

export async function seedOrganisationGeneralSettings(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.organisationGeneralSettings.findUnique({
    where: { id: DEFAULT_SETTINGS_ID },
  });

  if (!existing) {
    await prisma.organisationGeneralSettings.create({
      data: {
        id: DEFAULT_SETTINGS_ID,
        reviewCarePlanAfterDays: 180,
        handoverReportLastHours: 12,
        archiveServiceUserAfterMonths: 3,
        timeDisplayFormat: 'HH_MM',
      },
    });
  }

  await ensureEnterpriseImmigrationStatusLookups(prisma);
}
