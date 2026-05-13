import type { Prisma } from '@prisma/client';
import { DataAccessType, FundingBillingType, FundingFunderKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateServiceUserDto } from './dto/create-service-user.dto';
import { UpdateServiceUserDto } from './dto/update-service-user.dto';
import { ServiceUserQueryDto } from './dto/service-user-query.dto';
import { UpdateServiceUserStatusDto } from './dto/update-service-user-status.dto';
import type { ServiceUserReferenceItemDto } from './dto/service-user-reference-item.dto';
import { PatchServiceUserFundingRefsDto } from './dto/patch-service-user-funding-refs.dto';
import { CreateServiceUserFundingProfileDto } from './dto/create-service-user-funding-profile.dto';
import { UpdateServiceUserFundingProfileDto } from './dto/update-service-user-funding-profile.dto';
import { CreateCustomRateCardDto } from './dto/create-custom-rate-card.dto';
import { mapServiceUserDetail, mapServiceUserListRow } from './mappers/service-user.mapper';

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
    where: { deletedAt: null, isProfilePhoto: true },
    orderBy: { uploadedAt: 'desc' as const },
    take: 1,
  },
  keyWorker: { include: { personalDetail: true } },
  namedNurse: { include: { personalDetail: true } },
} satisfies Prisma.ServiceUserInclude;

