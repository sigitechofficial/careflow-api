/**
 * Greenwich council in-service service users for the Registered Manager login.
 * Idempotent — keyed on serviceUserNumber (SU-GW-01 … SU-GW-06).
 *
 * All rows: locationId = Greenwich, ACTIVE status, assigned to Greenwich town /
 * Woolwich / Charlton. Reuses lookups and assignment patterns from
 * service-user-personas.seed.ts / initial-assessment-demo-service-user.seed.ts.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { GREENWICH_LOCATION_ID, GREENWICH_LOCATION_NAME } from './greenwich-branch-users.seed'

type GreenwichAreaCode = 'TOWN' | 'WOOLWICH' | 'CHARLTON'

type GreenwichSuDef = {
  serviceUserNumber: string
  firstName: string
  lastName: string
  preferredName?: string
  dateOfBirth: string
  titleCode: string
  genderCode: string
  nhsNumber: string
  phone?: string
  mobile: string
  serviceStartDate: string
  areaCode: GreenwichAreaCode
  addressLine1: string
  town: string
  postcode: string
  latitude: number
  longitude: number
  accessInstructions: string
  weeklyContractedHours: string
  riskLevelCode: string
  keyWorkerEmail: string
  contact: {
    firstName: string
    lastName: string
    relationshipCode: string
    mobile: string
  }
}

/** Small realistic Greenwich caseload — two people per monitoring area. */
const GREENWICH_SERVICE_USERS: GreenwichSuDef[] = [
  {
    serviceUserNumber: 'SU-GW-01',
    firstName: 'Dorothy',
    lastName: 'Clarke',
    preferredName: 'Dot',
    dateOfBirth: '1939-04-18',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    nhsNumber: '9991234580',
    phone: '02088581201',
    mobile: '07700914001',
    serviceStartDate: '2024-09-02',
    areaCode: 'TOWN',
    addressLine1: '12 Park Row',
    town: 'Greenwich',
    postcode: 'SE10 9AA',
    latitude: 51.4814,
    longitude: -0.0091,
    accessInstructions: 'Key safe left of the front door. Ring twice.',
    weeklyContractedHours: '12.00',
    riskLevelCode: 'LOW',
    keyWorkerEmail: 'carer1.greenwich@careadmin.local',
    contact: {
      firstName: 'Helen',
      lastName: 'Clarke',
      relationshipCode: 'DAUGHTER',
      mobile: '07700914011',
    },
  },
  {
    serviceUserNumber: 'SU-GW-02',
    firstName: 'Harold',
    lastName: 'Bennett',
    dateOfBirth: '1946-11-03',
    titleCode: 'MR',
    genderCode: 'MALE',
    nhsNumber: '9991234581',
    phone: '02088581202',
    mobile: '07700914002',
    serviceStartDate: '2025-01-14',
    areaCode: 'WOOLWICH',
    addressLine1: '8 Wellington Street',
    town: 'Woolwich',
    postcode: 'SE18 6AA',
    latitude: 51.4901,
    longitude: 0.0678,
    accessInstructions: 'Ground-floor flat. Use intercom 8.',
    weeklyContractedHours: '8.00',
    riskLevelCode: 'LOW',
    keyWorkerEmail: 'carer2.greenwich@careadmin.local',
    contact: {
      firstName: 'Michael',
      lastName: 'Bennett',
      relationshipCode: 'SON',
      mobile: '07700914012',
    },
  },
  {
    serviceUserNumber: 'SU-GW-03',
    firstName: 'Priya',
    lastName: 'Patel',
    dateOfBirth: '1952-07-21',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    nhsNumber: '9991234582',
    phone: '02088581203',
    mobile: '07700914003',
    serviceStartDate: '2024-11-18',
    areaCode: 'CHARLTON',
    addressLine1: '24 Charlton Church Lane',
    town: 'Charlton',
    postcode: 'SE7 7AA',
    latitude: 51.4869,
    longitude: 0.0368,
    accessInstructions: 'Side gate unlocked during visits. Dog is friendly.',
    weeklyContractedHours: '14.00',
    riskLevelCode: 'MEDIUM',
    keyWorkerEmail: 'carer3.greenwich@careadmin.local',
    contact: {
      firstName: 'Anjali',
      lastName: 'Patel',
      relationshipCode: 'DAUGHTER',
      mobile: '07700914013',
    },
  },
  {
    serviceUserNumber: 'SU-GW-04',
    firstName: 'George',
    lastName: 'Adeyemi',
    dateOfBirth: '1941-02-09',
    titleCode: 'MR',
    genderCode: 'MALE',
    nhsNumber: '9991234583',
    phone: '02088581204',
    mobile: '07700914004',
    serviceStartDate: '2025-03-03',
    areaCode: 'TOWN',
    addressLine1: '41 Greenwich High Road',
    town: 'Greenwich',
    postcode: 'SE10 8RF',
    latitude: 51.4778,
    longitude: -0.0142,
    accessInstructions: 'Flat 2, first floor. Stair lift in communal hall.',
    weeklyContractedHours: '20.00',
    riskLevelCode: 'MEDIUM',
    keyWorkerEmail: 'carer1.greenwich@careadmin.local',
    contact: {
      firstName: 'Funke',
      lastName: 'Adeyemi',
      relationshipCode: 'DAUGHTER',
      mobile: '07700914014',
    },
  },
  {
    serviceUserNumber: 'SU-GW-05',
    firstName: 'Joan',
    lastName: 'Whittaker',
    dateOfBirth: '1936-09-27',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    nhsNumber: '9991234584',
    phone: '02088581205',
    mobile: '07700914005',
    serviceStartDate: '2024-06-10',
    areaCode: 'WOOLWICH',
    addressLine1: '15 Powis Street',
    town: 'Woolwich',
    postcode: 'SE18 4RF',
    latitude: 51.4916,
    longitude: 0.0632,
    accessInstructions: 'Key safe behind hanging basket. Mobility scooter in porch.',
    weeklyContractedHours: '10.00',
    riskLevelCode: 'LOW',
    keyWorkerEmail: 'carer2.greenwich@careadmin.local',
    contact: {
      firstName: 'Paul',
      lastName: 'Whittaker',
      relationshipCode: 'SON',
      mobile: '07700914015',
    },
  },
  {
    serviceUserNumber: 'SU-GW-06',
    firstName: 'Samuel',
    lastName: 'Owusu',
    dateOfBirth: '1948-12-14',
    titleCode: 'MR',
    genderCode: 'MALE',
    nhsNumber: '9991234585',
    phone: '02088581206',
    mobile: '07700914006',
    serviceStartDate: '2025-05-19',
    areaCode: 'CHARLTON',
    addressLine1: '7 Troughton Road',
    town: 'Charlton',
    postcode: 'SE7 8RF',
    latitude: 51.4851,
    longitude: 0.0412,
    accessInstructions: 'Park on Troughton Road. Call on arrival — hearing aid.',
    weeklyContractedHours: '16.00',
    riskLevelCode: 'LOW',
    keyWorkerEmail: 'carer3.greenwich@careadmin.local',
    contact: {
      firstName: 'Kwame',
      lastName: 'Owusu',
      relationshipCode: 'SON',
      mobile: '07700914016',
    },
  },
]

