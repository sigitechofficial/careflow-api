/**
 * Designated QA/demo Service User for Initial Assessment QA Demo Data (Margaret Hughes).
 * Idempotent — keyed only on serviceUserNumber SU-1042. Never selects another Service User.
 *
 * Safe to call outside `SEED_DEMO_DATA`. Does not create personas, run the Care Plan IA overlay,
 * reset body-map data, or modify arbitrary/real customers.
 */
import type { PrismaClient } from '@prisma/client';
import { MARGARET_ABOUT_ME_PATCH } from './care-plan-ia-demo-overlay.data';

export const INITIAL_ASSESSMENT_DEMO_SU_NUMBER = 'SU-1042';

/** Profile note so staff can recognise this record as QA/demo, not a live customer. */
export const IA_QA_DEMO_SERVICE_USER_NOTES =
  'QA/demo Service User for Initial Assessment QA Demo Data (not a live customer).';

const ABOUT_ME_REF_TYPE = 'SU_ABOUT_ME_V1';

function emptyRoutine() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const slots = ['getUp', 'breakfast', 'lunch', 'afternoon', 'teaTime', 'bedtime'] as const;
  const routine: Record<string, Record<string, string>> = {};
  for (const d of days) {
    routine[d] = Object.fromEntries(slots.map((s) => [s, '']));
  }
  routine.monday = {
    getUp: '8:00 — I need help to wash and dress',
    breakfast: '9:00 — porridge and tea',
    lunch: '12:30 — soup and sandwich',
    afternoon: '14:00 — radio and a short walk if the weather allows',
    teaTime: '17:00 — a light meal',
    bedtime: '21:00 — personal care then bed',
  };
  return routine;
}

function aboutMeJson(): string {
  return JSON.stringify({
    version: 1,
    ...MARGARET_ABOUT_ME_PATCH,
    externalAboutMeUrl: '',
    myChildhood: '',
    myEducation: '',
    myAdulthood: '',
    lifeHistoryFavourites: '',
    supportOther: '',
    favouriteOther: '',
    routine: emptyRoutine(),
  });
}

/**
 * Create or update the designated QA Service User SU-1042 only.
 * Does not require SEED_DEMO_DATA. Does not delete Service Users.
 */
export async function seedInitialAssessmentDemoServiceUser(
  prisma: PrismaClient,
): Promise<string | null> {
  if (INITIAL_ASSESSMENT_DEMO_SU_NUMBER !== 'SU-1042') {
    throw new Error('IA QA Demo provision refuses to run: designated number is not SU-1042');
  }

  const [titleMrs, genderFemale, statusActive, careDomiciliary, relDaughter] = await Promise.all([
    prisma.serviceUserTitle.findUnique({ where: { code: 'MRS' } }),
    prisma.serviceUserGender.findUnique({ where: { code: 'FEMALE' } }),
    prisma.serviceUserStatus.findUnique({ where: { code: 'ACTIVE' } }),
    prisma.serviceUserCareType.findUnique({ where: { code: 'DOMICILIARY' } }),
    prisma.relationshipType.findUnique({ where: { code: 'DAUGHTER' } }),
  ]);

  // Number only — including a soft-deleted SU-1042 so we restore it instead of creating a duplicate.
  // Never orderBy / oldest / arbitrary Service User.
  const existing = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber: INITIAL_ASSESSMENT_DEMO_SU_NUMBER },
  });

  const core = {
    firstName: 'Margaret',
    lastName: 'Hughes',
    preferredName: 'Margaret',
    dateOfBirth: new Date('1944-03-12'),
    nhsNumber: '9434765821',
    phone: '02084661234',
    mobile: '07700900123',
    email: 'margaret.hughes.demo@careflow.local',
    notes: IA_QA_DEMO_SERVICE_USER_NOTES,
    serviceStartDate: new Date('2025-11-01'),
    titleId: titleMrs?.id ?? null,
    genderId: genderFemale?.id ?? null,
    statusId: statusActive?.id ?? null,
    careTypeId: careDomiciliary?.id ?? null,
    isActive: true,
    deletedAt: null,
  };

  const serviceUser = existing
    ? await prisma.serviceUser.update({
        where: { id: existing.id },
        data: core,
      })
    : await prisma.serviceUser.create({
        data: {
          ...core,
          serviceUserNumber: INITIAL_ASSESSMENT_DEMO_SU_NUMBER,
        },
      });

  const suId = serviceUser.id;

  await prisma.serviceUserAddress.upsert({
    where: { serviceUserId: suId },
    update: {
      addressLine1: '14 Oak Lane',
      town: 'Bromley',
      county: 'Kent',
      country: 'United Kingdom',
      postcode: 'BR2 7QP',
      accessInstructions: 'Key safe on left of front door. Ring doorbell twice.',
      isActive: true,
      deletedAt: null,
    },
    create: {
      serviceUserId: suId,
      addressLine1: '14 Oak Lane',
      town: 'Bromley',
      county: 'Kent',
      country: 'United Kingdom',
      postcode: 'BR2 7QP',
      accessInstructions: 'Key safe on left of front door. Ring doorbell twice.',
    },
  });

  const daughter = await prisma.serviceUserContact.findFirst({
    where: { serviceUserId: suId, firstName: 'Sarah', lastName: 'Hughes', deletedAt: null },
  });
  if (!daughter) {
    await prisma.serviceUserContact.create({
      data: {
        serviceUserId: suId,
        firstName: 'Sarah',
        lastName: 'Hughes',
        relationshipTypeId: relDaughter?.id ?? null,
        mobile: '07711222333',
        isPrimary: true,
        isEmergencyContact: true,
        canReceiveUpdates: true,
        notes: 'Daughter — primary contact. Visits Tue and Fri afternoons.',
      },
    });
  }

  await prisma.serviceUserDomCare.upsert({
    where: { serviceUserId: suId },
    update: {
      accessInstruction: 'Key safe by front door — ring twice before entering.',
      accessRisks: 'Two steps at front door. Wet room floor slippery after bathing.',
      doorCode: '4821#',
      careInstructions:
        'Assist with all personal care. Female carers preferred. Morning shower before 10am.',
      numberOfCarers: 2,
      isActive: true,
      deletedAt: null,
    },
    create: {
      serviceUserId: suId,
      accessInstruction: 'Key safe by front door — ring twice before entering.',
      accessRisks: 'Two steps at front door. Wet room floor slippery after bathing.',
      doorCode: '4821#',
      careInstructions:
        'Assist with all personal care. Female carers preferred. Morning shower before 10am.',
      numberOfCarers: 2,
    },
  });

  const aboutRef = await prisma.serviceUserReference.findFirst({
    where: { serviceUserId: suId, referenceType: ABOUT_ME_REF_TYPE, deletedAt: null },
  });
  const aboutJson = aboutMeJson();
  if (aboutRef) {
    await prisma.serviceUserReference.update({
      where: { id: aboutRef.id },
      data: { referenceValue: aboutJson },
    });
  } else {
    await prisma.serviceUserReference.create({
      data: {
        serviceUserId: suId,
        referenceType: ABOUT_ME_REF_TYPE,
        referenceValue: aboutJson,
      },
    });
  }

  console.log(
    `[ia-qa-demo] Designated QA/demo Service User Margaret Hughes (${INITIAL_ASSESSMENT_DEMO_SU_NUMBER}) id=${suId}`,
  );
  return suId;
}
