import { DataAccessType, ServiceUserCarePlanInstanceStatus, type Prisma } from '@prisma/client';
import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateServiceUserDto } from './dto/create-service-user.dto';
import { UpdateServiceUserDto } from './dto/update-service-user.dto';
import { ServiceUserQueryDto } from './dto/service-user-query.dto';
import { UpdateServiceUserStatusDto } from './dto/update-service-user-status.dto';
import type { ServiceUserReferenceItemDto } from './dto/service-user-reference-item.dto';
import { PatchServiceUserFundingRefsDto } from './dto/patch-service-user-funding-refs.dto';
import { activeServiceUserAbsenceWhere } from '../service-user-absences/active-absence.util';
import { activeServiceUserFlashMessageWhere } from '../service-user-flash-messages/active-flash-message.util';
import { mapServiceUserDetail, mapServiceUserListRow } from './mappers/service-user.mapper';
import { carePlanListStatusByServiceUser } from '../service-user-care-plans/care-plan-review-schedule';
import { assertDefaultChargeCard } from '../billing/charge-card-assignment.util';
import {
  inferBranchFromAddress,
  loadBranchAreasForInference,
  loadScheduleAreaByLocationMap,
  pickDefaultBranchForIndex,
} from '../location-management/service-user-branch.util';
import {
  activeFlashMessageListWhere,
  activeMedicalConditionListWhere,
  appendWhereAnd,
  BEHAVIOUR_INCIDENT_SUBTYPE_KEYS,
  carePlanFormIdsWhere,
  carePlanListStatusWhere,
  findServiceUserIdsWithBehaviourIncident,
  findServiceUserIdsWithConfirmedMissedVisitsAtLeast,
  findServiceUserIdsWithSafeguardingIncidents,
  hospitalisedListWhere,
  initialAssessmentStatusWhere,
  mergeDateOfBirthFilter,
  openLoneWorkerRiskWhere,
  SAFEGUARDING_INCIDENT_SUBTYPE_KEYS,
} from './service-user-list-filters.util';
import {
  parseServiceUserDateOfDeath,
  SU_PROFILE_DATE_OF_DEATH_REF,
} from './service-user-date-of-death.util';

export type ServiceUserAuditMeta = RequestAuditMeta & { actorUserId: string };

const detailInclude = {
  title: true,
  gender: true,
  maritalStatus: true,
  status: true,
  careType: true,
  fundingType: true,
  riskLevel: true,
  location: true,
  serviceUserArea: {
    select: {
      id: true,
      name: true,
      code: true,
      scheduleAreaId: true,
      postcodes: { select: { postcode: true }, orderBy: { postcode: 'asc' as const } },
    },
  },
  address: true,
  contacts: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
    include: { relationshipType: true },
  },
  references: { where: { deletedAt: null } },
  assignments: {
    where: { deletedAt: null },
    orderBy: { updatedAt: 'desc' as const },
    take: 1,
    include: {
      keyWorker: { include: { personalDetail: true } },
      namedNurse: { include: { personalDetail: true } },
      location: true,
    },
  },
  photos: {
    where: { deletedAt: null },
    orderBy: { uploadedAt: 'desc' as const },
  },
  keyWorker: { include: { personalDetail: true } },
  namedNurse: { include: { personalDetail: true } },
  defaultChargeCard: { select: { id: true, name: true, code: true, status: true } },
} satisfies Prisma.ServiceUserInclude;

