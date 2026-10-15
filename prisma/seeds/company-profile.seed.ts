import type { PrismaClient } from '@prisma/client';
import { COMPANY_ACTIVE_MODULES } from '../seed-data/company-active-modules';
import { ALLFOR_CARE_ORGANISATION } from '../seed-data/allforcare-organisation';

const DEFAULT_PROFILE_ID = '00000000-0000-4000-8000-000000000001';

export async function seedCompanyProfile(prisma: PrismaClient): Promise<void> {
  await prisma.companyProfile.upsert({
    where: { id: DEFAULT_PROFILE_ID },
    update: {},
    create: {
      id: DEFAULT_PROFILE_ID,
      groupName: 'Group',
      companyName: ALLFOR_CARE_ORGANISATION.companyName,
      odsCsCode: '',
      displayName: ALLFOR_CARE_ORGANISATION.displayName,
      displayLogoFileName: 'Company Logo.png',
      companyWebsite: ALLFOR_CARE_ORGANISATION.companyWebsite,
      companyNumber: ALLFOR_CARE_ORGANISATION.companyNumber,
      contactName: 'all_for_care',
      email: 'suzettethomas@allforcare.co.uk',
      phoneNumber: '079030 68899',
      numberOfCarers: 100,
      numberOfServiceUsers: 411,
      activeModules: [...COMPANY_ACTIVE_MODULES],
    },
  });
}
