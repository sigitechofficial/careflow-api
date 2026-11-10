import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FundingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ServiceUserFundingQueryDto } from './dto/service-user-funding-query.dto';
import { CreateServiceUserFundingDto } from './dto/create-service-user-funding.dto';
import { UpdateServiceUserFundingDto } from './dto/update-service-user-funding.dto';
import { UpdateServiceUserFundingStatusDto } from './dto/update-service-user-funding-status.dto';
import { ApproveServiceUserFundingDto } from './dto/approve-service-user-funding.dto';
import { EndServiceUserFundingDto } from './dto/end-service-user-funding.dto';
import { assertDefaultChargeCard } from '../billing/charge-card-assignment.util';
import { assertFundingSplitPercentages } from '../billing/funding-contract.util';
import { VisitReconciliationsService } from '../billing/visit-reconciliations.service';

const fundingInclude = {
  fundingType: { select: { id: true, name: true, code: true } },
  fundingRoute: { select: { id: true, name: true, code: true, billingFundingTypeId: true } },
  funder: {
    select: {
      id: true,
      name: true,
      code: true,
      paymentTerms: true,
      defaultChargeCardId: true,
      defaultChargeCard: { select: { id: true, name: true, code: true, status: true } },
    },
  },
  approvedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
  defaultChargeCard: { select: { id: true, name: true, code: true, status: true } },
  serviceUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      serviceUserNumber: true,
      isActive: true,
    },
  },
} as const;

type Tx = Prisma.TransactionClient;

@Injectable()
export class ServiceUserFundingService {
  private readonly logger = new Logger(ServiceUserFundingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly visitReconciliations: VisitReconciliationsService,
  ) {}

