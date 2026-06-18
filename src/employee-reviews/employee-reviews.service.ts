import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmployeeReviewDto } from './dto/create-employee-review.dto';
import { UpdateEmployeeReviewDto } from './dto/update-employee-review.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@Injectable()
export class EmployeeReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(employeeId: string) {
    const items = await this.prisma.employeeReview.findMany({
      where: { employeeId, deletedAt: null },
      include: { reviewType: true, reviewedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    return { data: items };
  }

  async listOverview() {
    const items = await this.prisma.employeeReview.findMany({
      where: {
        deletedAt: null,
        employee: { deletedAt: null, isActive: true },
      },
      include: {
        reviewType: true,
        employee: {
          include: {
            personalDetail: {
              select: { firstName: true, lastName: true, username: true },
            },
          },
        },
      },
      orderBy: [{ nextDue: 'asc' }, { createdAt: 'desc' }],
    });
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeReviewDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeReview.create({
        data: { employeeId, ...dto, createdById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_REVIEW,
        action: AuditAction.EMPLOYEE_REVIEW_ADDED,
        recordType: 'EmployeeReview',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Review created', data: created };
    });
  }

  async update(
    userId: string,
    employeeId: string,
    reviewId: string,
    dto: UpdateEmployeeReviewDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeReview.findFirst({
        where: { id: reviewId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Review not found');
      const updated = await tx.employeeReview.update({
        where: { id: reviewId },
        data: { ...dto, updatedById: userId },
      });
      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_REVIEW,
        action: AuditAction.EMPLOYEE_REVIEW_UPDATED,
        recordType: 'EmployeeReview',
        recordId: reviewId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Review updated', data: updated };
    });
  }

  async remove(userId: string, employeeId: string, reviewId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeReview.findFirst({
        where: { id: reviewId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Review not found');
      await tx.employeeReview.update({
        where: { id: reviewId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_REVIEW,
        action: AuditAction.EMPLOYEE_REVIEW_DELETED,
        recordType: 'EmployeeReview',
        recordId: reviewId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Review deleted', data: {} };
    });
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
