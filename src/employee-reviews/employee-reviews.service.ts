import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmployeeReviewDto } from './dto/create-employee-review.dto';
import { UpdateEmployeeReviewDto } from './dto/update-employee-review.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  computeReviewNextDue,
  deriveReviewStatus,
  withDerivedReviewStatus,
} from './employee-review-schedule.util';

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
    const now = new Date();
    return { data: items.map((r) => withDerivedReviewStatus(r, now)) };
  }

  /** Organisation-wide staff reviews for Employee → Review Status. */
  async overview() {
    const items = await this.prisma.employeeReview.findMany({
      where: {
        deletedAt: null,
        employee: { deletedAt: null },
      },
      include: {
        reviewType: true,
        employee: {
          select: {
            id: true,
            personalDetail: {
              select: { firstName: true, lastName: true, username: true },
            },
          },
        },
      },
      orderBy: [
        { nextDue: 'asc' },
        { createdAt: 'desc' },
      ],
    });
    const now = new Date();
    return { data: items.map((r) => withDerivedReviewStatus(r, now)) };
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeReviewDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    const intervalDays = await this.intervalDays(dto.reviewTypeId);
    const nextDue = dto.nextDue ?? computeReviewNextDue(dto.lastDone, intervalDays);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeReview.create({
        data: {
          employeeId,
          ...dto,
          nextDue,
          status: deriveReviewStatus({ lastDone: dto.lastDone, nextDue }),
          createdById: userId,
        },
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
      const lastDone = dto.lastDone !== undefined ? dto.lastDone : existing.lastDone;
      let nextDue = dto.nextDue !== undefined ? dto.nextDue : existing.nextDue;
      // A new "last done" or type moves next due on by the type interval unless one was given.
      if (dto.nextDue === undefined && (dto.lastDone !== undefined || dto.reviewTypeId !== undefined)) {
        const intervalDays = await this.intervalDays(dto.reviewTypeId ?? existing.reviewTypeId, tx);
        nextDue = computeReviewNextDue(lastDone, intervalDays) ?? nextDue;
      }
      const updated = await tx.employeeReview.update({
        where: { id: reviewId },
        data: {
          ...dto,
          nextDue,
          status: deriveReviewStatus({ lastDone, nextDue }),
          updatedById: userId,
        },
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

  /** Default interval of a review type (e.g. 90 days for supervision); null if none. */
  private async intervalDays(
    reviewTypeId: string | null | undefined,
    db: Pick<PrismaService, 'reviewType'> = this.prisma,
  ): Promise<number | null> {
    if (!reviewTypeId) return null;
    const type = await db.reviewType.findFirst({
      where: { id: reviewTypeId, deletedAt: null },
      select: { defaultIntervalDays: true },
    });
    return type?.defaultIntervalDays ?? null;
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