@Injectable()
export class ServiceUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
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

  async validateAssignments(dto: {
    keyWorkerId?: string | null;
    namedNurseId?: string | null;
    locationId?: string | null;
  }) {
    await this.ensureActiveEmployee(dto.keyWorkerId);
    await this.ensureActiveEmployee(dto.namedNurseId);
    await this.ensureActiveLocation(dto.locationId);
  }

  async list(query: ServiceUserQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ServiceUserWhereInput = {
      deletedAt: null,
    };
    if (!query.showInactive) {
      where.isActive = true;
    }
    if (query.statusId) where.statusId = query.statusId;
    if (query.careTypeId) where.careTypeId = query.careTypeId;
    if (query.fundingTypeId) where.fundingTypeId = query.fundingTypeId;
    if (query.riskLevelId) where.riskLevelId = query.riskLevelId;
    if (query.locationId) where.locationId = query.locationId;
    if (query.keyWorkerId) where.keyWorkerId = query.keyWorkerId;
    if (query.namedNurseId) where.namedNurseId = query.namedNurseId;
    if (query.dateOfBirthFrom || query.dateOfBirthTo) {
      where.dateOfBirth = {};
      if (query.dateOfBirthFrom) where.dateOfBirth.gte = new Date(query.dateOfBirthFrom);
      if (query.dateOfBirthTo) where.dateOfBirth.lte = new Date(query.dateOfBirthTo);
    }
    if (query.serviceStartDateFrom || query.serviceStartDateTo) {
      where.serviceStartDate = {};
      if (query.serviceStartDateFrom) where.serviceStartDate.gte = new Date(query.serviceStartDateFrom);
      if (query.serviceStartDateTo) where.serviceStartDate.lte = new Date(query.serviceStartDateTo);
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
        },
      }),
    ]);

    return {
      data: rows.map(mapServiceUserListRow),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string, audit?: ServiceUserAuditMeta) {
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
        metadata: { route: 'service_users.detail' },
      });
      await this.audit.logAudit({
        userId: audit.actorUserId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_PROFILE_VIEWED,
        recordType: 'ServiceUser',
        recordId: id,
        metadata: { route: 'service_users.detail' },
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
      });
    }

    return { data: mapServiceUserDetail(user) };
  }

  async create(userId: string, dto: CreateServiceUserDto, meta?: RequestAuditMeta) {
    await this.validateAssignments(dto);
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
        location: dto.locationId ? { connect: { id: dto.locationId } } : undefined,
        keyWorker: dto.keyWorkerId ? { connect: { id: dto.keyWorkerId } } : undefined,
        namedNurse: dto.namedNurseId ? { connect: { id: dto.namedNurseId } } : undefined,
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

      if (dto.keyWorkerId || dto.namedNurseId || dto.locationId) {
        await tx.serviceUserAssignment.create({
          data: {
            serviceUserId: created.id,
            keyWorkerId: dto.keyWorkerId ?? null,
            namedNurseId: dto.namedNurseId ?? null,
            locationId: dto.locationId ?? null,
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
  }

  async update(userId: string, id: string, dto: UpdateServiceUserDto, meta?: RequestAuditMeta) {
    await this.ensureExists(id);
    await this.validateAssignments({
      keyWorkerId: dto.keyWorkerId,
      namedNurseId: dto.namedNurseId,
      locationId: dto.locationId,
    });
    return this.prisma.$transaction(async (tx) => {
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
      if (dto.locationId !== undefined)
        data.location = dto.locationId ? { connect: { id: dto.locationId } } : { disconnect: true };
      if (dto.keyWorkerId !== undefined)
        data.keyWorker = dto.keyWorkerId ? { connect: { id: dto.keyWorkerId } } : { disconnect: true };
      if (dto.namedNurseId !== undefined)
        data.namedNurse = dto.namedNurseId ? { connect: { id: dto.namedNurseId } } : { disconnect: true };

      const updated = await tx.serviceUser.update({ where: { id }, data });

      await this.syncReferences(tx, id, dto.references);

      const assignmentTouch =
        dto.keyWorkerId !== undefined || dto.namedNurseId !== undefined || dto.locationId !== undefined;
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
              locationId: dto.locationId !== undefined ? dto.locationId : current.locationId,
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

  private mapFundingProfile(p: {
    id: string;
    billingType: FundingBillingType;
    funder1Kind: FundingFunderKind;
    funder1ContactId: string | null;
    funder1ExternalName: string | null;
    invoiceMileage: boolean;
    sortOrder: number;
    careService: { id: string; name: string; code: string };
    rateCard: { id: string; name: string; code: string | null; isCustom: boolean };
    funder1Contact: { id: string; firstName: string; lastName: string | null } | null;
  }) {
    return {
      id: p.id,
      billingType: p.billingType,
      funder1Kind: p.funder1Kind,
      funder1ContactId: p.funder1ContactId,
      funder1ExternalName: p.funder1ExternalName,
      invoiceMileage: p.invoiceMileage,
      sortOrder: p.sortOrder,
      careService: { id: p.careService.id, name: p.careService.name, code: p.careService.code },
      rateCard: {
        id: p.rateCard.id,
        name: p.rateCard.name,
        code: p.rateCard.code,
        isCustom: p.rateCard.isCustom,
      },
      funder1Contact: p.funder1Contact
        ? {
            id: p.funder1Contact.id,
            firstName: p.funder1Contact.firstName,
            lastName: p.funder1Contact.lastName,
          }
        : null,
    };
  }

  private assertFundingFunderFields(
    kind: FundingFunderKind,
    contactId: string | null | undefined,
    externalName: string | null | undefined,
  ) {
    if (kind === 'SERVICE_USER') {
      if (contactId) throw new BadRequestException('funder1ContactId must be empty when funder1Kind is SERVICE_USER');
      if (externalName?.trim())
        throw new BadRequestException('funder1ExternalName must be empty when funder1Kind is SERVICE_USER');
      return;
    }
    if (kind === 'CONTACT') {
      if (!contactId) throw new BadRequestException('funder1ContactId is required when funder1Kind is CONTACT');
      if (externalName?.trim())
        throw new BadRequestException('funder1ExternalName must be empty when funder1Kind is CONTACT');
      return;
    }
    if (kind === 'EXTERNAL_FUNDER') {
      const n = externalName?.trim();
      if (!n) throw new BadRequestException('funder1ExternalName is required when funder1Kind is EXTERNAL_FUNDER');
      if (contactId) throw new BadRequestException('funder1ContactId must be empty when funder1Kind is EXTERNAL_FUNDER');
    }
  }

  private async assertRateCardForServiceUser(serviceUserId: string, rateCardId: string) {
    const globalRc = await this.prisma.rateCard.findFirst({
      where: { id: rateCardId, isActive: true, serviceUserId: null },
    });
    const customRc = await this.prisma.rateCard.findFirst({
      where: { id: rateCardId, isActive: true, serviceUserId },
    });
    if (!globalRc && !customRc) throw new BadRequestException('Invalid or inactive rate card for this service user');
  }

  async getFundingLookups(serviceUserId: string) {
    await this.ensureExists(serviceUserId);
    const [careServices, globalRateCards, customRateCards] = await Promise.all([
      this.prisma.fundingCareService.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, code: true },
      }),
      this.prisma.rateCard.findMany({
        where: { isActive: true, serviceUserId: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, code: true, isCustom: true, serviceUserId: true, sortOrder: true },
      }),
      this.prisma.rateCard.findMany({
        where: { isActive: true, serviceUserId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, code: true, isCustom: true, serviceUserId: true, sortOrder: true },
      }),
    ]);
    const rateCardKey = (r: { id: string }) => r.id;
    const merged = new Map<string, (typeof globalRateCards)[0]>();
    for (const r of globalRateCards) merged.set(rateCardKey(r), r);
    for (const r of customRateCards) merged.set(rateCardKey(r), r);
    const rateCards = Array.from(merged.values()).sort((a, b) => {
      const so = a.sortOrder - b.sortOrder;
      if (so !== 0) return so;
      return a.name.localeCompare(b.name);
    });
    return {
      data: {
        careServices,
        rateCards,
      },
    };
  }

  async getFunding(serviceUserId: string) {
    await this.ensureExists(serviceUserId);
    const user = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { nhsNumber: true, socialServicesRef: true },
    });
    const profiles = await this.prisma.serviceUserFundingProfile.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        careService: true,
        rateCard: true,
        funder1Contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return {
      data: {
        nhsNumber: user?.nhsNumber ?? null,
        socialServicesRef: user?.socialServicesRef ?? null,
        profiles: profiles.map((p) => this.mapFundingProfile(p)),
      },
    };
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

  async createFundingProfile(
    userId: string,
    serviceUserId: string,
    dto: CreateServiceUserFundingProfileDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureExists(serviceUserId);
    const care = await this.prisma.fundingCareService.findFirst({
      where: { id: dto.careServiceId, isActive: true },
    });
    if (!care) throw new BadRequestException('Invalid or inactive care service');
    await this.assertRateCardForServiceUser(serviceUserId, dto.rateCardId);
    this.assertFundingFunderFields(dto.funder1Kind, dto.funder1ContactId, dto.funder1ExternalName);
    if (dto.funder1Kind === 'CONTACT' && dto.funder1ContactId) {
      const c = await this.prisma.serviceUserContact.findFirst({
        where: { id: dto.funder1ContactId, serviceUserId, deletedAt: null },
      });
      if (!c) throw new BadRequestException('Contact does not belong to this service user');
    }
    const maxSort = await this.prisma.serviceUserFundingProfile.aggregate({
      where: { serviceUserId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    const row = await this.prisma.serviceUserFundingProfile.create({
      data: {
        serviceUserId,
        careServiceId: dto.careServiceId,
        billingType: dto.billingType,
        funder1Kind: dto.funder1Kind,
        funder1ContactId: dto.funder1Kind === 'CONTACT' ? dto.funder1ContactId : null,
        funder1ExternalName:
          dto.funder1Kind === 'EXTERNAL_FUNDER' ? (dto.funder1ExternalName ?? '').trim() || null : null,
        rateCardId: dto.rateCardId,
        invoiceMileage: dto.invoiceMileage ?? false,
        sortOrder,
        createdById: userId,
        updatedById: userId,
      },
      include: {
        careService: true,
        rateCard: true,
        funder1Contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_FUNDING_PROFILE_ADDED,
      recordType: 'ServiceUserFundingProfile',
      recordId: row.id,
      newValues: auditSnapshot(row),
      metadata: { serviceUserId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { data: this.mapFundingProfile(row) };
  }

  async updateFundingProfile(
    userId: string,
    serviceUserId: string,
    profileId: string,
    dto: UpdateServiceUserFundingProfileDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.serviceUserFundingProfile.findFirst({
      where: { id: profileId, serviceUserId, deletedAt: null },
      include: {
        careService: true,
        rateCard: true,
        funder1Contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!existing) throw new NotFoundException('Funding profile not found');
    const careServiceId = dto.careServiceId ?? existing.careServiceId;
    if (dto.careServiceId) {
      const care = await this.prisma.fundingCareService.findFirst({
        where: { id: careServiceId, isActive: true },
      });
      if (!care) throw new BadRequestException('Invalid or inactive care service');
    }
    const rateCardId = dto.rateCardId ?? existing.rateCardId;
    if (dto.rateCardId) {
      await this.assertRateCardForServiceUser(serviceUserId, rateCardId);
    }
    const billingType = dto.billingType ?? existing.billingType;
    const funder1Kind = dto.funder1Kind ?? existing.funder1Kind;
    let funder1ContactId = dto.funder1ContactId !== undefined ? dto.funder1ContactId : existing.funder1ContactId;
    let funder1ExternalName = dto.funder1ExternalName !== undefined ? dto.funder1ExternalName : existing.funder1ExternalName;
    if (dto.funder1Kind !== undefined) {
      if (funder1Kind !== 'CONTACT') funder1ContactId = null;
      if (funder1Kind !== 'EXTERNAL_FUNDER') funder1ExternalName = null;
    }
    this.assertFundingFunderFields(funder1Kind, funder1ContactId, funder1ExternalName);
    if (funder1Kind === 'CONTACT' && funder1ContactId) {
      const c = await this.prisma.serviceUserContact.findFirst({
        where: { id: funder1ContactId, serviceUserId, deletedAt: null },
      });
      if (!c) throw new BadRequestException('Contact does not belong to this service user');
    }
    const invoiceMileage = dto.invoiceMileage ?? existing.invoiceMileage;
    const row = await this.prisma.serviceUserFundingProfile.update({
      where: { id: profileId },
      data: {
        careServiceId,
        billingType,
        funder1Kind,
        funder1ContactId: funder1Kind === 'CONTACT' ? funder1ContactId : null,
        funder1ExternalName:
          funder1Kind === 'EXTERNAL_FUNDER' ? (funder1ExternalName ?? '').trim() || null : null,
        rateCardId,
        invoiceMileage,
        updatedById: userId,
      },
      include: {
        careService: true,
        rateCard: true,
        funder1Contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_FUNDING_PROFILE_UPDATED,
      recordType: 'ServiceUserFundingProfile',
      recordId: profileId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { data: this.mapFundingProfile(row) };
  }

  async deleteFundingProfile(userId: string, serviceUserId: string, profileId: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.serviceUserFundingProfile.findFirst({
      where: { id: profileId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Funding profile not found');
    await this.prisma.serviceUserFundingProfile.update({
      where: { id: profileId },
      data: { deletedAt: new Date(), deletedById: userId, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_FUNDING_PROFILE_DELETED,
      recordType: 'ServiceUserFundingProfile',
      recordId: profileId,
      oldValues: auditSnapshot(existing),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Funding profile deleted', data: {} };
  }

  async createCustomRateCard(
    userId: string,
    serviceUserId: string,
    dto: CreateCustomRateCardDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureExists(serviceUserId);
    const care = await this.prisma.fundingCareService.findFirst({
      where: { id: dto.careServiceId, isActive: true },
    });
    if (!care) throw new BadRequestException('Invalid or inactive care service');
    const code = `CUSTOM_${randomUUID().replace(/-/g, '')}`;
    const row = await this.prisma.rateCard.create({
      data: {
        name: dto.name.trim(),
        code,
        isCustom: true,
        serviceUserId,
        linkedCareServiceId: dto.careServiceId,
        standardHourlyRate: dto.standardHourlyRate,
        mileageRatePerUnit: dto.mileageRatePerUnit ?? undefined,
        startDate: new Date(dto.startDate),
        sortOrder: 10_000,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_RATE_CARD_CREATED,
      recordType: 'RateCard',
      recordId: row.id,
      newValues: auditSnapshot(row),
      metadata: { serviceUserId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return {
      data: {
        id: row.id,
        name: row.name,
        code: row.code,
        isCustom: row.isCustom,
        serviceUserId: row.serviceUserId,
      },
    };
  }
}
