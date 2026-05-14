import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import { DataAccessType, LiveInProfileStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateLiveInProfileDto } from './dto/create-live-in-profile.dto';
import { UpdateLiveInProfileDto } from './dto/update-live-in-profile.dto';
import { UpdateLiveInProfileStatusDto } from './dto/update-live-in-profile-status.dto';
import { AddPreferredCarerDto } from './dto/add-preferred-carer.dto';
import { AddBlockedCarerDto } from './dto/add-blocked-carer.dto';

const DOC_SEGMENTS = ['service-users', 'live-in-contracts'] as const;

const profileInclude = {
  serviceType: true,
  residentContact: {
    select: { id: true, firstName: true, lastName: true, phone: true, mobile: true, email: true },
  },
  levelOfCare: true,
  scanType: true,
  preferredCarers: {
    include: { employee: { include: { personalDetail: { select: { firstName: true, lastName: true } } } } },
  },
  blockedCarers: {
    include: { employee: { include: { personalDetail: { select: { firstName: true, lastName: true } } } } },
  },
  contractDocuments: {
    where: { deletedAt: null, isActive: true },
    orderBy: { uploadedAt: 'desc' as const },
    include: { uploadedBy: { select: { id: true, email: true, firstName: true, lastName: true } } },
  },
} as const;

type ProfileWithInc = Prisma.ServiceUserLiveInProfileGetPayload<{ include: typeof profileInclude }>;