@Injectable()
export class ServiceUsersService implements OnModuleInit {
  private readonly logger = new Logger(ServiceUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  private async ensureActiveEmployee(id: string | null | undefined): Promise<void> {
    if (!id) return;
    const e = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null, isActive: true },
    });
    if (!e) throw new BadRequestException(`Employee ${id} not found or inactive`);
  }

  private async ensureActiveLocation(id: string | null | undefined): Promise<void> {
    if (!id) return;
    const loc = await this.prisma.location.findFirst({
      where: { id, deletedAt: null, isActive: true },
    });
    if (!loc) throw new BadRequestException(`Location ${id} not found or inactive`);
  }

  /** When an area is set, derive the branch locationId from that area’s schedule area. */
  private async resolveLocationFromServiceUserArea(
    serviceUserAreaId: string | null | undefined,
  ): Promise<{ serviceUserAreaId: string; locationId: string } | null> {
    if (!serviceUserAreaId) return null;
    const area = await this.prisma.serviceUserArea.findFirst({
      where: { id: serviceUserAreaId, deletedAt: null, isActive: true },
      include: {
        scheduleArea: { select: { locationId: true, deletedAt: true, isActive: true } },
      },
    });
    if (!area || !area.scheduleArea || area.scheduleArea.deletedAt || !area.scheduleArea.isActive) {
      throw new BadRequestException('Service user area not found');
    }
    if (!area.scheduleArea.locationId) {
      throw new BadRequestException(
        'This area’s branch has no linked location. Link a location on the schedule area first.',
      );
    }
    return { serviceUserAreaId: area.id, locationId: area.scheduleArea.locationId };
  }

  async validateAssignments(dto: {
    keyWorkerId?: string | null;
    namedNurseId?: string | null;
    locationId?: string | null;
  }) {
    await this.ensureActiveEmployee(dto.keyWorkerId);
    await this.ensureActiveEmployee(dto.namedNurseId);
    await this.ensureActiveLocation(dto.locationId);
  }

  async onModuleInit() {
    try {
      const result = await this.backfillAllServiceUserBranchLinks();
      if (result.synced > 0 || result.inferred > 0 || result.defaulted > 0) {
        this.logger.log(
          `Service user branches: synced ${result.synced}, inferred ${result.inferred}, defaulted ${result.defaulted} (${result.scanned} scanned)`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Service user zone/branch backfill failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Align ServiceUser.locationId with ServiceUserAssignment for every active record.
   */
  async backfillAllServiceUserBranchLinks(): Promise<{
    synced: number;
    inferred: number;
    defaulted: number;
    scanned: number;
  }> {
    const branchAreas = await loadBranchAreasForInference(this.prisma);
    const users = await this.prisma.serviceUser.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        locationId: true,
        keyWorkerId: true,
        namedNurseId: true,
        address: { select: { town: true, postcode: true, county: true } },
        assignments: {
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { id: true, locationId: true },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    let synced = 0;
    let inferred = 0;
    let defaulted = 0;
    let defaultIndex = 0;
    for (const su of users) {
      const assignment = su.assignments[0] ?? null;
      const assignmentLocationId = assignment?.locationId ?? null;
      const needsSync =
        (!su.locationId && assignmentLocationId) ||
        (su.locationId && assignment && assignmentLocationId !== su.locationId) ||
        (su.locationId && !assignment);

      if (needsSync) {
        await this.reconcileServiceUserBranchLinks(su.id);
        synced += 1;
        continue;
      }

      if (!su.locationId) {
        const inferredMatch = inferBranchFromAddress(su.address, branchAreas);
        const match =
          inferredMatch ?? pickDefaultBranchForIndex(branchAreas, defaultIndex);
        if (match) {
          if (inferredMatch) inferred += 1;
          else {
            defaultIndex += 1;
            defaulted += 1;
          }
          await this.assignServiceUserBranch(su.id, match.locationId);
        }
      }
    }

    return { synced, inferred, defaulted, scanned: users.length };
  }

  private async assignServiceUserBranch(serviceUserId: string, locationId: string): Promise<void> {
    const su = await this.prisma.serviceUser.update({
      where: { id: serviceUserId },
      data: { locationId },
      select: {
        id: true,
        keyWorkerId: true,
        namedNurseId: true,
      },
    });

    const assignment = await this.prisma.serviceUserAssignment.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });

    if (assignment) {
      await this.prisma.serviceUserAssignment.update({
        where: { id: assignment.id },
        data: { locationId },
      });
      return;
    }

    await this.prisma.serviceUserAssignment.create({
      data: {
        serviceUserId,
        locationId,
        keyWorkerId: su.keyWorkerId,
        namedNurseId: su.namedNurseId,
      },
    });
  }

  private async reconcileServiceUserBranchLinks(
    serviceUserId: string,
    userId?: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const su = await db.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      include: {
        assignments: {
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!su) return;

    const assignment = su.assignments[0] ?? null;
    const assignmentLocationId = assignment?.locationId ?? null;

    if (!su.locationId && assignmentLocationId) {
      await db.serviceUser.update({
        where: { id: serviceUserId },
        data: {
          locationId: assignmentLocationId,
          ...(userId ? { updatedById: userId } : {}),
        },
      });
      return;
    }

    if (su.locationId && assignment && assignmentLocationId !== su.locationId) {
      await db.serviceUserAssignment.update({
        where: { id: assignment.id },
        data: {
          locationId: su.locationId,
          ...(userId ? { updatedById: userId } : {}),
        },
      });
      return;
    }

    if (su.locationId && !assignment) {
      await db.serviceUserAssignment.create({
        data: {
          serviceUserId,
          locationId: su.locationId,
          keyWorkerId: su.keyWorkerId,
          namedNurseId: su.namedNurseId,
          ...(userId ? { createdById: userId } : {}),
        },
      });
    }
  }

  async list(query: ServiceUserQueryDto, actor?: RequestUser) {
    if (query.ageMin != null && query.ageMax != null && query.ageMin > query.ageMax) {
      throw new BadRequestException('Age from must be less than or equal to age to.');
    }
    if (query.dateOfDeathFrom && query.dateOfDeathTo && query.dateOfDeathFrom > query.dateOfDeathTo) {
      throw new BadRequestException('Date of death from must be on or before date of death to.');
    }
    if (query.missedVisitsFrom && query.missedVisitsTo && query.missedVisitsFrom > query.missedVisitsTo) {
      throw new BadRequestException('Visit from date must be on or before the to date.');
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ServiceUserWhereInput = {};
    if (query.showDeleted) {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
      if (!query.showInactive) {
        where.isActive = true;
      }
    }
    if (query.statusId) where.statusId = query.statusId;
    if (query.careTypeId) where.careTypeId = query.careTypeId;
    if (query.fundingTypeId) where.fundingTypeId = query.fundingTypeId;
    if (query.riskLevelId) where.riskLevelId = query.riskLevelId;

    const scopedLocationIds = actor
      ? this.orgScope.resolveListLocationIds(
          this.orgScope.fromRequestUser(actor),
          query.locationId,
          query.locationIds,
        )
      : query.locationIds?.length
        ? query.locationIds
        : query.locationId
          ? [query.locationId]
          : undefined;

    if (scopedLocationIds && scopedLocationIds.length === 0) {
      return {
        data: [],
        meta: buildPaginationMeta({ page, limit, total: 0 }),
      };
    }

    if (scopedLocationIds?.length === 1) {
      const locationId = scopedLocationIds[0]!;
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { locationId },
            { assignments: { some: { deletedAt: null, locationId } } },
          ],
        },
      ];
    } else if (scopedLocationIds && scopedLocationIds.length > 1) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { locationId: { in: scopedLocationIds } },
            {
              assignments: {
                some: { deletedAt: null, locationId: { in: scopedLocationIds } },
              },
            },
          ],
        },
      ];
    }
    if (query.keyWorkerId) where.keyWorkerId = query.keyWorkerId;
    if (query.namedNurseId) where.namedNurseId = query.namedNurseId;
    if (query.unassignedKeyWorker === true) where.keyWorkerId = null;

    mergeDateOfBirthFilter(where, {
      dateOfBirthFrom: query.dateOfBirthFrom,
      dateOfBirthTo: query.dateOfBirthTo,
      ageMin: query.ageMin,
      ageMax: query.ageMax,
    });

    if (query.serviceStartDateFrom || query.serviceStartDateTo) {
      where.serviceStartDate = {};
      if (query.serviceStartDateFrom) where.serviceStartDate.gte = new Date(query.serviceStartDateFrom);
      if (query.serviceStartDateTo) where.serviceStartDate.lte = new Date(query.serviceStartDateTo);
    }

    if (query.dateOfDeathFrom || query.dateOfDeathTo) {
      where.dateOfDeath = {};
      if (query.dateOfDeathFrom) {
        const from = new Date(query.dateOfDeathFrom);
        if (!query.dateOfDeathFrom.includes('T')) from.setUTCHours(0, 0, 0, 0);
        where.dateOfDeath.gte = from;
      }
      if (query.dateOfDeathTo) {
        const to = new Date(query.dateOfDeathTo);
        if (!query.dateOfDeathTo.includes('T')) to.setUTCHours(23, 59, 59, 999);
        where.dateOfDeath.lte = to;
      }
    }

    if (query.hasActiveFlashMessage === true) {
      appendWhereAnd(where, activeFlashMessageListWhere());
    }
    if (query.hospitalisedOnly === true) {
      appendWhereAnd(where, hospitalisedListWhere());
    }
    if (query.carePlanListStatus) {
      appendWhereAnd(where, carePlanListStatusWhere(query.carePlanListStatus));
    }
    if (query.carePlanFormIds?.length) {
      appendWhereAnd(where, carePlanFormIdsWhere(query.carePlanFormIds));
    }
    const medicalConditionIds = [
      ...new Set(
        [...(query.medicalConditionIds ?? []), query.medicalConditionId]
          .map((id) => id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (medicalConditionIds.length) {
      appendWhereAnd(where, activeMedicalConditionListWhere(medicalConditionIds));
    }
    if (query.initialAssessmentStatus) {
      appendWhereAnd(where, initialAssessmentStatusWhere(query.initialAssessmentStatus));
    }
    if (query.loneWorkerRisk === true) {
      appendWhereAnd(where, openLoneWorkerRiskWhere());
    }

    const idIntersections: string[][] = [];

    if (query.missedVisitsMin != null && query.missedVisitsMin >= 0) {
      const missedIds = await findServiceUserIdsWithConfirmedMissedVisitsAtLeast(
        this.prisma,
        query.missedVisitsMin,
        {
          from: query.missedVisitsFrom ? new Date(query.missedVisitsFrom) : undefined,
          to: query.missedVisitsTo ? new Date(query.missedVisitsTo) : undefined,
        },
      );
      idIntersections.push(missedIds);
    }

    const behaviourKeys: string[] = [];
    if (query.verbalAltercation === true) {
      behaviourKeys.push(BEHAVIOUR_INCIDENT_SUBTYPE_KEYS.verbal);
    }
    if (query.physicalAltercation === true) {
      behaviourKeys.push(BEHAVIOUR_INCIDENT_SUBTYPE_KEYS.physical);
    }
    if (behaviourKeys.length > 0) {
      idIntersections.push(await findServiceUserIdsWithBehaviourIncident(this.prisma, behaviourKeys));
    }

    const safeguardingSubtypeKeys: string[] = [];
    if (query.physicalAbuseToSu === true) {
      safeguardingSubtypeKeys.push(SAFEGUARDING_INCIDENT_SUBTYPE_KEYS.physicalAbuse);
    }
    if (query.domesticViolence === true) {
      safeguardingSubtypeKeys.push(SAFEGUARDING_INCIDENT_SUBTYPE_KEYS.domesticAbuse);
    }
    if (safeguardingSubtypeKeys.length > 0 || query.safeguardingHistory === true) {
      idIntersections.push(
        await findServiceUserIdsWithSafeguardingIncidents(this.prisma, {
          subtypeKeys: safeguardingSubtypeKeys,
          anySafeguardingCategory: query.safeguardingHistory === true,
        }),
      );
    }

    if (idIntersections.length > 0) {
      let intersected = idIntersections[0] ?? [];
      for (let i = 1; i < idIntersections.length; i++) {
        const set = new Set(idIntersections[i]);
        intersected = intersected.filter((id) => set.has(id));
      }
      if (intersected.length === 0) {
        return {
          data: [],
          meta: buildPaginationMeta({ page, limit, total: 0 }),
        };
      }
      appendWhereAnd(where, { id: { in: intersected } });
    }

    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { preferredName: { contains: s, mode: 'insensitive' } },
        { serviceUserNumber: { contains: s, mode: 'insensitive' } },
        { nhsNumber: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { mobile: { contains: s, mode: 'insensitive' } },
      ];
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.ServiceUserOrderByWithRelationInput = { [sortBy]: sortOrder };

    const scheduleAreaByLocation = await loadScheduleAreaByLocationMap(this.prisma);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.serviceUser.count({ where }),
      this.prisma.serviceUser.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          title: true,
          gender: true,
          maritalStatus: true,
          status: true,
          careType: true,
          fundingType: true,
          riskLevel: true,
          location: true,
          keyWorker: { include: { personalDetail: true } },
          namedNurse: { include: { personalDetail: true } },
          assignments: {
            where: { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            include: { location: true },
          },
          absences: {
            where: activeServiceUserAbsenceWhere(),
            take: 1,
            select: { id: true },
          },
          flashMessages: {
            where: activeServiceUserFlashMessageWhere(),
            take: 1,
            select: { id: true },
          },
        },
      }),
    ]);

    const pageIds = rows.map((row) => row.id);
    const creatorIds = [
      ...new Set(rows.map((row) => row.createdById).filter((id): id is string => Boolean(id))),
    ];
    const [publishedCarePlans, creators] = await Promise.all([
      pageIds.length === 0
        ? Promise.resolve([])
        : this.prisma.serviceUserCarePlanInstance.findMany({
            where: {
              serviceUserId: { in: pageIds },
              status: ServiceUserCarePlanInstanceStatus.PUBLISHED,
            },
            select: { serviceUserId: true, nextReviewDueAt: true },
          }),
      creatorIds.length === 0
        ? Promise.resolve([])
        : this.prisma.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, firstName: true, lastName: true, email: true, username: true },
          }),
    ]);
    const carePlanListStatusByUserId = carePlanListStatusByServiceUser(pageIds, publishedCarePlans);
    const creatorNameById = new Map(
      creators.map((u) => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        return [u.id, name || u.email || u.username || null] as const;
      }),
    );

    return {
      data: rows.map((row) =>
        mapServiceUserListRow(row, scheduleAreaByLocation, {
          carePlanListStatus: carePlanListStatusByUserId.get(row.id) ?? 'none',
          createdByName: row.createdById ? creatorNameById.get(row.createdById) ?? null : null,
        }),
      ),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string, audit?: ServiceUserAuditMeta, actor?: RequestUser) {
    if (actor) {
      await this.orgScope.assertServiceUserInScope(this.orgScope.fromRequestUser(actor), id);
    }

    const actorId = audit?.actorUserId;
    if (actorId) {
      await this.reconcileServiceUserBranchLinks(id, actorId);
    }

    const scheduleAreaByLocation = await loadScheduleAreaByLocationMap(this.prisma);
    const user = await this.prisma.serviceUser.findFirst({
      where: { id, deletedAt: null },
      include: detailInclude,
    });
    if (!user) throw new NotFoundException('Service user not found');

    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.SERVICE_USER,
        recordType: 'ServiceUser',
        recordId: id,
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { route: 'service_users.detail', serviceUserId: id },
      });
      await this.audit.logAudit({
        userId: audit.actorUserId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_PROFILE_VIEWED,
        recordType: 'ServiceUser',
        recordId: id,
        metadata: { route: 'service_users.detail', serviceUserId: id },
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
      });
    }

    return { data: mapServiceUserDetail(user, scheduleAreaByLocation) };
  }

  async create(userId: string, dto: CreateServiceUserDto, meta?: RequestAuditMeta) {
    const fromArea = await this.resolveLocationFromServiceUserArea(dto.serviceUserAreaId);
    const locationId = fromArea?.locationId ?? dto.locationId;
    const serviceUserAreaId = fromArea?.serviceUserAreaId ?? null;
    await this.validateAssignments({
      keyWorkerId: dto.keyWorkerId,
      namedNurseId: dto.namedNurseId,
      locationId,
    });
    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.ServiceUserCreateInput = {
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName,
        preferredName: dto.preferredName,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        email: dto.email,
        phone: dto.phone,
        mobile: dto.mobile,
        nhsNumber: dto.nhsNumber,
        socialServicesRef: dto.socialServicesRef,
        nationalInsuranceNumber: dto.nationalInsuranceNumber,
        serviceStartDate: dto.serviceStartDate ? new Date(dto.serviceStartDate) : undefined,
        serviceEndDate: dto.serviceEndDate ? new Date(dto.serviceEndDate) : undefined,
        serviceUserNumber: dto.serviceUserNumber,
        residentId: dto.residentId,
        residentGuid: dto.residentGuid,
        notes: dto.notes,
        createdById: userId,
        title: dto.titleId ? { connect: { id: dto.titleId } } : undefined,
        gender: dto.genderId ? { connect: { id: dto.genderId } } : undefined,
        maritalStatus: dto.maritalStatusId ? { connect: { id: dto.maritalStatusId } } : undefined,
        status: dto.statusId ? { connect: { id: dto.statusId } } : undefined,
        careType: dto.careTypeId ? { connect: { id: dto.careTypeId } } : undefined,
        fundingType: dto.fundingTypeId ? { connect: { id: dto.fundingTypeId } } : undefined,
        riskLevel: dto.riskLevelId ? { connect: { id: dto.riskLevelId } } : undefined,
        location: locationId ? { connect: { id: locationId } } : undefined,
        serviceUserArea: serviceUserAreaId
          ? { connect: { id: serviceUserAreaId } }
          : undefined,
        keyWorker: dto.keyWorkerId ? { connect: { id: dto.keyWorkerId } } : undefined,
        namedNurse: dto.namedNurseId ? { connect: { id: dto.namedNurseId } } : undefined,
        invoiceBillingFrequency: dto.invoiceBillingFrequency,
      };

      const created = await tx.serviceUser.create({ data });

      if (dto.references?.length) {
        for (const r of dto.references) {
          await tx.serviceUserReference.create({
            data: {
              serviceUserId: created.id,
              referenceType: r.referenceType,
              referenceValue: r.referenceValue,
              notes: r.notes,
            },
          });
        }
      }

      if (dto.keyWorkerId || dto.namedNurseId || locationId) {
        await tx.serviceUserAssignment.create({
          data: {
            serviceUserId: created.id,
            keyWorkerId: dto.keyWorkerId ?? null,
            namedNurseId: dto.namedNurseId ?? null,
            locationId: locationId ?? null,
            createdById: userId,
          },
        });
      }

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CREATED,
        recordType: 'ServiceUser',
        recordId: created.id,
        newValues: auditSnapshot({
          id: created.id,
          firstName: created.firstName,
          lastName: created.lastName,
          statusId: created.statusId,
          keyWorkerId: created.keyWorkerId,
          namedNurseId: created.namedNurseId,
          locationId: created.locationId,
          serviceUserAreaId: created.serviceUserAreaId,
        }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Service user created', data: { id: created.id } };
    });
  }

  private async syncReferences(
    tx: Prisma.TransactionClient,
    serviceUserId: string,
    references: ServiceUserReferenceItemDto[] | undefined,
  ) {
    if (references === undefined) return;
    const existing = await tx.serviceUserReference.findMany({
      where: { serviceUserId, deletedAt: null },
    });
    const keepIds = new Set(references.map((r) => r.id).filter(Boolean) as string[]);
    for (const e of existing) {
      if (!keepIds.has(e.id)) {
        await tx.serviceUserReference.update({
          where: { id: e.id },
          data: { deletedAt: new Date() },
        });
      }
    }
    for (const r of references) {
      if (r.id) {
        const existingRef = await tx.serviceUserReference.findFirst({
          where: { id: r.id, serviceUserId, deletedAt: null },
        });
        if (!existingRef) continue;
        await tx.serviceUserReference.update({
          where: { id: r.id },
          data: {
            referenceType: r.referenceType,
            referenceValue: r.referenceValue,
            notes: r.notes,
          },
        });
      } else {
        await tx.serviceUserReference.create({
          data: {
            serviceUserId,
            referenceType: r.referenceType,
            referenceValue: r.referenceValue,
            notes: r.notes,
          },
        });
      }
    }

    const deathRef = references.find(
      (r) => r.referenceType === SU_PROFILE_DATE_OF_DEATH_REF,
    );
    if (deathRef !== undefined) {
      await tx.serviceUser.update({
        where: { id: serviceUserId },
        data: { dateOfDeath: parseServiceUserDateOfDeath(deathRef.referenceValue) },
      });
    }
  }

  async update(userId: string, id: string, dto: UpdateServiceUserDto, meta?: RequestAuditMeta) {
    await this.ensureExists(id);
    const areaFieldProvided = dto.serviceUserAreaId !== undefined;
    const fromArea = areaFieldProvided
      ? await this.resolveLocationFromServiceUserArea(dto.serviceUserAreaId)
      : null;
    const resolvedLocationId = fromArea
      ? fromArea.locationId
      : dto.locationId !== undefined
        ? dto.locationId
        : undefined;
    await this.validateAssignments({
      keyWorkerId: dto.keyWorkerId,
      namedNurseId: dto.namedNurseId,
      locationId: resolvedLocationId,
    });
    return this.prisma.$transaction(async (tx) => {
      if (dto.defaultChargeCardId !== undefined) {
        await assertDefaultChargeCard(tx, dto.defaultChargeCardId);
      }
      const before = await tx.serviceUser.findFirst({
        where: { id, deletedAt: null },
        include: { references: { where: { deletedAt: null } } },
      });

      const data: Prisma.ServiceUserUpdateInput = {
        updatedById: userId,
      };
      if (dto.firstName !== undefined) data.firstName = dto.firstName;
      if (dto.lastName !== undefined) data.lastName = dto.lastName;
      if (dto.middleName !== undefined) data.middleName = dto.middleName;
      if (dto.preferredName !== undefined) data.preferredName = dto.preferredName;
      if (dto.dateOfBirth !== undefined) data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
      if (dto.email !== undefined) data.email = dto.email;
      if (dto.phone !== undefined) data.phone = dto.phone;
      if (dto.mobile !== undefined) data.mobile = dto.mobile;
      if (dto.nhsNumber !== undefined) data.nhsNumber = dto.nhsNumber;
      if (dto.socialServicesRef !== undefined) data.socialServicesRef = dto.socialServicesRef;
      if (dto.nationalInsuranceNumber !== undefined) data.nationalInsuranceNumber = dto.nationalInsuranceNumber;
      if (dto.serviceStartDate !== undefined)
        data.serviceStartDate = dto.serviceStartDate ? new Date(dto.serviceStartDate) : null;
      if (dto.serviceEndDate !== undefined)
        data.serviceEndDate = dto.serviceEndDate ? new Date(dto.serviceEndDate) : null;
      if (dto.serviceUserNumber !== undefined) data.serviceUserNumber = dto.serviceUserNumber;
      if (dto.residentId !== undefined) data.residentId = dto.residentId;
      if (dto.residentGuid !== undefined) data.residentGuid = dto.residentGuid;
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.titleId !== undefined) data.title = dto.titleId ? { connect: { id: dto.titleId } } : { disconnect: true };
      if (dto.genderId !== undefined) data.gender = dto.genderId ? { connect: { id: dto.genderId } } : { disconnect: true };
      if (dto.maritalStatusId !== undefined)
        data.maritalStatus = dto.maritalStatusId ? { connect: { id: dto.maritalStatusId } } : { disconnect: true };
      if (dto.statusId !== undefined) data.status = dto.statusId ? { connect: { id: dto.statusId } } : { disconnect: true };
      if (dto.careTypeId !== undefined) data.careType = dto.careTypeId ? { connect: { id: dto.careTypeId } } : { disconnect: true };
      if (dto.fundingTypeId !== undefined)
        data.fundingType = dto.fundingTypeId ? { connect: { id: dto.fundingTypeId } } : { disconnect: true };
      if (dto.riskLevelId !== undefined)
        data.riskLevel = dto.riskLevelId ? { connect: { id: dto.riskLevelId } } : { disconnect: true };
      if (areaFieldProvided) {
        data.serviceUserArea = fromArea
          ? { connect: { id: fromArea.serviceUserAreaId } }
          : { disconnect: true };
        data.location = fromArea
          ? { connect: { id: fromArea.locationId } }
          : dto.locationId
            ? { connect: { id: dto.locationId } }
            : { disconnect: true };
      } else if (dto.locationId !== undefined) {
        data.location = dto.locationId ? { connect: { id: dto.locationId } } : { disconnect: true };
      }
      if (dto.keyWorkerId !== undefined)
        data.keyWorker = dto.keyWorkerId ? { connect: { id: dto.keyWorkerId } } : { disconnect: true };
      if (dto.namedNurseId !== undefined)
        data.namedNurse = dto.namedNurseId ? { connect: { id: dto.namedNurseId } } : { disconnect: true };
      if (dto.defaultChargeCardId !== undefined) {
        data.defaultChargeCard = dto.defaultChargeCardId
          ? { connect: { id: dto.defaultChargeCardId } }
          : { disconnect: true };
      }
      if (dto.invoiceBillingFrequency !== undefined) {
        data.invoiceBillingFrequency = dto.invoiceBillingFrequency;
      }

      const updated = await tx.serviceUser.update({ where: { id }, data });

      await this.syncReferences(tx, id, dto.references);

      const assignmentTouch =
        dto.keyWorkerId !== undefined ||
        dto.namedNurseId !== undefined ||
        dto.locationId !== undefined ||
        areaFieldProvided;
      if (assignmentTouch) {
        const current = await tx.serviceUserAssignment.findFirst({
          where: { serviceUserId: id, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        });
        if (current) {
          await tx.serviceUserAssignment.update({
            where: { id: current.id },
            data: {
              keyWorkerId: dto.keyWorkerId !== undefined ? dto.keyWorkerId : current.keyWorkerId,
              namedNurseId: dto.namedNurseId !== undefined ? dto.namedNurseId : current.namedNurseId,
              locationId:
                resolvedLocationId !== undefined ? resolvedLocationId : current.locationId,
              updatedById: userId,
            },
          });
        } else if (updated.keyWorkerId || updated.namedNurseId || updated.locationId) {
          await tx.serviceUserAssignment.create({
            data: {
              serviceUserId: id,
              keyWorkerId: updated.keyWorkerId,
              namedNurseId: updated.namedNurseId,
              locationId: updated.locationId,
              createdById: userId,
            },
          });
        }
      }

      await this.reconcileServiceUserBranchLinks(id, userId, tx);

      const oldS = auditSnapshot(before);
      const newS = auditSnapshot(
        await tx.serviceUser.findFirst({
          where: { id },
          include: { references: { where: { deletedAt: null } } },
        }),
      );
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_UPDATED,
        recordType: 'ServiceUser',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Service user updated', data: { id: updated.id } };
    });
  }

  async softDelete(userId: string, id: string, meta?: RequestAuditMeta) {
    await this.ensureExists(id);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUser.findFirst({
        where: { id, deletedAt: null },
        include: {
          contacts: { where: { deletedAt: null } },
          address: true,
          references: { where: { deletedAt: null } },
          assignments: { where: { deletedAt: null } },
          photos: { where: { deletedAt: null } },
        },
      });

      await tx.serviceUserContact.updateMany({
        where: { serviceUserId: id, deletedAt: null },
        data: { deletedAt: now, deletedById: userId },
      });
      await tx.serviceUserAddress.updateMany({
        where: { serviceUserId: id, deletedAt: null },
        data: { deletedAt: now, deletedById: userId },
      });
      await tx.serviceUserReference.updateMany({
        where: { serviceUserId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.serviceUserAssignment.updateMany({
        where: { serviceUserId: id, deletedAt: null },
        data: { deletedAt: now, deletedById: userId },
      });
      await tx.serviceUserPhoto.updateMany({
        where: { serviceUserId: id, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.serviceUser.update({
        where: { id },
        data: { currentFundingId: null },
      });
      await tx.serviceUserFunding.updateMany({
        where: { serviceUserId: id, deletedAt: null },
        data: {
          deletedAt: now,
          deletedById: userId,
          isActive: false,
          isPrimary: false,
          updatedById: userId,
        },
      });

      const liveInProfile = await tx.serviceUserLiveInProfile.findFirst({
        where: { serviceUserId: id, deletedAt: null },
      });
      if (liveInProfile) {
        await tx.serviceUserLiveInPreferredCarer.deleteMany({ where: { liveInProfileId: liveInProfile.id } });
        await tx.serviceUserLiveInBlockedCarer.deleteMany({ where: { liveInProfileId: liveInProfile.id } });
        await tx.serviceUserLiveInContractDocument.updateMany({
          where: { liveInProfileId: liveInProfile.id, deletedAt: null },
          data: { deletedAt: now, isActive: false },
        });
        await tx.serviceUserLiveInProfile.update({
          where: { id: liveInProfile.id },
          data: { deletedAt: now, deletedById: userId, isActive: false, updatedById: userId },
        });
      }

      await tx.serviceUser.update({
        where: { id },
        data: { deletedAt: now, deletedById: userId, isActive: false },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DELETED,
        recordType: 'ServiceUser',
        recordId: id,
        oldValues: auditSnapshot(before),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Service user deleted', data: {} };
    });
  }

  async updateStatus(userId: string, id: string, dto: UpdateServiceUserStatusDto, meta?: RequestAuditMeta) {
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUser.findFirst({ where: { id, deletedAt: null } });
      await tx.serviceUser.update({
        where: { id },
        data: {
          statusId: dto.statusId,
          updatedById: userId,
        },
      });
      const after = await tx.serviceUser.findFirst({ where: { id, deletedAt: null } });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_STATUS_CHANGED,
        recordType: 'ServiceUser',
        recordId: id,
        oldValues: auditSnapshot({ statusId: before?.statusId }),
        newValues: auditSnapshot({ statusId: after?.statusId }),
        metadata: dto.reason ? { reason: dto.reason } : undefined,
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Status updated', data: { id } };
    });
  }

  private async ensureExists(id: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  async patchFundingRefs(
    userId: string,
    serviceUserId: string,
    dto: PatchServiceUserFundingRefsDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureExists(serviceUserId);
    if (dto.socialServicesRef === undefined && dto.nhsNumber === undefined) {
      throw new BadRequestException('Provide socialServicesRef and/or nhsNumber to update');
    }
    const before = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { nhsNumber: true, socialServicesRef: true },
    });
    const updated = await this.prisma.serviceUser.update({
      where: { id: serviceUserId },
      data: {
        updatedById: userId,
        ...(dto.socialServicesRef !== undefined ? { socialServicesRef: dto.socialServicesRef } : {}),
        ...(dto.nhsNumber !== undefined ? { nhsNumber: dto.nhsNumber } : {}),
      },
      select: { nhsNumber: true, socialServicesRef: true },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_FUNDING_REFS_UPDATED,
      recordType: 'ServiceUser',
      recordId: serviceUserId,
      oldValues: auditSnapshot(before),
      newValues: auditSnapshot(updated),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Funding references updated', data: updated };
  }
}
