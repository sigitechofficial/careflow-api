import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmployeeReviewDto } from './dto/create-employee-review.dto';
import { UpdateEmployeeReviewDto } from './dto/update-employee-review.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  deriveReviewStatus,
  effectiveNextDue,
  REVIEW_SCHEDULE_SELECT,
  scheduledNextDue,
  type ReviewSchedule,
} from './employee-review-schedule.util';
import { collectReviewDues, currentStaffWhere, reviewKey, type ReviewDue } from './review-dues';

type Db = Pick<PrismaService, 'reviewType' | 'employeeEmployment'>;

const SAFE_USER = { id: true, firstName: true, lastName: true, email: true } as const;

@Injectable()
export class EmployeeReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /** Settings → Supervision → "Due soon" window. */
  private async dueSoonDays(): Promise<number> {
    return (await this.orgSettings.getSupervisionSettings()).dueSoonDays;
  }

  /**
   * A carer's review records, plus `meta.upcoming`: reviews due from a type's schedule that have nothing
   * recorded yet (a new starter's first supervision, probation and induction milestones). The
   * latest record per type shows its due date from the schedule, so milestones stay right.
   */
  async list(employeeId: string) {
    const [items, collected, dueSoonDays] = await Promise.all([
      this.prisma.employeeReview.findMany({
        where: { employeeId, deletedAt: null },
        // Only display fields: a full User row carries password and refresh token hashes.
        include: { reviewType: true, reviewedBy: { select: SAFE_USER } },
        orderBy: [{ lastDone: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      }),
      collectReviewDues(this.prisma, { id: employeeId, deletedAt: null }),
      this.dueSoonDays(),
    ]);
    const startDate = collected.staff[0]?.startDate ?? null;
    return {
      data: this.withCurrentDue(items, (r) => (r.employeeId === employeeId ? startDate : null), dueSoonDays),
      meta: { upcoming: this.upcoming(collected.dues, dueSoonDays) },
    };
  }

  /** Organisation-wide staff reviews for Employee → Review Status, plus what is due with no record yet. */
  async overview() {
    const now = new Date();
    const [items, collected, dueSoonDays] = await Promise.all([
      this.prisma.employeeReview.findMany({
        where: { deletedAt: null, employee: { deletedAt: null } },
        include: {
          reviewType: true,
          employee: {
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true, username: true } },
              employment: { select: { startDate: true } },
            },
          },
        },
        orderBy: [{ lastDone: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      }),
      collectReviewDues(this.prisma, currentStaffWhere(now)),
      this.dueSoonDays(),
    ]);
    const rows = this.withCurrentDue(items, (r) => r.employee.employment?.startDate ?? null, dueSoonDays);
    rows.sort((x, y) => (x.nextDue?.getTime() ?? Infinity) - (y.nextDue?.getTime() ?? Infinity));
    const names = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(collected.dues.filter((d) => !d.trackerId).map((d) => d.employeeId))] } },
      select: { id: true, personalDetail: { select: { firstName: true, lastName: true, username: true } } },
    });
    const byId = new Map(names.map((e) => [e.id, e]));
    return {
      data: rows.map(({ employee, ...r }) => ({ ...r, employee: { id: employee.id, personalDetail: employee.personalDetail } })),
      meta: {
        upcoming: this.upcoming(collected.dues, dueSoonDays).map((u) => ({ ...u, employee: byId.get(u.employeeId) ?? null })),
      },
    };
  }

  /** Latest record per type gets its due date from the schedule; older records are history. */
  private withCurrentDue<
    T extends {
      employeeId: string;
      reviewTypeId: string | null;
      lastDone: Date | null;
      nextDue: Date | null;
      status: string | null;
      reviewType: (ReviewSchedule & { id: string }) | null;
    },
  >(items: T[], startDateOf: (row: T) => Date | null, dueSoonDays: number): T[] {
    const now = new Date();
    const seen = new Set<string>();
    return items.map((r) => {
      const key = r.reviewTypeId ? reviewKey(r.employeeId, r.reviewTypeId) : null;
      const isLatest = key !== null && !seen.has(key);
      if (key) seen.add(key);
      const nextDue = isLatest && r.reviewType ? effectiveNextDue(r.reviewType, r, startDateOf(r)) : r.nextDue;
      return { ...r, nextDue, status: deriveReviewStatus({ lastDone: r.lastDone, nextDue }, now, dueSoonDays) ?? r.status };
    });
  }

  private upcoming(dues: ReviewDue[], dueSoonDays: number) {
    const now = new Date();
    return dues
      .filter((d) => !d.trackerId)
      .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime())
      .map((d) => ({
        employeeId: d.employeeId,
        reviewTypeId: d.reviewTypeId,
        reviewType: { id: d.reviewTypeId, name: d.typeName, code: d.typeCode },
        nextDue: d.nextDue,
        status: deriveReviewStatus({ nextDue: d.nextDue }, now, dueSoonDays),
      }));
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeReviewDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    const nextDue =
      dto.nextDue !== undefined ? dto.nextDue : await this.nextDueFor(dto.reviewTypeId, employeeId, dto.lastDone ?? null);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeReview.create({
        data: {
          employeeId,
          ...dto,
          nextDue,
          status: deriveReviewStatus({ lastDone: dto.lastDone, nextDue }, new Date(), await this.dueSoonDays()),
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
      const { reason: rawReason, ...changes } = dto;
      const reason = rawReason?.trim() || null;
      // Changing what was reviewed or when is a correction to a compliance record: say why.
      const sameDay = (a: Date | null | undefined, b: Date | null) =>
        (a ? a.toISOString().slice(0, 10) : null) === (b ? b.toISOString().slice(0, 10) : null);
      const correcting =
        (dto.reviewTypeId !== undefined && dto.reviewTypeId !== existing.reviewTypeId) ||
        (dto.lastDone !== undefined && !sameDay(dto.lastDone, existing.lastDone)) ||
        (dto.nextDue !== undefined && !sameDay(dto.nextDue, existing.nextDue));
      if (correcting && !reason) {
        throw new BadRequestException('Say why the review type or dates are being changed');
      }
      const lastDone = dto.lastDone !== undefined ? dto.lastDone : existing.lastDone;
      let nextDue = dto.nextDue !== undefined ? dto.nextDue : existing.nextDue;
      // A new "last done" or type moves next due on by the type's schedule unless one was given.
      if (dto.nextDue === undefined && (dto.lastDone !== undefined || dto.reviewTypeId !== undefined)) {
        nextDue = await this.nextDueFor(dto.reviewTypeId ?? existing.reviewTypeId, employeeId, lastDone, tx);
      }
      const updated = await tx.employeeReview.update({
        where: { id: reviewId },
        data: {
          ...changes,
          nextDue,
          status: deriveReviewStatus({ lastDone, nextDue }, new Date(), await this.dueSoonDays()),
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
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId, reason },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Review updated', data: updated };
    });
  }

  async remove(userId: string, employeeId: string, reviewId: string, reason: string | undefined, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    const why = reason?.trim();
    if (!why || why.length < 3) throw new BadRequestException('Say why this review record is being removed');
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
        metadata: { employeeId, reason: why.slice(0, 500) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Review deleted', data: {} };
    });
  }

  /**
   * The review's audit trail (recorded, changed, removed: who, when, what and why) and the CareFlow
   * supervision sessions completed for the same carer and review type.
   */
  async history(employeeId: string, reviewId: string) {
    const review = await this.prisma.employeeReview.findFirst({
      where: { id: reviewId, employeeId },
      select: { id: true, reviewTypeId: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    const [logs, sessions] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { recordType: 'EmployeeReview', recordId: reviewId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          action: true,
          createdAt: true,
          oldValues: true,
          newValues: true,
          metadata: true,
          user: { select: SAFE_USER },
        },
      }),
      review.reviewTypeId
        ? this.prisma.supervisionSession.findMany({
            where: {
              deletedAt: null,
              status: 'COMPLETED',
              reviewTypeId: review.reviewTypeId,
              attendees: { some: { employeeId } },
            },
            orderBy: { heldAt: 'desc' },
            take: 50,
            select: {
              id: true,
              heldAt: true,
              completedAt: true,
              supervisor: { select: SAFE_USER },
            },
          })
        : [],
    ]);
    const FIELDS = ['reviewTypeId', 'lastDone', 'nextDue', 'notes', 'documentUrl', 'reviewedById'] as const;
    const pick = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
    return {
      data: {
        events: logs.map((log) => {
          const before = pick(log.oldValues);
          const after = pick(log.newValues);
          const meta = pick(log.metadata);
          const changes = FIELDS.filter((f) => f in after && JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)).map(
            (f) => ({ field: f, from: before[f] ?? null, to: after[f] ?? null }),
          );
          return {
            id: log.id,
            action: log.action,
            at: log.createdAt,
            by: log.user,
            reason: typeof meta.reason === 'string' ? meta.reason : null,
            changes,
          };
        }),
        sessions,
      },
    };
  }

  async previewNextDue(employeeId: string, reviewTypeId: string, lastDone: Date | null) {
    await this.ensureEmployee(employeeId);
    return { data: { nextDue: await this.nextDueFor(reviewTypeId, employeeId, lastDone) } };
  }

  /** Next due from the review type's schedule and the carer's start date; null if none. */
  private async nextDueFor(
    reviewTypeId: string | null | undefined,
    employeeId: string,
    lastDone: Date | null,
    db: Db = this.prisma,
  ): Promise<Date | null> {
    if (!reviewTypeId) return null;
    const [type, employment] = await Promise.all([
      db.reviewType.findFirst({ where: { id: reviewTypeId, deletedAt: null }, select: REVIEW_SCHEDULE_SELECT }),
      db.employeeEmployment.findFirst({ where: { employeeId }, select: { startDate: true } }),
    ]);
    return type ? scheduledNextDue(type, { lastDone, startDate: employment?.startDate ?? null }) : null;
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