@Injectable()
export class ServiceUserLiveInProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  filePublicUrl(fileName: string): string {
    return `/uploads/${DOC_SEGMENTS.join('/')}/${fileName}`;
  }

  private resolveAbsFromFileUrl(fileUrl: string): string {
    const rel = fileUrl.startsWith('/uploads/')
      ? fileUrl.replace('/uploads/', '')
      : fileUrl.replace(/^\//, '');
    return join(process.cwd(), 'uploads', rel);
  }

  async ensureServiceUserExists(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private async ensureEmployeeActive(employeeId: string) {
    const e = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null, isActive: true },
      include: { personalDetail: { select: { firstName: true, lastName: true } } },
    });
    if (!e) throw new BadRequestException('Employee not found or inactive');
    return e;
  }

  async ensureContactBelongsToServiceUser(contactId: string, serviceUserId: string) {
    const c = await this.prisma.serviceUserContact.findFirst({
      where: { id: contactId, serviceUserId, deletedAt: null },
    });
    if (!c) throw new BadRequestException('Contact does not belong to this service user');
  }

  private parseDay(s?: string | null): Date | null {
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }

  private assertStartBeforeEnd(start?: Date | null, end?: Date | null) {
    if (start && end && end.getTime() < start.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }

  /** ACTIVE requires live-in enabled; disabled live-in cannot be ACTIVE. */
  private validateStatusVsEnabled(isLiveInEnabled: boolean, status: LiveInProfileStatus) {
    if (status === LiveInProfileStatus.ACTIVE && !isLiveInEnabled) {
      throw new BadRequestException('ACTIVE status requires isLiveInEnabled to be true');
    }
  }

  private assertStatusTransition(from: LiveInProfileStatus, to: LiveInProfileStatus) {
    if (from === to) return;
    const isTerminal = from === LiveInProfileStatus.ENDED || from === LiveInProfileStatus.CANCELLED;
    if (isTerminal && to !== LiveInProfileStatus.DRAFT) {
      throw new BadRequestException(`Cannot transition from ${from} to ${to}`);
    }
  }

  private async ensureLookupIds(dto: {
    serviceTypeId?: string | null;
    levelOfCareId?: string | null;
    scanTypeId?: string | null;
  }) {
    if (dto.serviceTypeId) {
      const t = await this.prisma.liveInServiceType.findFirst({
        where: { id: dto.serviceTypeId, deletedAt: null, isActive: true },
      });
      if (!t) throw new BadRequestException('Invalid service type');
    }
    if (dto.levelOfCareId) {
      const t = await this.prisma.liveInLevelOfCare.findFirst({
        where: { id: dto.levelOfCareId, deletedAt: null, isActive: true },
      });
      if (!t) throw new BadRequestException('Invalid level of care');
    }
    if (dto.scanTypeId) {
      const t = await this.prisma.liveInScanType.findFirst({
        where: { id: dto.scanTypeId, deletedAt: null, isActive: true },
      });
      if (!t) throw new BadRequestException('Invalid scan type');
    }
  }

  private buildProfileData(
    dto: CreateLiveInProfileDto | UpdateLiveInProfileDto,
    userId: string,
    mode: 'create' | 'update',
  ): Prisma.ServiceUserLiveInProfileUncheckedUpdateInput {
    const start = dto.startDate !== undefined ? this.parseDay(dto.startDate ?? undefined) : undefined;
    const end = dto.endDate !== undefined ? this.parseDay(dto.endDate ?? undefined) : undefined;
    if (start !== undefined && end !== undefined) this.assertStartBeforeEnd(start, end);
    if (mode === 'create' && dto.startDate && dto.endDate) {
      this.assertStartBeforeEnd(this.parseDay(dto.startDate), this.parseDay(dto.endDate));
    }

    const data: Prisma.ServiceUserLiveInProfileUncheckedUpdateInput = { updatedById: userId };
    if (dto.isLiveInEnabled !== undefined) data.isLiveInEnabled = dto.isLiveInEnabled;
    if (dto.isCustom !== undefined) data.isCustom = dto.isCustom;
    if (dto.serviceTypeId !== undefined) data.serviceTypeId = dto.serviceTypeId ?? null;
    if (dto.residentContactId !== undefined) data.residentContactId = dto.residentContactId ?? null;
    if (dto.levelOfCareId !== undefined) data.levelOfCareId = dto.levelOfCareId ?? null;
    if (dto.scanTypeId !== undefined) data.scanTypeId = dto.scanTypeId ?? null;
    if (dto.numberOfCarers !== undefined) data.numberOfCarers = dto.numberOfCarers;
    if (dto.careInstructions !== undefined) data.careInstructions = dto.careInstructions?.trim() ?? null;
    if (dto.startDate !== undefined) data.startDate = start ?? null;
    if (dto.endDate !== undefined) data.endDate = end ?? null;
    if (dto.reviewDate !== undefined) data.reviewDate = dto.reviewDate ? this.parseDay(dto.reviewDate) : null;
    if (dto.status !== undefined) data.status = dto.status as LiveInProfileStatus;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() ?? null;
    return data;
  }

  async getProfileWithIncludes(serviceUserId: string): Promise<ProfileWithInc | null> {
    return this.prisma.serviceUserLiveInProfile.findFirst({
      where: { serviceUserId, deletedAt: null },
      include: profileInclude,
    });
  }

  async getByServiceUser(
    userId: string,
    serviceUserId: string,
    meta?: RequestAuditMeta,
  ): Promise<{ data: ProfileWithInc | null }> {
    await this.ensureServiceUserExists(serviceUserId);
    const row = await this.getProfileWithIncludes(serviceUserId);
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SERVICE_USER,
      recordType: 'ServiceUserLiveInProfile',
      recordId: row?.id ?? null,
      accessType: DataAccessType.VIEW,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
      metadata: { serviceUserId, liveInProfileId: row?.id ?? null, route: 'live_in_profile.get' },
    });
    if (row) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_PROFILE_VIEWED,
        recordType: 'ServiceUserLiveInProfile',
        recordId: row.id,
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    }
    return { data: row };
  }

  async create(userId: string, serviceUserId: string, dto: CreateLiveInProfileDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUserExists(serviceUserId);
    await this.ensureLookupIds(dto);
    if (dto.residentContactId) await this.ensureContactBelongsToServiceUser(dto.residentContactId, serviceUserId);

    const existingActive = await this.prisma.serviceUserLiveInProfile.findFirst({
      where: { serviceUserId, deletedAt: null },
    });
    if (existingActive) throw new ConflictException('Live-in profile already exists for this service user');

    const existingSoft = await this.prisma.serviceUserLiveInProfile.findFirst({
      where: { serviceUserId, deletedAt: { not: null } },
    });

    if (existingSoft) {
      const mergedEnabled = dto.isLiveInEnabled ?? existingSoft.isLiveInEnabled;
      const mergedStatus = (dto.status ?? existingSoft.status) as LiveInProfileStatus;
      this.validateStatusVsEnabled(mergedEnabled, mergedStatus);
      const mStart = dto.startDate !== undefined ? this.parseDay(dto.startDate ?? undefined) : existingSoft.startDate;
      const mEnd = dto.endDate !== undefined ? this.parseDay(dto.endDate ?? undefined) : existingSoft.endDate;
      this.assertStartBeforeEnd(mStart, mEnd);
    } else {
      const isLiveIn = dto.isLiveInEnabled ?? false;
      const status = (dto.status as LiveInProfileStatus | undefined) ?? LiveInProfileStatus.DRAFT;
      this.validateStatusVsEnabled(isLiveIn, status);
      const start = dto.startDate ? this.parseDay(dto.startDate) : null;
      const end = dto.endDate ? this.parseDay(dto.endDate) : null;
      this.assertStartBeforeEnd(start, end);
    }

    const start = dto.startDate ? this.parseDay(dto.startDate) : null;
    const end = dto.endDate ? this.parseDay(dto.endDate) : null;
    const status = (dto.status as LiveInProfileStatus | undefined) ?? LiveInProfileStatus.DRAFT;

    return this.prisma.$transaction(async (tx) => {
      if (existingSoft) {
        const data = this.buildProfileData(dto, userId, 'update') as Prisma.ServiceUserLiveInProfileUpdateInput;
        const updated = await tx.serviceUserLiveInProfile.update({
          where: { id: existingSoft.id },
          data: {
            ...data,
            deletedAt: null,
            deletedById: null,
            isActive: true,
            createdById: existingSoft.createdById ?? userId,
          },
          include: profileInclude,
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.LIVE_IN_PROFILE_CREATED,
          recordType: 'ServiceUserLiveInProfile',
          recordId: updated.id,
          newValues: auditSnapshot(updated),
          metadata: { serviceUserId, reactivated: true },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Live-in profile created', data: updated };
      }

      const created = await tx.serviceUserLiveInProfile.create({
        data: {
          serviceUserId,
          isLiveInEnabled: dto.isLiveInEnabled ?? false,
          isCustom: dto.isCustom ?? false,
          serviceTypeId: dto.serviceTypeId ?? null,
          residentContactId: dto.residentContactId ?? null,
          levelOfCareId: dto.levelOfCareId ?? null,
          scanTypeId: dto.scanTypeId ?? null,
          numberOfCarers: dto.numberOfCarers ?? 1,
          careInstructions: dto.careInstructions?.trim() ?? null,
          startDate: start,
          endDate: end,
          reviewDate: dto.reviewDate ? this.parseDay(dto.reviewDate) : null,
          status,
          notes: dto.notes?.trim() ?? null,
          createdById: userId,
          updatedById: userId,
        },
        include: profileInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_PROFILE_CREATED,
        recordType: 'ServiceUserLiveInProfile',
        recordId: created.id,
        newValues: auditSnapshot(created),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Live-in profile created', data: created };
    });
  }

  async update(userId: string, serviceUserId: string, dto: UpdateLiveInProfileDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUserExists(serviceUserId);
    const existing = await this.getProfileWithIncludes(serviceUserId);
    if (!existing) {
      return this.create(userId, serviceUserId, dto as CreateLiveInProfileDto, meta);
    }
    await this.ensureLookupIds(dto);
    if (dto.residentContactId) await this.ensureContactBelongsToServiceUser(dto.residentContactId, serviceUserId);

    const nextEnabled = dto.isLiveInEnabled !== undefined ? dto.isLiveInEnabled : existing.isLiveInEnabled;
    const nextStatus = (dto.status !== undefined ? dto.status : existing.status) as LiveInProfileStatus;
    this.validateStatusVsEnabled(nextEnabled, nextStatus);

    const nextStart = dto.startDate !== undefined ? this.parseDay(dto.startDate ?? undefined) : existing.startDate;
    const nextEnd = dto.endDate !== undefined ? this.parseDay(dto.endDate ?? undefined) : existing.endDate;
    this.assertStartBeforeEnd(nextStart, nextEnd);

    return this.prisma.$transaction(async (tx) => {
      const data = this.buildProfileData(dto, userId, 'update');
      const updated = await tx.serviceUserLiveInProfile.update({
        where: { id: existing.id },
        data: data as Prisma.ServiceUserLiveInProfileUpdateInput,
        include: profileInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_PROFILE_UPDATED,
        recordType: 'ServiceUserLiveInProfile',
        recordId: existing.id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        metadata: {
          serviceUserId,
          changedFields: this.audit.getChangedFields(auditSnapshot(existing), auditSnapshot(updated)),
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Live-in profile updated', data: updated };
    });
  }

  async softDelete(userId: string, serviceUserId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUserExists(serviceUserId);
    const existing = await this.getProfileWithIncludes(serviceUserId);
    if (!existing) throw new NotFoundException('Live-in profile not found');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.serviceUserLiveInPreferredCarer.deleteMany({ where: { liveInProfileId: existing.id } });
      await tx.serviceUserLiveInBlockedCarer.deleteMany({ where: { liveInProfileId: existing.id } });
      await tx.serviceUserLiveInContractDocument.updateMany({
        where: { liveInProfileId: existing.id, deletedAt: null },
        data: { deletedAt: now, isActive: false },
      });
      await tx.serviceUserLiveInProfile.update({
        where: { id: existing.id },
        data: { deletedAt: now, deletedById: userId, isActive: false, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_PROFILE_DELETED,
        recordType: 'ServiceUserLiveInProfile',
        recordId: existing.id,
        oldValues: auditSnapshot(existing),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Live-in profile deleted', data: {} };
    });
  }

  async updateStatus(
    userId: string,
    serviceUserId: string,
    dto: UpdateLiveInProfileStatusDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUserExists(serviceUserId);
    const existing = await this.getProfileWithIncludes(serviceUserId);
    if (!existing) throw new NotFoundException('Live-in profile not found');
    this.assertStatusTransition(existing.status, dto.status as LiveInProfileStatus);
    let nextEnabled = existing.isLiveInEnabled;
    if ((dto.status as LiveInProfileStatus) === LiveInProfileStatus.ACTIVE) {
      nextEnabled = true;
    }
    this.validateStatusVsEnabled(nextEnabled, dto.status as LiveInProfileStatus);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceUserLiveInProfile.update({
        where: { id: existing.id },
        data: {
          status: dto.status as LiveInProfileStatus,
          isLiveInEnabled: nextEnabled,
          updatedById: userId,
        },
        include: profileInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_PROFILE_STATUS_CHANGED,
        recordType: 'ServiceUserLiveInProfile',
        recordId: existing.id,
        oldValues: auditSnapshot({ status: existing.status, isLiveInEnabled: existing.isLiveInEnabled }),
        newValues: auditSnapshot({ status: updated.status, isLiveInEnabled: updated.isLiveInEnabled }),
        metadata: { serviceUserId, reason: dto.reason ?? null },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Status updated', data: updated };
    });
  }

  async getPreferredCarers(serviceUserId: string) {
    await this.ensureServiceUserExists(serviceUserId);
    const p = await this.getProfileWithIncludes(serviceUserId);
    if (!p) return { data: [] };
    return { data: p.preferredCarers };
  }

  async addPreferredCarer(
    userId: string,
    serviceUserId: string,
    dto: AddPreferredCarerDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUserExists(serviceUserId);
    const profile = await this.getProfileWithIncludes(serviceUserId);
    if (!profile) throw new NotFoundException('Live-in profile not found');
    const emp = await this.ensureEmployeeActive(dto.employeeId);
    const blocked = await this.prisma.serviceUserLiveInBlockedCarer.findFirst({
      where: { liveInProfileId: profile.id, employeeId: dto.employeeId },
    });
    if (blocked) throw new BadRequestException('Employee is blocked and cannot be added as preferred');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.serviceUserLiveInPreferredCarer.create({
          data: {
            liveInProfileId: profile.id,
            employeeId: dto.employeeId,
            reason: dto.reason?.trim() ?? null,
            createdById: userId,
          },
          include: { employee: { include: { personalDetail: true } } },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.LIVE_IN_PREFERRED_CARER_ADDED,
          recordType: 'ServiceUserLiveInPreferredCarer',
          recordId: row.id,
          newValues: auditSnapshot(row),
          metadata: {
            serviceUserId,
            liveInProfileId: profile.id,
            employeeId: dto.employeeId,
            employeeName: emp.personalDetail
              ? `${emp.personalDetail.firstName} ${emp.personalDetail.lastName}`.trim()
              : null,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Preferred carer added', data: row };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This employee is already a preferred carer for this profile');
      }
      throw e;
    }
  }

  async removePreferredCarer(userId: string, serviceUserId: string, employeeId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUserExists(serviceUserId);
    const profile = await this.getProfileWithIncludes(serviceUserId);
    if (!profile) throw new NotFoundException('Live-in profile not found');
    const link = await this.prisma.serviceUserLiveInPreferredCarer.findFirst({
      where: { liveInProfileId: profile.id, employeeId },
    });
    if (!link) throw new NotFoundException('Preferred carer link not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.serviceUserLiveInPreferredCarer.delete({ where: { id: link.id } });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_PREFERRED_CARER_REMOVED,
        recordType: 'ServiceUserLiveInPreferredCarer',
        recordId: link.id,
        oldValues: auditSnapshot(link),
        metadata: { serviceUserId, liveInProfileId: profile.id, employeeId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Preferred carer removed', data: {} };
    });
  }

  async getBlockedCarers(serviceUserId: string) {
    await this.ensureServiceUserExists(serviceUserId);
    const p = await this.getProfileWithIncludes(serviceUserId);
    if (!p) return { data: [] };
    return { data: p.blockedCarers };
  }

  async addBlockedCarer(userId: string, serviceUserId: string, dto: AddBlockedCarerDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUserExists(serviceUserId);
    const profile = await this.getProfileWithIncludes(serviceUserId);
    if (!profile) throw new NotFoundException('Live-in profile not found');
    const emp = await this.ensureEmployeeActive(dto.employeeId);
    const pref = await this.prisma.serviceUserLiveInPreferredCarer.findFirst({
      where: { liveInProfileId: profile.id, employeeId: dto.employeeId },
    });
    if (pref) throw new BadRequestException('Employee is preferred and cannot be added as blocked');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.serviceUserLiveInBlockedCarer.create({
          data: {
            liveInProfileId: profile.id,
            employeeId: dto.employeeId,
            reason: dto.reason?.trim() ?? null,
            createdById: userId,
          },
          include: { employee: { include: { personalDetail: true } } },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.LIVE_IN_BLOCKED_CARER_ADDED,
          recordType: 'ServiceUserLiveInBlockedCarer',
          recordId: row.id,
          newValues: auditSnapshot(row),
          metadata: {
            serviceUserId,
            liveInProfileId: profile.id,
            employeeId: dto.employeeId,
            employeeName: emp.personalDetail
              ? `${emp.personalDetail.firstName} ${emp.personalDetail.lastName}`.trim()
              : null,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Blocked carer added', data: row };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This employee is already a blocked carer for this profile');
      }
      throw e;
    }
  }

  async removeBlockedCarer(userId: string, serviceUserId: string, employeeId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUserExists(serviceUserId);
    const profile = await this.getProfileWithIncludes(serviceUserId);
    if (!profile) throw new NotFoundException('Live-in profile not found');
    const link = await this.prisma.serviceUserLiveInBlockedCarer.findFirst({
      where: { liveInProfileId: profile.id, employeeId },
    });
    if (!link) throw new NotFoundException('Blocked carer link not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.serviceUserLiveInBlockedCarer.delete({ where: { id: link.id } });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_BLOCKED_CARER_REMOVED,
        recordType: 'ServiceUserLiveInBlockedCarer',
        recordId: link.id,
        oldValues: auditSnapshot(link),
        metadata: { serviceUserId, liveInProfileId: profile.id, employeeId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Blocked carer removed', data: {} };
    });
  }

  async getContractDocuments(serviceUserId: string) {
    await this.ensureServiceUserExists(serviceUserId);
    const p = await this.getProfileWithIncludes(serviceUserId);
    if (!p) return { data: [] };
    return { data: p.contractDocuments };
  }

  async uploadContractDocument(
    userId: string,
    serviceUserId: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUserExists(serviceUserId);
    if (!file) throw new BadRequestException('File is required');
    let profile = await this.getProfileWithIncludes(serviceUserId);
    const url = this.filePublicUrl(file.filename);
    return this.prisma.$transaction(async (tx) => {
      if (!profile) {
        profile = await tx.serviceUserLiveInProfile.create({
          data: {
            serviceUserId,
            isLiveInEnabled: false,
            numberOfCarers: 1,
            status: LiveInProfileStatus.DRAFT,
            createdById: userId,
            updatedById: userId,
          },
          include: profileInclude,
        });
      }
      const doc = await tx.serviceUserLiveInContractDocument.create({
        data: {
          liveInProfileId: profile.id,
          fileName: file.filename,
          originalName: file.originalname,
          fileUrl: url,
          fileSize: file.size,
          mimeType: file.mimetype,
          uploadedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_CONTRACT_UPLOADED,
        recordType: 'ServiceUserLiveInContractDocument',
        recordId: doc.id,
        newValues: auditSnapshot(doc),
        metadata: { serviceUserId, liveInProfileId: profile.id, fileName: doc.originalName },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      const full = await tx.serviceUserLiveInContractDocument.findFirst({
        where: { id: doc.id },
        include: { uploadedBy: { select: { id: true, email: true, firstName: true, lastName: true } } },
      });
      return { message: 'Contract uploaded', data: full };
    });
  }

  async downloadContractDocument(
    userId: string,
    serviceUserId: string,
    documentId: string,
    res: Response,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUserExists(serviceUserId);
    const profile = await this.getProfileWithIncludes(serviceUserId);
    if (!profile) throw new NotFoundException('Live-in profile not found');
    const doc = await this.prisma.serviceUserLiveInContractDocument.findFirst({
      where: { id: documentId, liveInProfileId: profile.id, deletedAt: null, isActive: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const abs = this.resolveAbsFromFileUrl(doc.fileUrl);
    if (!existsSync(abs)) throw new NotFoundException('File not found on disk');

    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SERVICE_USER,
      recordType: 'ServiceUserLiveInContractDocument',
      recordId: documentId,
      accessType: DataAccessType.DOWNLOAD,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
      metadata: { serviceUserId, liveInProfileId: profile.id },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.LIVE_IN_CONTRACT_DOWNLOADED,
      recordType: 'ServiceUserLiveInContractDocument',
      recordId: documentId,
      metadata: { serviceUserId, liveInProfileId: profile.id, fileName: doc.originalName },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalName)}"`);
    createReadStream(abs).pipe(res);
  }

  async deleteContractDocument(userId: string, serviceUserId: string, documentId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUserExists(serviceUserId);
    const profile = await this.getProfileWithIncludes(serviceUserId);
    if (!profile) throw new NotFoundException('Live-in profile not found');
    const doc = await this.prisma.serviceUserLiveInContractDocument.findFirst({
      where: { id: documentId, liveInProfileId: profile.id, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.serviceUserLiveInContractDocument.update({
        where: { id: documentId },
        data: { deletedAt: now, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.LIVE_IN_CONTRACT_DELETED,
        recordType: 'ServiceUserLiveInContractDocument',
        recordId: documentId,
        oldValues: auditSnapshot(doc),
        metadata: { serviceUserId, liveInProfileId: profile.id, fileName: doc.originalName },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Contract document deleted', data: {} };
    });
  }
}
