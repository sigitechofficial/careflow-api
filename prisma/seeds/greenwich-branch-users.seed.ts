/**
 * Greenwich council branch staff: User + Employee + Employment + UserLocation.
 * Branch-scoped only (accessAllZones = false, UserLocation = Greenwich).
 */
import type { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { ensureHierarchyRoles } from './demo-office-users.seed'

export const GREENWICH_LOCATION_ID = 'effd3c02-9d9b-4656-b79a-eab399ec4d00'
export const GREENWICH_LOCATION_NAME = 'Greenwich council - Greenwich'
export const GREENWICH_BRANCH_PASSWORD = process.env.ADMIN_SEED_PASSWORD?.trim() || 'Admin@12345'

type GreenwichStaffDef = {
  email: string
  username: string
  firstName: string
  lastName: string
  identityRole: string
  jobTitle: string
  employeeRoleLookup: string
  rbacLevel: string
  workArea: 'Administration' | 'Care'
  isCarer: boolean
  employeeNumber: string
}

/** Stable demo identities for Greenwich council (London). */
export const GREENWICH_STAFF: GreenwichStaffDef[] = [
  {
    email: 'rm.greenwich@careadmin.local',
    username: 'rm.greenwich',
    firstName: 'Eleanor',
    lastName: 'Briggs',
    identityRole: 'Branch Admin',
    jobTitle: 'Registered Manager',
    employeeRoleLookup: 'Registered Manager',
    rbacLevel: 'Branch Administrator',
    workArea: 'Administration',
    isCarer: false,
    employeeNumber: 'GW-RM-01',
  },
  {
    email: 'om.greenwich@careadmin.local',
    username: 'om.greenwich',
    firstName: 'Sophie',
    lastName: 'Langley',
    identityRole: 'Manager',
    jobTitle: 'Office Manager',
    employeeRoleLookup: 'Office Manager',
    rbacLevel: 'Manager',
    workArea: 'Administration',
    isCarer: false,
    employeeNumber: 'GW-OM-01',
  },
  {
    email: 'sa.greenwich@careadmin.local',
    username: 'sa.greenwich',
    firstName: 'James',
    lastName: 'Okonkwo',
    identityRole: 'Staff Allocation',
    jobTitle: 'Staff Allocator',
    employeeRoleLookup: 'Staff Allocator',
    rbacLevel: 'Staff Allocation',
    workArea: 'Administration',
    isCarer: false,
    employeeNumber: 'GW-SA-01',
  },
  {
    email: 'ops.greenwich@careadmin.local',
    username: 'ops.greenwich',
    firstName: 'David',
    lastName: 'Chen',
    identityRole: 'Manager',
    jobTitle: 'Operations Manager',
    employeeRoleLookup: 'Operations Manager',
    rbacLevel: 'Operation Management',
    workArea: 'Administration',
    isCarer: false,
    employeeNumber: 'GW-OPS-01',
  },
  {
    email: 'carer1.greenwich@careadmin.local',
    username: 'carer1.greenwich',
    firstName: 'Amina',
    lastName: 'Yusuf',
    identityRole: 'Carer/Domestic',
    jobTitle: 'Carer',
    employeeRoleLookup: 'Carer',
    rbacLevel: 'Carer/Domestic',
    workArea: 'Care',
    isCarer: true,
    employeeNumber: 'GW-CR-01',
  },
  {
    email: 'carer2.greenwich@careadmin.local',
    username: 'carer2.greenwich',
    firstName: 'Liam',
    lastName: 'Walsh',
    identityRole: 'Carer/Domestic',
    jobTitle: 'Carer',
    employeeRoleLookup: 'Carer',
    rbacLevel: 'Carer/Domestic',
    workArea: 'Care',
    isCarer: true,
    employeeNumber: 'GW-CR-02',
  },
  {
    email: 'carer3.greenwich@careadmin.local',
    username: 'carer3.greenwich',
    firstName: 'Chloe',
    lastName: 'Mensah',
    identityRole: 'Carer/Domestic',
    jobTitle: 'Carer',
    employeeRoleLookup: 'Carer',
    rbacLevel: 'Carer/Domestic',
    workArea: 'Care',
    isCarer: true,
    employeeNumber: 'GW-CR-03',
  },
]

async function upsertNamedLookup(
  prisma: PrismaClient,
  model: 'jobTitle' | 'employeeRoleLookup' | 'rBACLevel',
  name: string,
): Promise<{ id: string; name: string }> {
  return prisma[model].upsert({
    where: { name },
    update: { isActive: true, deletedAt: null },
    create: { name, isActive: true },
    select: { id: true, name: true },
  })
}

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
      name: { contains: 'Greenwich', mode: 'insensitive' },
    },
    orderBy: { name: 'asc' },
    select: { id: true },
  })
  if (byName) return byName.id

  throw new Error('Greenwich location not found (expected Greenwich council - Greenwich)')
}

