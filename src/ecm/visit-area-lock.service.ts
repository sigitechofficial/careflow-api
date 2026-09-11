import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CarerVisitPushKind,
  EcmAuditEventType,
  EcmExceptionKind,
  EcmExceptionLifecycle,
  Prisma,
  VisitAreaLockStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAuditService } from './ecm-audit.service';
import { EcmAlertService } from './ecm-alert.service';
import { slaTargetsForCriticality } from './ecm-sla.util';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';

export type VisitAreaLockState = {
  operationsLocked: boolean;
  lockedAt: string | null;
  status: VisitAreaLockStatus | null;
  /** Office already allowed continue once — do not lock this visit again. */
  continueAllowed: boolean;
};

@Injectable()
export class VisitAreaLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EcmAuditService,
    private readonly alerts: EcmAlertService,
    private readonly carerPush: CarerVisitPushHook,
  ) {}

  async getState(scheduledJobId: string): Promise<VisitAreaLockState> {
    const [locked, allowed] = await Promise.all([
      this.prisma.visitAreaLock.findFirst({
        where: { scheduledJobId, status: VisitAreaLockStatus.LOCKED },
        orderBy: { lockedAt: 'desc' },
      }),
      this.prisma.visitAreaLock.findFirst({
        where: { scheduledJobId, status: VisitAreaLockStatus.ALLOWED },
        orderBy: { allowedAt: 'desc' },
      }),
    ]);
    return {
      operationsLocked: Boolean(locked),
      lockedAt: locked?.lockedAt.toISOString() ?? allowed?.lockedAt.toISOString() ?? null,
      status: locked?.status ?? allowed?.status ?? null,
      continueAllowed: Boolean(allowed) && !locked,
    };
  }

  async assertUnlocked(scheduledJobId: string): Promise<void> {
    const state = await this.getState(scheduledJobId);
    if (!state.operationsLocked) return;
    throw new ConflictException({
      code: 'OPERATIONS_LOCKED',
      message:
        'Operations are locked because the carer left the visit area. Wait for office to allow continue.',
    });
  }

  async syncOutsidePresence(input: {
    scheduledJobId: string;
    employeeId: string;
    outsideArea: boolean;
    latitude?: number;
    longitude?: number;
    distanceMeters?: number | null;
  }): Promise<VisitAreaLockState & { withinArea: boolean; created: boolean }> {
    if (!input.outsideArea) {
      const state = await this.getState(input.scheduledJobId);
      return { ...state, withinArea: true, created: false };
    }

    const existing = await this.prisma.visitAreaLock.findFirst({
      where: {
        scheduledJobId: input.scheduledJobId,
        status: VisitAreaLockStatus.LOCKED,
      },
      orderBy: { lockedAt: 'desc' },
    });
    if (existing) {
      return {
        operationsLocked: true,
        lockedAt: existing.lockedAt.toISOString(),
        status: existing.status,
        continueAllowed: false,
        withinArea: false,
        created: false,
      };
    }

    const alreadyAllowed = await this.prisma.visitAreaLock.findFirst({
      where: {
        scheduledJobId: input.scheduledJobId,
        status: VisitAreaLockStatus.ALLOWED,
      },
      orderBy: { allowedAt: 'desc' },
    });
    if (alreadyAllowed) {
      return {
        operationsLocked: false,
        lockedAt: alreadyAllowed.lockedAt.toISOString(),
        status: alreadyAllowed.status,
        continueAllowed: true,
        withinArea: false,
        created: false,
      };
    }

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: input.scheduledJobId, deletedAt: null },
      select: {
        id: true,
        ecmEvaluation: { select: { id: true, criticality: true } },
      },
    });
    if (!job) throw new NotFoundException('Visit not found');

    const lockedAt = new Date();
    const sla = slaTargetsForCriticality(job.ecmEvaluation?.criticality);
    const exception = await this.prisma.ecmException.create({
      data: {
        scheduledJobId: input.scheduledJobId,
        ecmVisitEvaluationId: job.ecmEvaluation?.id ?? null,
        kind: EcmExceptionKind.LEFT_VISIT_AREA,
        lifecycle: EcmExceptionLifecycle.DETECTED,
        title: 'Left visit area — operations locked',
        detail: 'Carer left the visit area after clock-in. Clinical operations are blocked.',
        responseTargetMinutes: sla.responseTargetMinutes,
        escalationDeadlineAt:
          sla.escalationMinutes > 0
            ? new Date(Date.now() + sla.escalationMinutes * 60_000)
            : new Date(),
      },
    });

    const lock = await this.prisma.visitAreaLock.create({
      data: {
        scheduledJobId: input.scheduledJobId,
        employeeId: input.employeeId,
        status: VisitAreaLockStatus.LOCKED,
        lockedAt,
        latitude:
          input.latitude != null ? new Prisma.Decimal(input.latitude) : null,
        longitude:
          input.longitude != null ? new Prisma.Decimal(input.longitude) : null,
        distanceMeters:
          input.distanceMeters != null ? Math.round(input.distanceMeters) : null,
        ecmExceptionId: exception.id,
      },
    });

    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_DETECTED,
      scheduledJobId: input.scheduledJobId,
      ecmExceptionId: exception.id,
      actorUserId: null,
      summary: 'Carer left visit area — operations locked',
      detail: {
        employeeId: input.employeeId,
        lockedAt: lockedAt.toISOString(),
        distanceMeters: input.distanceMeters ?? null,
      },
    });
    await this.alerts.applySlaAndAlert({
      exceptionId: exception.id,
      criticality: job.ecmEvaluation?.criticality ?? 'STANDARD',
      notify: true,
    });
    this.carerPush.notify({
      employeeIds: [input.employeeId],
      kind: CarerVisitPushKind.AREA_PAUSED,
      title: 'Operations paused',
      body: 'You left the visit area. Contact the office to continue.',
      scheduledJobId: input.scheduledJobId,
    });

    return {
      operationsLocked: true,
      lockedAt: lock.lockedAt.toISOString(),
      status: lock.status,
      continueAllowed: false,
      withinArea: false,
      created: true,
    };
  }

  async allowContinue(scheduledJobId: string, adminUserId: string, note?: string) {
    const lock = await this.prisma.visitAreaLock.findFirst({
      where: { scheduledJobId, status: VisitAreaLockStatus.LOCKED },
      orderBy: { lockedAt: 'desc' },
    });
    if (!lock) {
      throw new BadRequestException('This visit is not waiting for an area-lock allow.');
    }

    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { firstName: true, lastName: true, email: true },
    });
    const allowedByName =
      [admin?.firstName, admin?.lastName].filter(Boolean).join(' ').trim() ||
      admin?.email ||
      adminUserId;
    const allowNote = note?.trim() || null;
    const allowedAt = new Date();

    const updated = await this.prisma.visitAreaLock.update({
      where: { id: lock.id },
      data: {
        status: VisitAreaLockStatus.ALLOWED,
        allowedAt,
        allowedById: adminUserId,
        allowedByName,
        allowNote,
      },
    });

    if (lock.ecmExceptionId) {
      await this.prisma.ecmException.update({
        where: { id: lock.ecmExceptionId },
        data: {
          lifecycle: EcmExceptionLifecycle.ACTION_TAKEN,
          resolutionNote: allowNote,
          firstActionAt: allowedAt,
          ownerUserId: adminUserId,
        },
      });
    }

    await this.audit.append({
      eventType: EcmAuditEventType.MANUAL_OVERRIDE,
      scheduledJobId,
      ecmExceptionId: lock.ecmExceptionId,
      actorUserId: adminUserId,
      summary: 'Office allowed carer to continue after leaving visit area',
      detail: {
        allowedByName,
        allowNote,
        lockedAt: lock.lockedAt.toISOString(),
        employeeId: lock.employeeId,
      },
    });
    this.carerPush.notify({
      employeeIds: [lock.employeeId],
      kind: CarerVisitPushKind.AREA_RESUMED,
      title: 'Operations resumed',
      body: 'Office allowed you to continue this visit.',
      scheduledJobId,
    });

    return {
      data: {
        scheduledJobId,
        operationsLocked: false,
        lockedAt: updated.lockedAt.toISOString(),
        allowedAt: updated.allowedAt?.toISOString() ?? allowedAt.toISOString(),
        allowedByName,
        allowNote,
      },
    };
  }
}
