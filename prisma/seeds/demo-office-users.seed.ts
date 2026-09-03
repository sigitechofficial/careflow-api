import type { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const DEMO_PASSWORD = process.env.ADMIN_SEED_PASSWORD?.trim() || 'Admin@12345'

type DemoOfficeUser = {
  email: string
  username: string
  firstName: string
  lastName: string
  roleName: string
  /** When true, assign the first active Location as UserLocation (branch scope). */
  assignFirstBranch?: boolean
  /** Prefer matching location by name contains (case-insensitive). */
  preferredLocationNameContains?: string
}

/**
 * Demo office logins for Approach A hierarchy testing.
 * Super Admin remains the existing ADMIN_SEED_EMAIL user (full access).
 */
const DEMO_USERS: DemoOfficeUser[] = [
  {
    email: 'company.admin@careadmin.local',
    username: 'companyadmin',
    firstName: 'Company',
    lastName: 'Admin',
    roleName: 'Admin',
  },
  {
    email: 'master.alloc@careadmin.local',
    username: 'masteralloc',
    firstName: 'Master',
    lastName: 'Allocator',
    roleName: 'Master Staff Allocation',
  },
  {
    email: 'branch.admin@careadmin.local',
    username: 'branchadmin',
    firstName: 'Branch',
    lastName: 'Admin',
    roleName: 'Branch Admin',
    assignFirstBranch: true,
  },
  {
    email: 'staff.alloc@careadmin.local',
    username: 'staffalloc',
    firstName: 'Staff',
    lastName: 'Allocator',
    roleName: 'Staff Allocation',
    assignFirstBranch: true,
    preferredLocationNameContains: 'Transport',
  },
  {
    email: 'manager@careadmin.local',
    username: 'manager',
    firstName: 'Site',
    lastName: 'Manager',
    roleName: 'Manager',
    assignFirstBranch: true,
    preferredLocationNameContains: 'Transport',
  },
  {
    email: 'coordinator@careadmin.local',
    username: 'coordinator',
    firstName: 'Care',
    lastName: 'Coordinator',
    roleName: 'Care Coordinator',
    assignFirstBranch: true,
    preferredLocationNameContains: 'Greenwich',
  },
  {
    email: 'hr@careadmin.local',
    username: 'hruser',
    firstName: 'HR',
    lastName: 'Officer',
    roleName: 'HR',
    assignFirstBranch: true,
    preferredLocationNameContains: 'Greenwich',
  },
]

const BRANCH_ADMIN_PERM_KEYS = [
  'employees.read',
  'employees.create',
  'employees.update',
  'employees.status.update',
  'employees.documents.read',
  'employees.documents.upload',
  'employees.compliance.read',
  'employees.reports.read',
  'lookups.read',
  'service_users.read',
  'service_users.create',
  'service_users.update',
  'service_users.assignments.read',
  'service_users.assignments.update',
  'incidents.read',
  'incidents.create',
  'incidents.update',
  'scheduled_jobs.read',
  'scheduled_visits.read',
  'job_allocations.read',
  'job_allocations.allocate',
  'schedules.read',
  'schedules.status.read',
  'schedule_areas.read',
  'schedule_runs.read',
  'scheduled_jobs_housekeeping.read',
  'call_off_visits.read',
  'ecm.read',
  'ecm.monitor',
  'notifications.read',
  // Branch office-user management (own branches only; anti-escalation on roles)
  'users.read',
  'users.create',
  'roles.manage',
]

const MASTER_ALLOC_PERM_KEYS = [
  'employees.read',
  'service_users.read',
  'service_users.assignments.read',
  'lookups.read',
  'scheduled_jobs.read',
  'scheduled_visits.read',
  'job_allocations.read',
  'job_allocations.allocate',
  'job_allocations.confirm',
  'schedules.read',
  'schedules.status.read',
  'schedules.build',
  'schedule_areas.read',
  'schedule_runs.read',
  'scheduled_jobs_housekeeping.read',
  'notifications.read',
]

async function assignPermKeys(prisma: PrismaClient, roleName: string, keys: string[]) {
  const role = await prisma.role.findFirst({
    where: { name: roleName, deletedAt: null },
  })
  if (!role) return
  const perms = await prisma.permission.findMany({
    where: { key: { in: keys }, deletedAt: null },
  })
  for (const p of perms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
      update: {},
      create: { roleId: role.id, permissionId: p.id },
    })
  }
}

