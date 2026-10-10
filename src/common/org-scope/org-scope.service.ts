import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestUser } from '../decorators/current-user.decorator';
import {
  isCompanyWideRoles,
  resolveScopeType,
  type OrgScope,
} from './org-scope.types';

/** Merge a Prisma where fragment into `where.AND` without clobbering existing filters. */
export function andWhereFragment(
  where: object,
  fragment: object | undefined,
): void {
  if (!fragment) return;
  const target = where as { AND?: unknown };
  const existing = target.AND;
  target.AND = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    fragment,
  ];
}

/**
 * Scope scheduled jobs by branch Location ids.
 * Prefer schedule-area location; fall back to service-user home location
 * (seed/migrated jobs often lack scheduleArea).
 */
export function scheduledJobLocationIdsScope(
  locationIds: string[],
): Prisma.ScheduledJobWhereInput {
  return {
    OR: [
      { scheduleArea: { locationId: { in: locationIds } } },
      { serviceUser: { locationId: { in: locationIds } } },
    ],
  };
}

@Injectable()
export class OrgScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Build scope from an authenticated staff RequestUser (JWT context). */
  fromRequestUser(user: RequestUser): OrgScope {
    const roles = user.roles ?? [];
    const scopeType = resolveScopeType(roles);
    const platformWide = scopeType === 'platform';
    const companyWide = scopeType === 'company' || platformWide;
    return {
      platformWide,
      companyWide,
      locationIds: user.assignedLocationIds ?? null,
      scopeType,
      roles,
      permissions: user.permissions ?? [],
    };
  }

  /**
   * Intersect a client-requested location filter with the user's scope.
   * Returns undefined when unrestricted and no client filter.
   * Returns [] when the intersection is empty (caller should short-circuit).
   */
  resolveListLocationIds(
    scope: OrgScope,
    requestedLocationId?: string | null,
    requestedLocationIds?: string[] | null,
  ): string[] | undefined {
    const requested = normalizeRequestedIds(requestedLocationId, requestedLocationIds);
    if (scope.locationIds === null) {
      return requested;
    }
    const allowed = new Set(scope.locationIds);
    if (!requested?.length) {
      return [...allowed];
    }
    return requested.filter((id) => allowed.has(id));
  }

  /** Throws NotFoundException when location is outside scope (IDOR-safe). */
  assertLocationAccess(scope: OrgScope, locationId: string | null | undefined): void {
    if (!locationId) return;
    if (scope.locationIds === null) return;
    if (!scope.locationIds.includes(locationId)) {
      throw new NotFoundException('Resource not found');
    }
  }

  /** True when any of the location ids intersect the user's scope. */
  locationsInScope(scope: OrgScope, locationIds: Array<string | null | undefined>): boolean {
    if (scope.locationIds === null) return true;
    const allowed = new Set(scope.locationIds);
    return locationIds.some((id) => id != null && allowed.has(id));
  }

  async assertEmployeeInScope(scope: OrgScope, employeeId: string): Promise<void> {
    if (scope.locationIds === null) return;

    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, employee: { deletedAt: null } },
      select: {
        locationId: true,
        baseLocationId: true,
        accessAllZones: true,
        floorLocations: { select: { locationId: true } },
      },
    });

    if (!employment) {
      throw new NotFoundException('Employee not found');
    }

    if (employment.accessAllZones) {
      throw new NotFoundException('Employee not found');
    }

    const ids = [
      employment.locationId,
      employment.baseLocationId,
      ...employment.floorLocations.map((f) => f.locationId),
    ];
    if (!this.locationsInScope(scope, ids)) {
      throw new NotFoundException('Employee not found');
    }
  }

  async assertServiceUserInScope(scope: OrgScope, serviceUserId: string): Promise<void> {
    if (scope.locationIds === null) return;

    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        locationId: true,
        assignments: {
          where: { deletedAt: null },
          select: { locationId: true },
        },
      },
    });
    if (!su) throw new NotFoundException('Service user not found');

    const ids = [su.locationId, ...su.assignments.map((a) => a.locationId)];
    if (!this.locationsInScope(scope, ids)) {
      throw new NotFoundException('Service user not found');
    }
  }

  async assertScheduleAreaInScope(scope: OrgScope, scheduleAreaId: string): Promise<void> {
    if (scope.locationIds === null) return;
    const area = await this.prisma.scheduleArea.findFirst({
      where: { id: scheduleAreaId, deletedAt: null },
      select: { locationId: true },
    });
    if (!area) throw new NotFoundException('Schedule area not found');
    if (!area.locationId || !scope.locationIds.includes(area.locationId)) {
      throw new NotFoundException('Schedule area not found');
    }
  }

  async assertScheduledJobInScope(scope: OrgScope, jobId: string): Promise<void> {
    if (scope.locationIds === null) return;
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: {
        scheduleArea: { select: { locationId: true } },
        serviceUser: { select: { locationId: true } },
      },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    const ids = [job.scheduleArea?.locationId, job.serviceUser?.locationId];
    if (!this.locationsInScope(scope, ids)) {
      throw new NotFoundException('Scheduled job not found');
    }
  }

  async assertScheduleRunInScope(scope: OrgScope, runId: string): Promise<void> {
    if (scope.locationIds === null) return;
    const run = await this.prisma.scheduleRun.findFirst({
      where: { id: runId, deletedAt: null },
      select: {
        scheduleArea: { select: { locationId: true } },
      },
    });
    if (!run) throw new NotFoundException('Schedule run not found');
    // Runs without an area are company-only (legacy); branch users cannot access.
    if (!run.scheduleArea?.locationId) {
      throw new NotFoundException('Schedule run not found');
    }
    this.assertLocationAccess(scope, run.scheduleArea.locationId);
  }

  async assertScheduledVisitInScope(scope: OrgScope, visitId: string): Promise<void> {
    if (scope.locationIds === null) return;
    const visit = await this.prisma.scheduledVisit.findFirst({
      where: { id: visitId, deletedAt: null },
      select: {
        serviceUser: { select: { locationId: true } },
        scheduledJob: {
          select: {
            scheduleArea: { select: { locationId: true } },
            serviceUser: { select: { locationId: true } },
          },
        },
      },
    });
    if (!visit) throw new NotFoundException('Scheduled visit not found');
    const ids = [
      visit.scheduledJob?.scheduleArea?.locationId,
      visit.scheduledJob?.serviceUser?.locationId,
      visit.serviceUser?.locationId,
    ];
    if (!this.locationsInScope(scope, ids)) {
      throw new NotFoundException('Scheduled visit not found');
    }
  }

  async assertJobAllocationInScope(scope: OrgScope, allocationId: string): Promise<void> {
    if (scope.locationIds === null) return;
    const row = await this.prisma.jobAllocation.findFirst({
      where: { id: allocationId, deletedAt: null },
      select: { scheduledJobId: true },
    });
    if (!row) throw new NotFoundException('Job allocation not found');
    await this.assertScheduledJobInScope(scope, row.scheduledJobId);
  }

  /**
   * Prisma fragment for employees whose employment locations intersect scope.
   * When unrestricted, returns undefined (no extra filter).
   */
  employeeEmploymentScopeWhere(
    scope: OrgScope,
  ): { employment: { is: object } } | { id: { in: [] } } | undefined {
    if (scope.locationIds === null) return undefined;
    if (scope.locationIds.length === 0) return { id: { in: [] } };
    const ids = scope.locationIds;
    return {
      employment: {
        is: {
          accessAllZones: false,
          OR: [
            { locationId: { in: ids } },
            { baseLocationId: { in: ids } },
            { floorLocations: { some: { locationId: { in: ids } } } },
          ],
        },
      },
    };
  }

  /** Prisma fragment for service users in scope. */
  serviceUserScopeWhere(
    scope: OrgScope,
  ): Prisma.ServiceUserWhereInput | { id: { in: [] } } | undefined {
    if (scope.locationIds === null) return undefined;
    if (scope.locationIds.length === 0) return { id: { in: [] } };
    const ids = scope.locationIds;
    return {
      OR: [
        { locationId: { in: ids } },
        { assignments: { some: { deletedAt: null, locationId: { in: ids } } } },
      ],
    };
  }

  scheduledJobScopeWhere(
    scope: OrgScope,
  ): Prisma.ScheduledJobWhereInput | { id: { in: [] } } | undefined {
    if (scope.locationIds === null) return undefined;
    if (scope.locationIds.length === 0) return { id: { in: [] } };
    return scheduledJobLocationIdsScope(scope.locationIds);
  }

  scheduleAreaScopeWhere(
    scope: OrgScope,
  ): Prisma.ScheduleAreaWhereInput | { id: { in: [] } } | undefined {
    if (scope.locationIds === null) return undefined;
    if (scope.locationIds.length === 0) return { id: { in: [] } };
    return { locationId: { in: scope.locationIds } };
  }

  scheduleRunScopeWhere(
    scope: OrgScope,
  ): Prisma.ScheduleRunWhereInput | { id: { in: [] } } | undefined {
    if (scope.locationIds === null) return undefined;
    if (scope.locationIds.length === 0) return { id: { in: [] } };
    return { scheduleArea: { locationId: { in: scope.locationIds } } };
  }

  jobAllocationScopeWhere(
    scope: OrgScope,
  ): Prisma.JobAllocationWhereInput | { id: { in: [] } } | undefined {
    const jobWhere = this.scheduledJobScopeWhere(scope);
    if (!jobWhere) return undefined;
    if ('id' in jobWhere) {
      return { id: { in: [] } };
    }
    return { scheduledJob: jobWhere };
  }

  scheduledVisitScopeWhere(
    scope: OrgScope,
  ): Prisma.ScheduledVisitWhereInput | { id: { in: [] } } | undefined {
    if (scope.locationIds === null) return undefined;
    if (scope.locationIds.length === 0) return { id: { in: [] } };
    const ids = scope.locationIds;
    return {
      OR: [
        { serviceUser: { locationId: { in: ids } } },
        {
          scheduledJob: {
            OR: [
              { scheduleArea: { locationId: { in: ids } } },
              { serviceUser: { locationId: { in: ids } } },
            ],
          },
        },
      ],
    };
  }

  /**
   * Incidents: direct locationId and/or primary service user's branch.
   * No Prisma relation on Incident→ServiceUser (cross-schema id only), so SU
   * home-branch matching uses a preliminary id lookup when needed.
   */
  async incidentScopeWhere(
    scope: OrgScope,
  ): Promise<Prisma.IncidentWhereInput | { id: { in: [] } } | undefined> {
    if (scope.locationIds === null) return undefined;
    if (scope.locationIds.length === 0) return { id: { in: [] } };
    const ids = scope.locationIds;
    const serviceUsers = await this.prisma.serviceUser.findMany({
      where: { deletedAt: null, locationId: { in: ids } },
      select: { id: true },
    });
    const suIds = serviceUsers.map((s) => s.id);
    return {
      OR: [
        { locationId: { in: ids } },
        ...(suIds.length
            ? [
                { primaryServiceUserId: { in: suIds } },
                { involvedServiceUserIds: { hasSome: suIds } },
              ]
            : []),
      ],
    };
  }

  async assertIncidentInScope(scope: OrgScope, incidentId: string): Promise<void> {
    if (scope.locationIds === null) return;
    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId, deletedAt: null },
      select: {
        locationId: true,
        primaryServiceUserId: true,
        involvedServiceUserIds: true,
      },
    });
    if (!incident) throw new NotFoundException('Incident not found');

    if (incident.locationId && scope.locationIds.includes(incident.locationId)) {
      return;
    }
    // In scope when any involved service user belongs to one of the user's branches.
    const serviceUserIds = [
      ...new Set(
        [incident.primaryServiceUserId, ...incident.involvedServiceUserIds].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    if (serviceUserIds.length) {
      const inBranch = await this.prisma.serviceUser.count({
        where: {
          id: { in: serviceUserIds },
          deletedAt: null,
          locationId: { in: scope.locationIds },
        },
      });
      if (inBranch > 0) return;
    }
    throw new NotFoundException('Incident not found');
  }

  /**
   * Shared ECM / scheduling list filter: intersects client location/area/SU
   * with the actor's org scope. Returns `{ empty: true }` when nothing is visible.
   */
  async resolveScheduledJobListFilter(
    actor: RequestUser | undefined,
    query: {
      locationId?: string | null;
      scheduleAreaId?: string | null;
      serviceUserId?: string | null;
    },
  ): Promise<{ empty: true } | { where: Prisma.ScheduledJobWhereInput }> {
    const base: Prisma.ScheduledJobWhereInput = {
      deletedAt: null,
      isActive: true,
    };

    if (!actor) {
      return {
        where: {
          ...base,
          ...(query.scheduleAreaId ? { scheduleAreaId: query.scheduleAreaId } : {}),
          ...(query.locationId
            ? scheduledJobLocationIdsScope([query.locationId])
            : {}),
          ...(query.serviceUserId ? { serviceUserId: query.serviceUserId } : {}),
        },
      };
    }

    const scope = this.fromRequestUser(actor);
    if (scope.locationIds?.length === 0) return { empty: true };

    const locationIds = this.resolveListLocationIds(
      scope,
      query.locationId,
      undefined,
    );
    if (locationIds && locationIds.length === 0) return { empty: true };

    if (query.scheduleAreaId) {
      await this.assertScheduleAreaInScope(scope, query.scheduleAreaId);
    }
    if (query.serviceUserId) {
      await this.assertServiceUserInScope(scope, query.serviceUserId);
    }

    const and: Prisma.ScheduledJobWhereInput[] = [];
    if (locationIds?.length) {
      and.push(scheduledJobLocationIdsScope(locationIds));
    } else {
      const frag = this.scheduledJobScopeWhere(scope);
      if (frag) and.push(frag);
    }

    return {
      where: {
        ...base,
        ...(query.scheduleAreaId ? { scheduleAreaId: query.scheduleAreaId } : {}),
        ...(query.serviceUserId ? { serviceUserId: query.serviceUserId } : {}),
        ...(and.length ? { AND: and } : {}),
      },
    };
  }
}

function normalizeRequestedIds(
  locationId?: string | null,
  locationIds?: string[] | null,
): string[] | undefined {
  const set = new Set<string>();
  if (locationId) set.add(locationId);
  if (locationIds?.length) {
    for (const id of locationIds) {
      if (id) set.add(id);
    }
  }
  return set.size ? [...set] : undefined;
}

export { isCompanyWideRoles, resolveScopeType };
