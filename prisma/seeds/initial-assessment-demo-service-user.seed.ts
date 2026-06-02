/**
 * Demo service user for initial-assessment enterprise testing (Margaret Hughes).
 * Idempotent — keyed on serviceUserNumber SU-1042.
 */
import type { PrismaClient } from '@prisma/client';

export const INITIAL_ASSESSMENT_DEMO_SU_NUMBER = 'SU-1042';

const ABOUT_ME_REF_TYPE = 'SU_ABOUT_ME_V1';

function emptyRoutine() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const slots = ['getUp', 'breakfast', 'lunch', 'afternoon', 'teaTime', 'bedtime'] as const;
  const routine: Record<string, Record<string, string>> = {};
  for (const d of days) {
    routine[d] = Object.fromEntries(slots.map((s) => [s, '']));
  }
  routine.monday = {
    getUp: '8:00 — help with wash and dress',
    breakfast: '9:00 — porridge and tea',
    lunch: '12:30 — soup and sandwich',
    afternoon: '14:00 — radio and short walk if weather allows',
    teaTime: '17:00 — light meal',
    bedtime: '21:00 — personal care then bed',
  };
  return routine;
}

function aboutMeJson(): string {
  return JSON.stringify({
    version: 1,
    whatIsMostImportantToMe: 'Staying in my own home and seeing my daughter Sarah regularly.',
    peopleImportantToMe: 'Sarah Hughes (daughter), church friends, former neighbours.',
    externalAboutMeUrl: '',
    howICommunicate: 'Clear speech; short sentences work best. Hard of hearing in left ear.',
    myWellness: 'Mobility limited — uses walking frame indoors.',
    whatMakesAGoodDay: 'Morning personal care before 10am, radio on, visit from Sarah.',
    whatMakesMeHappy: 'Classic FM, gardening programmes, family photos.',
    whatMakesMeUnhappy: 'Being rushed during personal care; loud sudden noises.',
    whatMakesABadDay: 'Missed medication times or carers arriving very late.',
    howAndWhenToSupportMe: 'Female carers preferred for personal care. Speak calmly at eye level.',
    alsoWorthKnowing: 'Prefers to be called Margaret. Church of England — bible on bedside table.',
    supportedToWriteThisBy: 'Sarah Hughes (daughter)',
    hobbiesAndInterests: 'Gardening (watching), knitting, church choir (when able).',
    religiousSpiritualPreferences: 'Church of England; Sunday service when health allows.',
    whereIAmFrom: 'Born in Bromley; lived in this house 40 years.',
    whatILikeToTalkAbout: 'Family, garden, local news.',
    familyAndFriends: 'Daughter Sarah visits twice weekly.',
    myChildhood: '',
    myEducation: '',
    myOccupation: 'Retired school secretary.',
    myAdulthood: '',
    lifeHistoryFavourites: '',
    personalHygiene: 'Shower preferred in morning; needs full assistance.',
    domesticSupport: 'Meals prepared by carers; light housekeeping support.',
    shoppingArrangements: 'Sarah handles online grocery orders.',
    nightSupport: 'Bed sensor mat in use — may attempt to get up unassisted.',
    supportOther: '',
    foodDrinksLike: 'Porridge, soft cooked vegetables, warm tea with one sugar.',
    foodDrinksDontLike: 'Shellfish (allergy).',
    favouriteItems: 'Pearl necklace, family photo album.',
    tvProgrammes: 'Gardeners\' World, classic films.',
    favouriteActivities: 'Listening to radio, looking through photo albums.',
    favouriteRooms: 'Living room bay window seat.',
    favouriteOther: '',
    identificationCharacteristics: 'Silver hair, walks with frame.',
    routine: emptyRoutine(),
  });
}

export async function seedInitialAssessmentDemoServiceUser(
  prisma: PrismaClient,
): Promise<string | null> {
  const [titleMrs, genderFemale, statusActive, careDomiciliary, relDaughter] = await Promise.all([
    prisma.serviceUserTitle.findUnique({ where: { code: 'MRS' } }),
    prisma.serviceUserGender.findUnique({ where: { code: 'FEMALE' } }),
    prisma.serviceUserStatus.findUnique({ where: { code: 'ACTIVE' } }),
    prisma.serviceUserCareType.findUnique({ where: { code: 'DOMICILIARY' } }),
    prisma.relationshipType.findUnique({ where: { code: 'DAUGHTER' } }),
  ]);

  const existing = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber: INITIAL_ASSESSMENT_DEMO_SU_NUMBER, deletedAt: null },
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
    `[seed] Initial assessment demo SU: Margaret Hughes (${INITIAL_ASSESSMENT_DEMO_SU_NUMBER}) id=${suId}`,
  );
  return suId;
}