async function resolveGreenwichLocationId(prisma: PrismaClient): Promise<string> {
  const byId = await prisma.location.findFirst({
    where: { id: GREENWICH_LOCATION_ID, deletedAt: null, isActive: true },
    select: { id: true },
  })
  if (byId) return byId.id

  const byName = await prisma.location.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      name: { equals: GREENWICH_LOCATION_NAME, mode: 'insensitive' },
    },
    select: { id: true },
  })
  if (byName) return byName.id

  throw new Error(`Greenwich location not found (expected ${GREENWICH_LOCATION_NAME})`)
}

async function resolveGreenwichAreas(
  prisma: PrismaClient,
  locationId: string,
): Promise<Map<GreenwichAreaCode, string>> {
  const areas = await prisma.serviceUserArea.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      scheduleArea: { locationId, deletedAt: null, isActive: true },
    },
    select: { id: true, code: true, name: true },
  })

  const map = new Map<GreenwichAreaCode, string>()
  for (const area of areas) {
    const code = area.code.toUpperCase()
    if (code === 'TOWN' || code === 'WOOLWICH' || code === 'CHARLTON') {
      map.set(code, area.id)
    }
  }

  const missing = (['TOWN', 'WOOLWICH', 'CHARLTON'] as GreenwichAreaCode[]).filter(
    (code) => !map.has(code),
  )
  if (missing.length > 0) {
    throw new Error(
      `Greenwich service-user areas missing: ${missing.join(', ')} (need Greenwich town, Woolwich, Charlton)`,
    )
  }
  return map
}

async function findEmployeeIdByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<string | null> {
  const personal = await prisma.employeePersonalDetail.findFirst({
    where: { email, deletedAt: null },
    select: { employeeId: true },
  })
  return personal?.employeeId ?? null
}