  /**
   * Funding readiness drives visit-reconciliation exceptions. Refresh unlocked
   * rows after setup changes so "Billing contact missing" etc. clear without a manual sync.
   */
  private async refreshVisitReconciliations(serviceUserId: string) {
    try {
      await this.visitReconciliations.reEvaluateForServiceUser(serviceUserId);
    } catch (err) {
      this.logger.warn(
        `Failed to refresh visit reconciliations after funding change for ${serviceUserId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private assertStartBeforeEnd(start?: Date | null, end?: Date | null) {
    if (start && end && end.getTime() < start.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }

  private async ensureServiceUser(id: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
    return u;
  }

  private async ensureFundingType(id: string) {
    const ft = await this.prisma.fundingType.findFirst({ where: { id, deletedAt: null } });
    if (!ft) throw new NotFoundException('Funding type not found');
  }

  private async ensureFunder(id: string) {
    const f = await this.prisma.funder.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw new NotFoundException('Funder not found');
  }

  private parseDay(s?: string | null): Date | null {
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }

  private async loadFundingOrThrow(serviceUserId: string, fundingId: string) {
    const row = await this.prisma.serviceUserFunding.findFirst({
      where: { id: fundingId, serviceUserId, deletedAt: null },
      include: fundingInclude,
    });
    if (!row) throw new NotFoundException('Funding record not found');
    return row;
  }

  private async unsetOtherPrimaries(tx: Tx, serviceUserId: string, exceptId: string, userId: string) {
    await tx.serviceUserFunding.updateMany({
      where: { serviceUserId, deletedAt: null, id: { not: exceptId }, isPrimary: true },
      data: { isPrimary: false, updatedById: userId },
    });
  }

  /**
   * A line's funding route must come under the line's billing type (a council line can only have a council
   * route). Routes with no billing type set yet are allowed, so nothing is blocked before Settings is filled in.
   */
  private async assertRouteFitsLine(tx: Tx, fundingId: string) {
    const line = await tx.serviceUserFunding.findUnique({
      where: { id: fundingId },
      select: {
        fundingTypeId: true,
        fundingType: { select: { name: true } },
        fundingRoute: { select: { name: true, billingFundingTypeId: true } },
      },
    });
    const route = line?.fundingRoute;
    if (line && route?.billingFundingTypeId && route.billingFundingTypeId !== line.fundingTypeId) {
      throw new BadRequestException(
        `The funding route "${route.name}" does not fit a ${line.fundingType.name} funder. Choose a route for this funder.`,
      );
    }
  }

  /**
   * Point the person at their main funding line. When that line has a funding route, Personal Details shows it
   * (the route is chosen on the funding line, next to its funder, so it is entered once).
   */
  private async setCurrentFundingPointer(tx: Tx, serviceUserId: string, fundingId: string | null) {
    const line = fundingId
      ? await tx.serviceUserFunding.findUnique({ where: { id: fundingId }, select: { fundingRouteId: true } })
      : null;
    await tx.serviceUser.update({
      where: { id: serviceUserId },
      data: {
        currentFundingId: fundingId,
        ...(line?.fundingRouteId ? { fundingTypeId: line.fundingRouteId } : {}),
      },
    });
  }

  private primaryEligibleWhere(serviceUserId: string): Prisma.ServiceUserFundingWhereInput {
    return {
      serviceUserId,
      deletedAt: null,
      status: { notIn: [FundingStatus.ENDED, FundingStatus.REJECTED] },
    };
  }

  /** Keep exactly one primary among billable fundings; auto-promote when none remain. */
  private async ensurePrimaryFunding(tx: Tx, serviceUserId: string, userId: string): Promise<string | null> {
    const rows = await tx.serviceUserFunding.findMany({
      where: this.primaryEligibleWhere(serviceUserId),
      orderBy: [{ splitPriority: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, isPrimary: true },
    });
    if (rows.length === 0) {
      await this.setCurrentFundingPointer(tx, serviceUserId, null);
      return null;
    }

    const primaryRows = rows.filter((row) => row.isPrimary);
    if (primaryRows.length === 1) {
      const primaryId = primaryRows[0]!.id;
      await this.setCurrentFundingPointer(tx, serviceUserId, primaryId);
      return primaryId;
    }

    const winnerId = (primaryRows.length > 1 ? rows.find((row) => row.isPrimary) : rows[0])!.id;
    await tx.serviceUserFunding.updateMany({
      where: { serviceUserId, deletedAt: null, isPrimary: true, id: { not: winnerId } },
      data: { isPrimary: false, updatedById: userId },
    });
    await tx.serviceUserFunding.update({
      where: { id: winnerId },
      data: { isPrimary: true, updatedById: userId },
    });
    await this.setCurrentFundingPointer(tx, serviceUserId, winnerId);
    return winnerId;
  }

  private buildFundingData(
    dto: CreateServiceUserFundingDto | UpdateServiceUserFundingDto,
    userId: string,
    mode: 'create' | 'update',
  ): Prisma.ServiceUserFundingUncheckedUpdateInput {
    const start = dto.startDate !== undefined ? this.parseDay(dto.startDate ?? undefined) : undefined;
    const end = dto.endDate !== undefined ? this.parseDay(dto.endDate ?? undefined) : undefined;
    if (start !== undefined && end !== undefined) this.assertStartBeforeEnd(start, end);
    if (mode === 'create' && dto.startDate && dto.endDate) {
      this.assertStartBeforeEnd(this.parseDay(dto.startDate), this.parseDay(dto.endDate));
    }

    const data: Prisma.ServiceUserFundingUncheckedUpdateInput = { updatedById: userId };
    if (dto.fundingTypeId !== undefined) data.fundingTypeId = dto.fundingTypeId;
    if (dto.funderId !== undefined) data.funderId = dto.funderId ?? null;
    if (dto.fundingRouteId !== undefined) data.fundingRouteId = dto.fundingRouteId ?? null;
    if (dto.status !== undefined) data.status = dto.status as FundingStatus;
    if (dto.fundingReference !== undefined) data.fundingReference = dto.fundingReference?.trim() ?? null;
    if (dto.approvalReference !== undefined) data.approvalReference = dto.approvalReference?.trim() ?? null;
    if (dto.packageName !== undefined) data.packageName = dto.packageName?.trim() ?? null;
    if (dto.startDate !== undefined) data.startDate = start ?? null;
    if (dto.endDate !== undefined) data.endDate = end ?? null;
    if (dto.weeklyBudget !== undefined)
      data.weeklyBudget =
        dto.weeklyBudget == null ? null : new Prisma.Decimal(dto.weeklyBudget);
    if (dto.hourlyRate !== undefined)
      data.hourlyRate = dto.hourlyRate == null ? null : new Prisma.Decimal(dto.hourlyRate);
    if (dto.contributionAmount !== undefined)
      data.contributionAmount =
        dto.contributionAmount == null ? null : new Prisma.Decimal(dto.contributionAmount);
    if (dto.splitPercent !== undefined)
      data.splitPercent = dto.splitPercent == null ? null : new Prisma.Decimal(dto.splitPercent);
    if (dto.splitPriority !== undefined) data.splitPriority = dto.splitPriority;
    if (dto.purchaseOrderNumber !== undefined)
      data.purchaseOrderNumber = dto.purchaseOrderNumber?.trim() || null;
    if (dto.purchaseOrderExpiresAt !== undefined)
      data.purchaseOrderExpiresAt = dto.purchaseOrderExpiresAt
        ? this.parseDay(dto.purchaseOrderExpiresAt)
        : null;
    if (dto.authorisedWeeklyHours !== undefined)
      data.authorisedWeeklyHours = dto.authorisedWeeklyHours ?? null;
    if (dto.billingContactName !== undefined)
      data.billingContactName = dto.billingContactName?.trim() || null;
    if (dto.billingContactEmail !== undefined)
      data.billingContactEmail = dto.billingContactEmail?.trim() || null;
    if (dto.billingContactPhone !== undefined)
      data.billingContactPhone = dto.billingContactPhone?.trim() || null;
    if (dto.billingAddressLine1 !== undefined)
      data.billingAddressLine1 = dto.billingAddressLine1?.trim() || null;
    if (dto.billingAddressLine2 !== undefined)
      data.billingAddressLine2 = dto.billingAddressLine2?.trim() || null;
    if (dto.billingTown !== undefined)
      data.billingTown = dto.billingTown?.trim() || null;
    if (dto.billingCounty !== undefined)
      data.billingCounty = dto.billingCounty?.trim() || null;
    if (dto.billingCountry !== undefined)
      data.billingCountry = dto.billingCountry?.trim() || null;
    if (dto.billingPostcode !== undefined)
      data.billingPostcode = dto.billingPostcode?.trim() || null;
    if (dto.invoiceGroupingRule !== undefined)
      data.invoiceGroupingRule = dto.invoiceGroupingRule?.trim() || null;
    if (dto.isPrimary !== undefined) data.isPrimary = dto.isPrimary;
    if (dto.reviewDate !== undefined) data.reviewDate = dto.reviewDate ? this.parseDay(dto.reviewDate) : null;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() ?? null;
    if (dto.defaultChargeCardId !== undefined) data.defaultChargeCardId = dto.defaultChargeCardId;
    return data;
  }

  async findAllForServiceUser(serviceUserId: string, query: ServiceUserFundingQueryDto) {
    await this.ensureServiceUser(serviceUserId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.ServiceUserFundingWhereInput = {
      serviceUserId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status as FundingStatus;
    if (query.fundingTypeId) where.fundingTypeId = query.fundingTypeId;
    if (query.funderId) where.funderId = query.funderId;
    if (query.isPrimary !== undefined) where.isPrimary = query.isPrimary;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.startDateFrom || query.startDateTo) {
      where.startDate = {};
      if (query.startDateFrom) where.startDate.gte = this.parseDay(query.startDateFrom)!;
      if (query.startDateTo) where.startDate.lte = this.parseDay(query.startDateTo)!;
    }
    if (query.endDateFrom || query.endDateTo) {
      where.endDate = {};
      if (query.endDateFrom) where.endDate.gte = this.parseDay(query.endDateFrom)!;
      if (query.endDateTo) where.endDate.lte = this.parseDay(query.endDateTo)!;
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.ServiceUserFundingOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.serviceUserFunding.count({ where }),
      this.prisma.serviceUserFunding.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: fundingInclude,
      }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async findOneForServiceUser(serviceUserId: string, fundingId: string) {
    await this.ensureServiceUser(serviceUserId);
    const row = await this.loadFundingOrThrow(serviceUserId, fundingId);
    return { data: row };
  }

  async createForServiceUser(userId: string, serviceUserId: string, dto: CreateServiceUserFundingDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureFundingType(dto.fundingTypeId);
    if (dto.funderId) await this.ensureFunder(dto.funderId);
    const start = dto.startDate ? this.parseDay(dto.startDate) : null;
    const end = dto.endDate ? this.parseDay(dto.endDate) : null;
    this.assertStartBeforeEnd(start, end);

    const isPrimary = dto.isPrimary === true;
    const status = (dto.status as FundingStatus | undefined) ?? FundingStatus.UNKNOWN;

    const result = await this.prisma.$transaction(async (tx) => {
      if (dto.defaultChargeCardId !== undefined) {
        await assertDefaultChargeCard(tx, dto.defaultChargeCardId);
      }
      await assertFundingSplitPercentages(tx, serviceUserId, dto.splitPercent);
      if (isPrimary) {
        await tx.serviceUserFunding.updateMany({
          where: { serviceUserId, deletedAt: null, isPrimary: true },
          data: { isPrimary: false, updatedById: userId },
        });
      }
      const created = await tx.serviceUserFunding.create({
        data: {
          serviceUserId,
          fundingTypeId: dto.fundingTypeId,
          funderId: dto.funderId ?? null,
          fundingRouteId: dto.fundingRouteId ?? null,
          status,
          fundingReference: dto.fundingReference?.trim() ?? null,
          approvalReference: dto.approvalReference?.trim() ?? null,
          packageName: dto.packageName?.trim() ?? null,
          startDate: start,
          endDate: end,
          weeklyBudget: dto.weeklyBudget != null ? new Prisma.Decimal(dto.weeklyBudget) : null,
          hourlyRate: dto.hourlyRate != null ? new Prisma.Decimal(dto.hourlyRate) : null,
          contributionAmount:
            dto.contributionAmount != null ? new Prisma.Decimal(dto.contributionAmount) : null,
          splitPercent: dto.splitPercent != null ? new Prisma.Decimal(dto.splitPercent) : null,
          splitPriority: dto.splitPriority ?? 1,
          purchaseOrderNumber: dto.purchaseOrderNumber?.trim() ?? null,
          purchaseOrderExpiresAt: dto.purchaseOrderExpiresAt
            ? this.parseDay(dto.purchaseOrderExpiresAt)
            : null,
          authorisedWeeklyHours: dto.authorisedWeeklyHours ?? null,
          billingContactName: dto.billingContactName?.trim() ?? null,
          billingContactEmail: dto.billingContactEmail?.trim() ?? null,
          billingContactPhone: dto.billingContactPhone?.trim() ?? null,
          invoiceGroupingRule: dto.invoiceGroupingRule?.trim() ?? null,
          isPrimary,
          reviewDate: dto.reviewDate ? this.parseDay(dto.reviewDate) : null,
          notes: dto.notes?.trim() ?? null,
          defaultChargeCardId: dto.defaultChargeCardId ?? null,
          createdById: userId,
          updatedById: userId,
        },
        include: fundingInclude,
      });
      await this.assertRouteFitsLine(tx, created.id);
      if (isPrimary) await this.setCurrentFundingPointer(tx, serviceUserId, created.id);
      await this.ensurePrimaryFunding(tx, serviceUserId, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_FUNDING_CREATED,
        recordType: 'ServiceUserFunding',
        recordId: created.id,
        newValues: auditSnapshot(created),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Funding created', data: created };
    });
    await this.refreshVisitReconciliations(serviceUserId);
    return result;
  }

  async updateForServiceUser(
    userId: string,
    serviceUserId: string,
    fundingId: string,
    dto: UpdateServiceUserFundingDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadFundingOrThrow(serviceUserId, fundingId);
    if (dto.fundingTypeId) await this.ensureFundingType(dto.fundingTypeId);
    if (dto.funderId) await this.ensureFunder(dto.funderId);

    const nextStart =
      dto.startDate !== undefined ? this.parseDay(dto.startDate ?? undefined) : existing.startDate;
    const nextEnd = dto.endDate !== undefined ? this.parseDay(dto.endDate ?? undefined) : existing.endDate;
    this.assertStartBeforeEnd(nextStart, nextEnd);

    const wantPrimary = dto.isPrimary === true;
    const demotePrimary = dto.isPrimary === false && existing.isPrimary;

    const result = await this.prisma.$transaction(async (tx) => {
      if (dto.defaultChargeCardId !== undefined) {
        await assertDefaultChargeCard(tx, dto.defaultChargeCardId);
      }
      if (dto.splitPercent !== undefined) {
        await assertFundingSplitPercentages(tx, serviceUserId, dto.splitPercent, fundingId);
      }
      if (wantPrimary) {
        await this.unsetOtherPrimaries(tx, serviceUserId, fundingId, userId);
      }
      const data = this.buildFundingData(dto, userId, 'update');
      const updated = await tx.serviceUserFunding.update({
        where: { id: fundingId },
        data: data as Prisma.ServiceUserFundingUncheckedUpdateInput,
        include: fundingInclude,
      });
      await this.assertRouteFitsLine(tx, fundingId);
      if (wantPrimary) await this.setCurrentFundingPointer(tx, serviceUserId, fundingId);
      if (demotePrimary) {
        const su = await tx.serviceUser.findFirst({ where: { id: serviceUserId }, select: { currentFundingId: true } });
        if (su?.currentFundingId === fundingId) await this.setCurrentFundingPointer(tx, serviceUserId, null);
      }
      await this.ensurePrimaryFunding(tx, serviceUserId, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_FUNDING_UPDATED,
        recordType: 'ServiceUserFunding',
        recordId: fundingId,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        metadata: {
          serviceUserId,
          changedFields: this.audit.getChangedFields(auditSnapshot(existing), auditSnapshot(updated)),
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Funding updated', data: updated };
    });
    await this.refreshVisitReconciliations(serviceUserId);
    return result;
  }

  async softDeleteForServiceUser(userId: string, serviceUserId: string, fundingId: string, meta?: RequestAuditMeta) {
    const existing = await this.loadFundingOrThrow(serviceUserId, fundingId);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.serviceUserFunding.update({
        where: { id: fundingId },
        data: {
          deletedAt: now,
          deletedById: userId,
          isActive: false,
          isPrimary: false,
          updatedById: userId,
        },
      });
      const su = await tx.serviceUser.findFirst({ where: { id: serviceUserId }, select: { currentFundingId: true } });
      if (su?.currentFundingId === fundingId) await this.setCurrentFundingPointer(tx, serviceUserId, null);
      await this.ensurePrimaryFunding(tx, serviceUserId, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_FUNDING_DELETED,
        recordType: 'ServiceUserFunding',
        recordId: fundingId,
        oldValues: auditSnapshot(existing),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Funding deleted', data: {} };
    });
    await this.refreshVisitReconciliations(serviceUserId);
    return result;
  }

  async updateStatus(
    userId: string,
    serviceUserId: string,
    fundingId: string,
    dto: UpdateServiceUserFundingStatusDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadFundingOrThrow(serviceUserId, fundingId);
    const result = await this.prisma.$transaction(async (tx) => {
      const notePatch =
        dto.notes !== undefined && dto.notes.trim()
          ? existing.notes
            ? `${existing.notes}\n${dto.notes.trim()}`
            : dto.notes.trim()
          : undefined;
      const updated = await tx.serviceUserFunding.update({
        where: { id: fundingId },
        data: {
          status: dto.status as FundingStatus,
          ...(notePatch !== undefined ? { notes: notePatch } : {}),
          updatedById: userId,
        },
        include: fundingInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_FUNDING_STATUS_CHANGED,
        recordType: 'ServiceUserFunding',
        recordId: fundingId,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        metadata: { serviceUserId, reason: dto.reason ?? null },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Funding status updated', data: updated };
    });
    await this.refreshVisitReconciliations(serviceUserId);
    return result;
  }

  async setPrimary(userId: string, serviceUserId: string, fundingId: string, meta?: RequestAuditMeta) {
    await this.loadFundingOrThrow(serviceUserId, fundingId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.unsetOtherPrimaries(tx, serviceUserId, fundingId, userId);
      const updated = await tx.serviceUserFunding.update({
        where: { id: fundingId },
        data: { isPrimary: true, updatedById: userId },
        include: fundingInclude,
      });
      await this.setCurrentFundingPointer(tx, serviceUserId, fundingId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_FUNDING_SET_PRIMARY,
        recordType: 'ServiceUserFunding',
        recordId: fundingId,
        newValues: auditSnapshot(updated),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Primary funding set', data: updated };
    });
    await this.refreshVisitReconciliations(serviceUserId);
    return result;
  }

  async approveFunding(
    userId: string,
    serviceUserId: string,
    fundingId: string,
    dto: ApproveServiceUserFundingDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadFundingOrThrow(serviceUserId, fundingId);
    const now = new Date();
    const start = existing.startDate ? new Date(existing.startDate) : null;
    const newStatus =
      start && start.getTime() > now.getTime() ? FundingStatus.APPROVED : FundingStatus.ACTIVE;

    const result = await this.prisma.$transaction(async (tx) => {
      const approvalRef =
        dto.approvalReference !== undefined ? dto.approvalReference?.trim() || null : existing.approvalReference;
      const notePatch =
        dto.notes !== undefined && dto.notes.trim()
          ? existing.notes
            ? `${existing.notes}\n${dto.notes.trim()}`
            : dto.notes.trim()
          : undefined;
      const updated = await tx.serviceUserFunding.update({
        where: { id: fundingId },
        data: {
          status: newStatus,
          approvedAt: now,
          approvedById: userId,
          approvalReference: approvalRef,
          ...(notePatch !== undefined ? { notes: notePatch } : {}),
          updatedById: userId,
        },
        include: fundingInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_FUNDING_APPROVED,
        recordType: 'ServiceUserFunding',
        recordId: fundingId,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Funding approved', data: updated };
    });
    await this.refreshVisitReconciliations(serviceUserId);
    return result;
  }

  async endFunding(
    userId: string,
    serviceUserId: string,
    fundingId: string,
    dto: EndServiceUserFundingDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadFundingOrThrow(serviceUserId, fundingId);
    const end = this.parseDay(dto.endDate);
    this.assertStartBeforeEnd(existing.startDate, end);

    const result = await this.prisma.$transaction(async (tx) => {
      let notePatch: string | undefined;
      if (dto.notes !== undefined && dto.notes.trim()) {
        notePatch = existing.notes ? `${existing.notes}\n${dto.notes.trim()}` : dto.notes.trim();
      } else if (dto.reason?.trim()) {
        const line = `End reason: ${dto.reason.trim()}`;
        notePatch = existing.notes ? `${existing.notes}\n${line}` : line;
      }
      const updated = await tx.serviceUserFunding.update({
        where: { id: fundingId },
        data: {
          status: FundingStatus.ENDED,
          endDate: end,
          isPrimary: false,
          ...(notePatch !== undefined ? { notes: notePatch } : {}),
          updatedById: userId,
        },
        include: fundingInclude,
      });
      const su = await tx.serviceUser.findFirst({ where: { id: serviceUserId }, select: { currentFundingId: true } });
      if (su?.currentFundingId === fundingId) await this.setCurrentFundingPointer(tx, serviceUserId, null);
      await this.ensurePrimaryFunding(tx, serviceUserId, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_FUNDING_ENDED,
        recordType: 'ServiceUserFunding',
        recordId: fundingId,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        metadata: { serviceUserId, reason: dto.reason ?? null },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Funding ended', data: updated };
    });
    await this.refreshVisitReconciliations(serviceUserId);
    return result;
  }

  /** Reporting helper: current pointer on ServiceUser, if set. */
  async getCurrentFundingForServiceUser(serviceUserId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      include: {
        currentFunding: {
          include: fundingInclude,
        },
      },
    });
    return su?.currentFunding ?? null;
  }

  /** Non-deleted funding rows for a service user, newest first. */
  async getFundingHistoryForServiceUser(serviceUserId: string) {
    return this.prisma.serviceUserFunding.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      include: fundingInclude,
    });
  }

  /** Active-looking rows (not ended, not deleted) for a funding type — for future billing reports. */
  async getActiveFundingByType(fundingTypeId: string) {
    const today = new Date();
    return this.prisma.serviceUserFunding.findMany({
      where: {
        fundingTypeId,
        deletedAt: null,
        isActive: true,
        status: { in: [FundingStatus.ACTIVE, FundingStatus.APPROVED] },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: {
        fundingType: fundingInclude.fundingType,
        funder: fundingInclude.funder,
        approvedBy: fundingInclude.approvedBy,
        serviceUser: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /** Rows with reviewDate in [from, to] inclusive. */
  async getFundingExpiringForReview(from: Date, to: Date) {
    return this.prisma.serviceUserFunding.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        reviewDate: { gte: from, lte: to },
      },
      include: {
        fundingType: fundingInclude.fundingType,
        funder: fundingInclude.funder,
        approvedBy: fundingInclude.approvedBy,
        serviceUser: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
