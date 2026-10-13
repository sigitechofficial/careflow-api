import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { VisitReconciliationStatus } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { RecordTravelIntervalDto } from './dto/travel-intervals.dto';
import { assertDifferentUser } from './financial-controls.util';
import { detectInterVisitTravel } from './pay-inter-visit-travel.util';
import { isPaySettled } from './pay-settlement.util';
import { decidedTravelForVisit, intervalIsPayable, travelTreatment } from './travel-interval.util';

const MAX_INTERVAL_MINUTES = 12 * 60;
const SETTLED_MESSAGE =
  'The pay of this visit is in a locked payroll run. Travel time for it is corrected with a pay correction, not by changing the interval.';

/**
 * TR-01 / TR-04 / TR-05 / TR-06: time before a visit, classified by a person. Entered by one
 * person and approved by another; only an approved interval changes what the pay run pays.
 */
@Injectable()
export class TravelIntervalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async requireVisit(id: string) {
    const visit = await this.prisma.visitReconciliation.findUnique({
      where: { id },
      select: {
        id: true,
        visitRef: true,
        employeeId: true,
        serviceUserId: true,
        approvedPayStart: true,
        approvedPayEnd: true,
        plannedStartDateTime: true,
        plannedEndDateTime: true,
        travelMinutes: true,
        includedInPayrollRunId: true,
        paidByUkPayrollRunId: true,
      },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  /** The intervals of a visit, what they decide, and the estimate the pay run uses without them. */
  async listForVisit(visitReconciliationId: string) {
    const visit = await this.requireVisit(visitReconciliationId);
    const rows = await this.prisma.travelTimeInterval.findMany({
      where: { toVisitReconciliationId: visitReconciliationId },
      orderBy: { startAt: 'asc' },
    });
    const userIds = [...new Set(rows.flatMap((r) => [r.createdById, r.decidedById]).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));

    const start = visit.approvedPayStart ?? visit.plannedStartDateTime;
    const end = visit.approvedPayEnd ?? visit.plannedEndDateTime;
    // The estimate: the gap since the carer's previous visit that day, as the pay run reads it.
    let estimate: {
      fromVisitRef: string;
      gapMinutes: number;
      classification: string;
      travelMinutes: number;
      waitingMinutes: number;
      needsReview: boolean;
    } | null = null;
    if (visit.employeeId && start && end) {
      const previous = await this.prisma.visitReconciliation.findFirst({
        where: {
          employeeId: visit.employeeId,
          id: { not: visit.id },
          status: {
            in: [
              VisitReconciliationStatus.APPROVED_FOR_PAY,
              VisitReconciliationStatus.APPROVED_FOR_BOTH,
              VisitReconciliationStatus.LOCKED,
            ],
          },
          approvedPayEnd: { lte: start, gte: new Date(start.getTime() - 12 * 60 * 60_000) },
        },
        orderBy: { approvedPayEnd: 'desc' },
        select: { id: true, visitRef: true, approvedPayStart: true, approvedPayEnd: true, serviceUserId: true },
      });
      if (previous?.approvedPayStart && previous.approvedPayEnd) {
        const [journey] = detectInterVisitTravel([
          {
            reconciliationId: previous.id,
            employeeId: visit.employeeId,
            visitRef: previous.visitRef,
            payStart: previous.approvedPayStart,
            payEnd: previous.approvedPayEnd,
            serviceUserId: previous.serviceUserId,
          },
          {
            reconciliationId: visit.id,
            employeeId: visit.employeeId,
            visitRef: visit.visitRef,
            payStart: start,
            payEnd: end,
            manualTravelMinutes: visit.travelMinutes,
            serviceUserId: visit.serviceUserId,
          },
        ]);
        if (journey) {
          estimate = {
            fromVisitRef: previous.visitRef,
            gapMinutes: journey.gapMinutes,
            classification: journey.classification,
            travelMinutes: journey.payableTravelMinutes,
            waitingMinutes: journey.payableWaitingMinutes,
            needsReview: journey.requiresManagerReview,
          };
        }
      }
    }
    const decided = decidedTravelForVisit(rows);
    return {
      message: 'Travel time of the visit',
      data: {
        visit: { id: visit.id, visitRef: visit.visitRef, employeeId: visit.employeeId, paySettled: isPaySettled(visit) },
        // What the pay run uses: the approved intervals when there are any, otherwise the estimate.
        basis: decided ? 'APPROVED_INTERVALS' : estimate ? 'ESTIMATED_FROM_GAP' : 'NONE',
        decided,
        estimate,
        intervals: rows.map((r) => ({
          id: r.id,
          category: r.category,
          evidence: r.evidence,
          status: r.status,
          startAt: r.startAt.toISOString(),
          endAt: r.endAt.toISOString(),
          minutes: r.minutes,
          treatment: travelTreatment(r.category),
          paid: intervalIsPayable(r.category, r.payable),
          note: r.note,
          decisionNote: r.decisionNote,
          createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
          decidedByName: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
          decidedAt: r.decidedAt?.toISOString() ?? null,
        })),
      },
    };
  }

  async record(userId: string, dto: RecordTravelIntervalDto, meta?: RequestAuditMeta) {
    const visit = await this.requireVisit(dto.toVisitReconciliationId);
    if (!visit.employeeId) throw new BadRequestException('This visit has no carer.');
    if (isPaySettled(visit)) throw new BadRequestException(SETTLED_MESSAGE);

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    const minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
    if (!(minutes > 0)) throw new BadRequestException('The interval must end after it starts.');
    if (minutes > MAX_INTERVAL_MINUTES) throw new BadRequestException('An interval cannot be longer than 12 hours.');
    const visitStart = visit.approvedPayStart ?? visit.plannedStartDateTime;
    const visitEnd = visit.approvedPayEnd ?? visit.plannedEndDateTime;
    if (visitStart && startAt.getTime() < visitStart.getTime() - 24 * 60 * 60_000) {
      throw new BadRequestException('The interval must fall within the day before the visit it led to.');
    }
    if (visitEnd && endAt.getTime() > visitEnd.getTime()) {
      throw new BadRequestException('The interval cannot end after the visit it led to.');
    }
    const overlapping = await this.prisma.travelTimeInterval.findFirst({
      where: {
        employeeId: visit.employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new BadRequestException('Another interval of this carer already covers part of that time.');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.travelTimeInterval.create({
        data: {
          employeeId: visit.employeeId!,
          toVisitReconciliationId: visit.id,
          startAt,
          endAt,
          minutes,
          category: dto.category,
          evidence: dto.evidence,
          payable: intervalIsPayable(dto.category, dto.payable === true),
          note: dto.note.trim(),
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.TRAVEL_INTERVAL_RECORDED,
        recordType: 'TravelTimeInterval',
        recordId: created.id,
        description: dto.note.trim(),
        newValues: { category: created.category, evidence: created.evidence, minutes, payable: created.payable },
        metadata: { visitReconciliationId: visit.id, visitRef: visit.visitRef, employeeId: visit.employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return created;
    });
    return { message: 'Interval recorded. It changes pay once a second person approves it.', data: { id: row.id } };
  }

  private async decide(
    userId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    note: string | undefined,
    meta?: RequestAuditMeta,
  ) {
    const interval = await this.prisma.travelTimeInterval.findUnique({ where: { id } });
    if (!interval) throw new NotFoundException('Interval not found');
    if (interval.status !== 'PENDING') throw new BadRequestException('This interval has already been decided.');
    if (status === 'APPROVED') {
      assertDifferentUser(
        interval.createdById,
        userId,
        'A travel-time interval is approved by a different user from the one who recorded it.',
      );
      const visit = await this.requireVisit(interval.toVisitReconciliationId);
      if (isPaySettled(visit)) throw new BadRequestException(SETTLED_MESSAGE);
    }
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.travelTimeInterval.updateMany({
        where: { id, status: 'PENDING' },
        data: { status, decidedById: userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
      });
      if (changed.count !== 1) {
        throw new ConflictException('This interval was decided by someone else. Reload and check.');
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: status === 'APPROVED' ? AuditAction.TRAVEL_INTERVAL_APPROVED : AuditAction.TRAVEL_INTERVAL_REJECTED,
        recordType: 'TravelTimeInterval',
        recordId: id,
        description: note?.trim() || undefined,
        oldValues: { status: 'PENDING' },
        newValues: { status },
        metadata: { visitReconciliationId: interval.toVisitReconciliationId, employeeId: interval.employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return {
      message:
        status === 'APPROVED'
          ? 'Interval approved. Recalculate any open pay run that includes this visit.'
          : 'Interval rejected.',
      data: { id, status },
    };
  }

  approve(userId: string, id: string, note?: string, meta?: RequestAuditMeta) {
    return this.decide(userId, id, 'APPROVED', note, meta);
  }

  reject(userId: string, id: string, note: string, meta?: RequestAuditMeta) {
    return this.decide(userId, id, 'REJECTED', note, meta);
  }
}
