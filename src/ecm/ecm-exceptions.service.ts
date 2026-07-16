import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EcmArrivalClassification,
  EcmDurationClassification,
  EcmExceptionKind,
  EcmExceptionLifecycle,
  EcmMissedClassification,
  EcmAuditEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAuditService } from './ecm-audit.service';
import { EcmAlertService } from './ecm-alert.service';
import { slaTargetsForCriticality } from './ecm-sla.util';

/** Open queue includes RESOLVED so managers can still Close (audit close gate). */
const OPEN_LIFECYCLES: EcmExceptionLifecycle[] = [
  EcmExceptionLifecycle.DETECTED,
  EcmExceptionLifecycle.ALERT_GENERATED,
  EcmExceptionLifecycle.ASSIGNED,
  EcmExceptionLifecycle.ACKNOWLEDGED,
  EcmExceptionLifecycle.INVESTIGATING,
  EcmExceptionLifecycle.ACTION_TAKEN,
  EcmExceptionLifecycle.RESOLVED,
  EcmExceptionLifecycle.MANAGER_REVIEWED,
];

@Injectable()
export class EcmExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EcmAuditService,
    private readonly alerts: EcmAlertService,
  ) {}

  /**
   * Ensure open exceptions exist for classifications on the evaluation (idempotent by kind).
   */
  async syncFromEvaluation(evaluationId: string) {
    const evaluation = await this.prisma.ecmVisitEvaluation.findUnique({
      where: { id: evaluationId },
    });
    if (!evaluation) return [];

    const desired: { kind: EcmExceptionKind; title: string; detail?: string }[] = [];

    if (evaluation.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL) {
      desired.push({
        kind: EcmExceptionKind.LATE_ARRIVAL,
        title: 'Late arrival',
        detail:
          evaluation.startVarianceMinutes != null
            ? `Start variance +${evaluation.startVarianceMinutes} minutes`
            : undefined,
      });
    }
    if (evaluation.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL) {
      desired.push({
        kind: EcmExceptionKind.VERY_LATE_ARRIVAL,
        title: 'Very late arrival',
        detail:
          evaluation.startVarianceMinutes != null
            ? `Start variance +${evaluation.startVarianceMinutes} minutes`
            : undefined,
      });
    }
    if (evaluation.arrivalClassification === EcmArrivalClassification.EARLY_ARRIVAL) {
      desired.push({
        kind: EcmExceptionKind.EARLY_ARRIVAL,
        title: 'Early arrival',
      });
    }
    if (evaluation.durationClassification === EcmDurationClassification.SHORT_VISIT) {
      desired.push({ kind: EcmExceptionKind.SHORT_VISIT, title: 'Short visit' });
    }
    if (evaluation.durationClassification === EcmDurationClassification.LONG_VISIT) {
      desired.push({ kind: EcmExceptionKind.LONG_VISIT, title: 'Long visit' });
    }
    if (evaluation.durationClassification === EcmDurationClassification.EXCESSIVE_OVERRUN) {
      desired.push({
        kind: EcmExceptionKind.EXCESSIVE_OVERRUN,
        title: 'Excessive overrun',
      });
    }
    if (evaluation.missedClassification === EcmMissedClassification.POTENTIAL_MISSED) {
      desired.push({
        kind: EcmExceptionKind.POTENTIAL_MISSED,
        title: 'Potential missed visit',
      });
    }
    if (evaluation.missedClassification === EcmMissedClassification.CONFIRMED_MISSED) {
      desired.push({
        kind: EcmExceptionKind.CONFIRMED_MISSED,
        title: 'Confirmed missed visit',
      });
    }
    if (evaluation.operationalExceptionCodes.includes('OUTSIDE_GEOFENCE')) {
      desired.push({
        kind: EcmExceptionKind.OUTSIDE_GEOFENCE,
        title: 'Outside geofence attendance',
      });
    }
    if (evaluation.operationalExceptionCodes.includes('MANUAL_ATTENDANCE')) {
      desired.push({
        kind: EcmExceptionKind.MANUAL_ATTENDANCE,
        title: 'Manual attendance',
      });
    }
    if (evaluation.operationalExceptionCodes.includes('MOCK_LOCATION')) {
      desired.push({
        kind: EcmExceptionKind.MOCK_LOCATION,
        title: 'Mock location flagged',
      });
    }
    if (
      evaluation.actualCheckInAt &&
      !evaluation.actualCheckOutAt &&
      evaluation.plannedEndDateTime &&
      evaluation.plannedEndDateTime.getTime() < Date.now()
    ) {
      desired.push({
        kind: EcmExceptionKind.MISSING_CHECKOUT,
        title: 'Missing check-out',
      });
    }

    const createdOrExisting = [];
    for (const item of desired) {
      const open = await this.prisma.ecmException.findFirst({
        where: {
          scheduledJobId: evaluation.scheduledJobId,
          kind: item.kind,
          lifecycle: { in: OPEN_LIFECYCLES },
        },
      });
      if (open) {
        createdOrExisting.push(open);
        continue;
      }
      const sla = slaTargetsForCriticality(evaluation.criticality);
      const row = await this.prisma.ecmException.create({
        data: {
          scheduledJobId: evaluation.scheduledJobId,
          ecmVisitEvaluationId: evaluation.id,
          kind: item.kind,
          lifecycle: EcmExceptionLifecycle.DETECTED,
          title: item.title,
          detail: item.detail,
          responseTargetMinutes: sla.responseTargetMinutes,
          escalationDeadlineAt:
            sla.escalationMinutes > 0
              ? new Date(Date.now() + sla.escalationMinutes * 60_000)
              : new Date(),
        },
      });
      await this.audit.append({
        eventType: EcmAuditEventType.EXCEPTION_DETECTED,
        scheduledJobId: evaluation.scheduledJobId,
        ecmExceptionId: row.id,
        summary: `Exception detected: ${row.kind}`,
        detail: { title: row.title, detail: row.detail },
      });
      await this.alerts.applySlaAndAlert({
        exceptionId: row.id,
        criticality: evaluation.criticality,
        notify: true,
      });
      createdOrExisting.push(row);
    }
    return createdOrExisting;
  }

  async listOpen(limit = 50) {
    await this.alerts.refreshOverdueFlags(200);
    const rows = await this.prisma.ecmException.findMany({
      where: { lifecycle: { in: OPEN_LIFECYCLES } },
      orderBy: [{ overdue: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(limit, 100),
      include: {
        scheduledJob: {
          select: {
            id: true,
            jobName: true,
            serviceUser: {
              select: { id: true, firstName: true, lastName: true, preferredName: true },
            },
          },
        },
      },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        scheduledJobId: r.scheduledJobId,
        kind: r.kind,
        lifecycle: r.lifecycle,
        title: r.title,
        detail: r.detail,
        overdue: r.overdue,
        responseTargetMinutes: r.responseTargetMinutes,
        escalationDeadlineAt: r.escalationDeadlineAt?.toISOString() ?? null,
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        jobName: r.scheduledJob.jobName,
        serviceUserName:
          r.scheduledJob.serviceUser.preferredName?.trim() ||
          [r.scheduledJob.serviceUser.firstName, r.scheduledJob.serviceUser.lastName]
            .filter(Boolean)
            .join(' '),
      })),
    };
  }

  async acknowledge(id: string, userId: string, note?: string) {
    const row = await this.requireOpen(id);
    const updated = await this.prisma.ecmException.update({
      where: { id },
      data: {
        lifecycle: EcmExceptionLifecycle.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgedById: userId,
        ownerUserId: row.ownerUserId ?? userId,
        firstActionAt: row.firstActionAt ?? new Date(),
        resolutionNote: note?.trim() || row.resolutionNote,
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_ACKNOWLEDGED,
      scheduledJobId: updated.scheduledJobId,
      ecmExceptionId: updated.id,
      actorUserId: userId,
      summary: `Exception acknowledged: ${updated.kind}`,
      detail: { note: note ?? null },
    });
    return updated;
  }

  async resolve(id: string, userId: string, reasonCode: string, note?: string) {
    await this.requireOpen(id);
    if (!reasonCode?.trim()) {
      throw new BadRequestException('reasonCode is required');
    }
    const updated = await this.prisma.ecmException.update({
      where: { id },
      data: {
        lifecycle: EcmExceptionLifecycle.RESOLVED,
        reasonCode: reasonCode.trim(),
        resolutionNote: note?.trim() || null,
        resolvedAt: new Date(),
        resolvedById: userId,
        firstActionAt: new Date(),
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_RESOLVED,
      scheduledJobId: updated.scheduledJobId,
      ecmExceptionId: updated.id,
      actorUserId: userId,
      summary: `Exception resolved: ${updated.kind} (${reasonCode.trim()})`,
      detail: { reasonCode: reasonCode.trim(), note: note ?? null },
    });
    return updated;
  }

  async close(id: string, userId: string, note?: string) {
    const row = await this.prisma.ecmException.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Exception not found');
    if (
      row.lifecycle !== EcmExceptionLifecycle.RESOLVED &&
      row.lifecycle !== EcmExceptionLifecycle.MANAGER_REVIEWED
    ) {
      throw new BadRequestException('Resolve the exception before closing');
    }
    const updated = await this.prisma.ecmException.update({
      where: { id },
      data: {
        lifecycle: EcmExceptionLifecycle.CLOSED,
        closedAt: new Date(),
        closedById: userId,
        resolutionNote: note?.trim() || row.resolutionNote,
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_CLOSED,
      scheduledJobId: updated.scheduledJobId,
      ecmExceptionId: updated.id,
      actorUserId: userId,
      summary: `Exception closed: ${updated.kind}`,
      detail: { note: note ?? null },
    });
    return updated;
  }

  private async requireOpen(id: string) {
    const row = await this.prisma.ecmException.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Exception not found');
    if (!OPEN_LIFECYCLES.includes(row.lifecycle)) {
      throw new BadRequestException(`Exception is already ${row.lifecycle}`);
    }
    return row;
  }
}