export async function seedGreenwichBranchUsers(prisma: PrismaClient): Promise<void> {
  await ensureHierarchyRoles(prisma)

  const locationId = await resolveGreenwichLocationId(prisma)
  const passwordHash = await bcrypt.hash(GREENWICH_BRANCH_PASSWORD, 12)

  const activeStatus = await prisma.employeeStatus.findFirst({
    where: { name: 'Active', deletedAt: null },
    select: { id: true },
  })
  const careArea = await prisma.workArea.findFirst({
    where: { name: 'Care', deletedAt: null },
    select: { id: true },
  })
  const adminArea = await prisma.workArea.findFirst({
    where: { name: 'Administration', deletedAt: null },
    select: { id: true },
  })

  const created: string[] = []

  for (const def of GREENWICH_STAFF) {
    const role = await prisma.role.findFirst({
      where: { name: def.identityRole, deletedAt: null, isActive: true },
    })
    if (!role) {
      // eslint-disable-next-line no-console
      console.warn(`[seed] Skip ${def.email}: identity role "${def.identityRole}" not found`)
      continue
    }

    const [jobTitle, empRole, rbac] = await Promise.all([
      upsertNamedLookup(prisma, 'jobTitle', def.jobTitle),
      upsertNamedLookup(prisma, 'employeeRoleLookup', def.employeeRoleLookup),
      upsertNamedLookup(prisma, 'rBACLevel', def.rbacLevel),
    ])

    const workAreaId = def.workArea === 'Care' ? careArea?.id : adminArea?.id

    const user = await prisma.user.upsert({
      where: { email: def.email },
      update: {
        passwordHash,
        username: def.username,
        firstName: def.firstName,
        lastName: def.lastName,
        isActive: true,
        deletedAt: null,
      },
      create: {
        email: def.email,
        username: def.username,
        passwordHash,
        firstName: def.firstName,
        lastName: def.lastName,
        isActive: true,
      },
    })

    await prisma.userRole.deleteMany({ where: { userId: user.id } })
    await prisma.userRole.create({
      data: { userId: user.id, roleId: role.id },
    })

    await prisma.userLocation.deleteMany({ where: { userId: user.id } })
    await prisma.userLocation.create({
      data: { userId: user.id, locationId },
    })

    const existingPersonal = await prisma.employeePersonalDetail.findFirst({
      where: {
        OR: [{ email: def.email }, { username: def.username }],
      },
      select: { employeeId: true, email: true, username: true },
    })

    let employeeId = existingPersonal?.employeeId
    if (!employeeId) {
      const employee = await prisma.employee.create({
        data: { isActive: true },
      })
      employeeId = employee.id
      await prisma.employeePersonalDetail.create({
        data: {
          employeeId,
          firstName: def.firstName,
          lastName: def.lastName,
          email: def.email,
          username: def.username,
          statusId: activeStatus?.id,
          isActive: true,
        },
      })
    } else {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { isActive: true, deletedAt: null },
      })
      await prisma.employeePersonalDetail.update({
        where: { employeeId },
        data: {
          firstName: def.firstName,
          lastName: def.lastName,
          email: def.email,
          username: def.username,
          statusId: activeStatus?.id,
          isActive: true,
          deletedAt: null,
        },
      })
    }

    const employment = await prisma.employeeEmployment.findUnique({
      where: { employeeId },
      select: { id: true },
    })
    const employmentData = {
      jobTitleId: jobTitle.id,
      roleId: empRole.id,
      rbacLevelId: rbac.id,
      workAreaId: workAreaId ?? null,
      baseLocationId: locationId,
      locationId,
      accessAllZones: false,
      defaultZoneView: false,
      employeeNumber: def.employeeNumber,
      contractedWeeklyHours: 37.5,
      startDate: new Date('2024-04-01T00:00:00.000Z'),
      isActive: true,
      deletedAt: null,
    }
    if (employment) {
      await prisma.employeeEmployment.update({
        where: { employeeId },
        data: employmentData,
      })
    } else {
      await prisma.employeeEmployment.create({
        data: { employeeId, ...employmentData },
      })
    }

    if (def.isCarer) {
      const portal = await prisma.employeePortalAccount.findFirst({
        where: { OR: [{ employeeId }, { email: def.email }] },
        select: { id: true },
      })
      if (portal) {
        await prisma.employeePortalAccount.update({
          where: { id: portal.id },
          data: {
            employeeId,
            email: def.email,
            passwordHash,
            isEnabled: true,
            deletedAt: null,
          },
        })
      } else {
        await prisma.employeePortalAccount.create({
          data: {
            employeeId,
            email: def.email,
            passwordHash,
            isEnabled: true,
          },
        })
      }
    }

    created.push(
      `${def.firstName} ${def.lastName} | ${def.jobTitle} | ${def.email} | ${def.identityRole}`,
    )
  }

  const passwordHint =
    process.env.NODE_ENV === 'production'
      ? 'ADMIN_SEED_PASSWORD or default seed password'
      : GREENWICH_BRANCH_PASSWORD
  // eslint-disable-next-line no-console
  console.log(`[seed] Greenwich branch users ready (password: ${passwordHint}):`)
  for (const line of created) {
    // eslint-disable-next-line no-console
    console.log(`  - ${line}`)
  }
}