export async function seedGreenwichServiceUsers(prisma: PrismaClient): Promise<void> {
  const locationId = await resolveGreenwichLocationId(prisma)
  const areaIds = await resolveGreenwichAreas(prisma, locationId)

  const [titleRows, genderRows, statusActive, careDomiciliary, fundingLaDom, riskRows, relRows] =
    await Promise.all([
      prisma.serviceUserTitle.findMany({ where: { isActive: true } }),
      prisma.serviceUserGender.findMany({ where: { isActive: true } }),
      prisma.serviceUserStatus.findUnique({ where: { code: 'ACTIVE' } }),
      prisma.serviceUserCareType.findUnique({ where: { code: 'DOMICILIARY' } }),
      prisma.serviceUserFundingType.findUnique({ where: { code: 'LA_DOMICILIARY' } }),
      prisma.serviceUserRiskLevel.findMany({ where: { isActive: true } }),
      prisma.relationshipType.findMany({ where: { isActive: true } }),
    ])

  if (!statusActive) throw new Error('Service user status ACTIVE not found')
  if (!careDomiciliary) throw new Error('Care type DOMICILIARY not found')

  const titles = new Map(titleRows.map((r) => [r.code, r.id]))
  const genders = new Map(genderRows.map((r) => [r.code, r.id]))
  const risks = new Map(riskRows.map((r) => [r.code, r.id]))
  const relationships = new Map(relRows.map((r) => [r.code, r.id]))

  const created: string[] = []

  for (const def of GREENWICH_SERVICE_USERS) {
    const serviceUserAreaId = areaIds.get(def.areaCode)
    if (!serviceUserAreaId) {
      throw new Error(`Area ${def.areaCode} not resolved for ${def.serviceUserNumber}`)
    }

    const keyWorkerId = await findEmployeeIdByEmail(prisma, def.keyWorkerEmail)

    const core = {
      firstName: def.firstName,
      lastName: def.lastName,
      preferredName: def.preferredName ?? null,
      dateOfBirth: new Date(def.dateOfBirth),
      nhsNumber: def.nhsNumber,
      phone: def.phone ?? null,
      mobile: def.mobile,
      serviceStartDate: new Date(def.serviceStartDate),
      titleId: titles.get(def.titleCode) ?? null,
      genderId: genders.get(def.genderCode) ?? null,
      statusId: statusActive.id,
      careTypeId: careDomiciliary.id,
      fundingTypeId: fundingLaDom?.id ?? null,
      riskLevelId: risks.get(def.riskLevelCode) ?? null,
      locationId,
      serviceUserAreaId,
      keyWorkerId,
      notes: `[GREENWICH] In-service Greenwich council caseload for RM login (${def.serviceUserNumber}).`,
      isActive: true,
      deletedAt: null,
    }

    const existing = await prisma.serviceUser.findFirst({
      where: { serviceUserNumber: def.serviceUserNumber },
    })

    const serviceUser = existing
      ? await prisma.serviceUser.update({ where: { id: existing.id }, data: core })
      : await prisma.serviceUser.create({
          data: { ...core, serviceUserNumber: def.serviceUserNumber },
        })

    await prisma.serviceUserAddress.upsert({
      where: { serviceUserId: serviceUser.id },
      update: {
        addressLine1: def.addressLine1,
        town: def.town,
        county: 'London',
        country: 'United Kingdom',
        postcode: def.postcode,
        latitude: new Prisma.Decimal(def.latitude),
        longitude: new Prisma.Decimal(def.longitude),
        accessInstructions: def.accessInstructions,
        isActive: true,
        deletedAt: null,
      },
      create: {
        serviceUserId: serviceUser.id,
        addressLine1: def.addressLine1,
        town: def.town,
        county: 'London',
        country: 'United Kingdom',
        postcode: def.postcode,
        latitude: new Prisma.Decimal(def.latitude),
        longitude: new Prisma.Decimal(def.longitude),
        accessInstructions: def.accessInstructions,
      },
    })

    await prisma.serviceUserDomCare.upsert({
      where: { serviceUserId: serviceUser.id },
      update: {
        numberOfCarers: 1,
        weeklyContractedHours: def.weeklyContractedHours,
        accessInstruction: def.accessInstructions,
        careInstructions: 'Domiciliary home care — Greenwich council package.',
        isActive: true,
        deletedAt: null,
      },
      create: {
        serviceUserId: serviceUser.id,
        numberOfCarers: 1,
        weeklyContractedHours: def.weeklyContractedHours,
        accessInstruction: def.accessInstructions,
        careInstructions: 'Domiciliary home care — Greenwich council package.',
      },
    })

    const assignment = await prisma.serviceUserAssignment.findFirst({
      where: { serviceUserId: serviceUser.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    })
    if (assignment) {
      await prisma.serviceUserAssignment.update({
        where: { id: assignment.id },
        data: { locationId, keyWorkerId, isActive: true },
      })
    } else {
      await prisma.serviceUserAssignment.create({
        data: {
          serviceUserId: serviceUser.id,
          locationId,
          keyWorkerId,
        },
      })
    }

    const contactExisting = await prisma.serviceUserContact.findFirst({
      where: {
        serviceUserId: serviceUser.id,
        firstName: def.contact.firstName,
        lastName: def.contact.lastName,
        deletedAt: null,
      },
    })
    const contactData = {
      relationshipTypeId: relationships.get(def.contact.relationshipCode) ?? null,
      mobile: def.contact.mobile,
      isPrimary: true,
      isEmergencyContact: true,
      canReceiveUpdates: true,
      isActive: true,
    }
    if (contactExisting) {
      await prisma.serviceUserContact.update({
        where: { id: contactExisting.id },
        data: contactData,
      })
    } else {
      await prisma.serviceUserContact.create({
        data: {
          serviceUserId: serviceUser.id,
          firstName: def.contact.firstName,
          lastName: def.contact.lastName,
          ...contactData,
        },
      })
    }

    created.push(
      `${def.firstName} ${def.lastName} (${def.serviceUserNumber}) · ${def.areaCode} · ACTIVE · ${def.weeklyContractedHours}h`,
    )
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] Greenwich in-service service users ready (${created.length}):`)
  for (const line of created) {
    // eslint-disable-next-line no-console
    console.log(`  - ${line}`)
  }
}
