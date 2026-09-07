import type { PrismaClient } from '@prisma/client'

/** Roles that should see manager-attention queues and review notifications. */
export const MANAGER_ATTENTION_ROLE_NAMES = ['Admin', 'Manager', 'Branch Admin'] as const

/**
 * In-app recipients for IA / care-plan / assessment items that need a manager.
 * Branch-scoped users (UserLocation) only get the service user's branch.
 * Admins and users with no location rows are treated as company-wide.
 */
export async function resolveManagerUserIds(
  prisma: PrismaClient,
  opts?: { locationId?: string | null; excludeUserId?: string },
): Promise<string[]> {
  const roles = await prisma.role.findMany({
    where: {
      name: { in: [...MANAGER_ATTENTION_ROLE_NAMES] },
      deletedAt: null,
      isActive: true,
    },
    select: { id: true, name: true },
  })
  if (!roles.length) return []

  const links = await prisma.userRole.findMany({
    where: { roleId: { in: roles.map((r) => r.id) } },
    select: { userId: true, roleId: true },
  })
  const allUserIds = [...new Set(links.map((l) => l.userId))]
  if (!allUserIds.length) return []

  const adminRoleIds = new Set(roles.filter((r) => r.name === 'Admin').map((r) => r.id))
  const adminUserIds = new Set(
    links.filter((l) => adminRoleIds.has(l.roleId)).map((l) => l.userId),
  )

  const locRows = await prisma.userLocation.findMany({
    where: { userId: { in: allUserIds } },
    select: { userId: true, locationId: true },
  })
  const locationsByUser = new Map<string, string[]>()
  for (const row of locRows) {
    const list = locationsByUser.get(row.userId) ?? []
    list.push(row.locationId)
    locationsByUser.set(row.userId, list)
  }

  const locationId = opts?.locationId?.trim() || null
  const scoped = allUserIds.filter((id) => {
    if (adminUserIds.has(id)) return true
    const locs = locationsByUser.get(id)
    if (!locs?.length) return true
    if (!locationId) return true
    return locs.includes(locationId)
  })

  return scoped.filter((id) => id !== opts?.excludeUserId)
}