/** Ensure Approach A roles exist even if full seed was not re-run. */
export async function ensureHierarchyRoles(prisma: PrismaClient): Promise<void> {
  await prisma.role.upsert({
    where: { name: 'Branch Admin' },
    update: {
      isActive: true,
      deletedAt: null,
      description:
        'Branch-scoped administrator. Job titles (e.g. Registered Branch Manager) remain separate.',
    },
    create: {
      name: 'Branch Admin',
      description:
        'Branch-scoped administrator. Job titles (e.g. Registered Branch Manager) remain separate.',
      isActive: true,
    },
  })

  await prisma.role.upsert({
    where: { name: 'Master Staff Allocation' },
    update: {
      isActive: true,
      deletedAt: null,
      description: 'Company-wide staff allocation across all branches (not full Company Admin).',
    },
    create: {
      name: 'Master Staff Allocation',
      description: 'Company-wide staff allocation across all branches (not full Company Admin).',
      isActive: true,
    },
  })

  await assignPermKeys(prisma, 'Branch Admin', BRANCH_ADMIN_PERM_KEYS)
  await assignPermKeys(prisma, 'Master Staff Allocation', MASTER_ALLOC_PERM_KEYS)
  await assignPermKeys(prisma, 'Staff Allocation', [
    'employees.read',
    'service_users.read',
    'service_users.assignments.read',
    'lookups.read',
    'scheduled_jobs.read',
    'job_allocations.read',
    'job_allocations.allocate',
    'schedules.read',
    'scheduled_jobs_housekeeping.read',
  ])
  await assignPermKeys(prisma, 'Admin', ['users.read', 'users.create', 'roles.manage'])
  await assignPermKeys(prisma, 'Manager', [
    'lookups.read',
    'employees.read',
    'service_users.read',
    'service_users.lookups.read',
  ])
  await assignPermKeys(prisma, 'Care Coordinator', [
    'lookups.read',
    'employees.read',
    'service_users.read',
    'service_users.lookups.read',
  ])
}

async function resolveBranchLocationId(
  prisma: PrismaClient,
  preferredContains?: string,
): Promise<string | null> {
  if (preferredContains?.trim()) {
    const preferred = await prisma.location.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        name: { contains: preferredContains.trim(), mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      select: { id: true },
    })
    if (preferred) return preferred.id
  }

  const first = await prisma.location.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true },
  })
  return first?.id ?? null
}

/** Re-grant every active permission to Super Admin (platform-wide access). */
export async function ensureSuperAdminAllPermissions(prisma: PrismaClient): Promise<void> {
  const superAdmin = await prisma.role.findFirst({
    where: { name: 'Super Admin', deletedAt: null, isActive: true },
  })
  if (!superAdmin) return

  const permissions = await prisma.permission.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true },
  })

  for (const p of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: superAdmin.id, permissionId: p.id },
      },
      update: {},
      create: { roleId: superAdmin.id, permissionId: p.id },
    })
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] Super Admin has all ${permissions.length} permissions.`)
}

export async function seedDemoOfficeUsers(prisma: PrismaClient): Promise<void> {
  await ensureHierarchyRoles(prisma)
  await ensureSuperAdminAllPermissions(prisma)

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)
  const created: string[] = []

  for (const def of DEMO_USERS) {
    const role = await prisma.role.findFirst({
      where: { name: def.roleName, deletedAt: null, isActive: true },
    })
    if (!role) {
      // eslint-disable-next-line no-console
      console.warn(`[seed] Skip ${def.email}: role "${def.roleName}" not found`)
      continue
    }

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

    // Replace roles with the intended demo role (idempotent for these accounts).
    await prisma.userRole.deleteMany({ where: { userId: user.id } })
    await prisma.userRole.create({
      data: { userId: user.id, roleId: role.id },
    })

    if (def.assignFirstBranch) {
      const locationId = await resolveBranchLocationId(prisma, def.preferredLocationNameContains)
      await prisma.userLocation.deleteMany({ where: { userId: user.id } })
      if (locationId) {
        await prisma.userLocation.create({
          data: { userId: user.id, locationId },
        })
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[seed] ${def.email}: no Location found for branch assignment`)
      }
    }

    created.push(`${def.email} → ${def.roleName}`)
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] Demo office users ready (password: ${DEMO_PASSWORD}):`)
  for (const line of created) {
    // eslint-disable-next-line no-console
    console.log(`  - ${line}`)
  }
}
