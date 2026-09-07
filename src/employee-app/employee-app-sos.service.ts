import { Injectable } from '@nestjs/common';
import {
  EcmAuditEventType,
  EcmExceptionKind,
  EcmExceptionLifecycle,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAlertService } from '../ecm/ecm-alert.service';
import { EcmAuditService } from '../ecm/ecm-audit.service';
import { slaTargetsForCriticality } from '../ecm/ecm-sla.util';
import {
  displayUserName,
  mapCarerSosAlert,
  parseCarerSosContext,
  type CarerSosAlertDto,
  type CarerSosContext,
} from '../ecm/carer-sos.util';
import type { EmployeeAppSosDto } from './dto/employee-app-sos.dto';

const IDEMPOTENCY_WINDOW_MS = 30_000;

@Injectable()
export class EmployeeAppSosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EcmAuditService,
    private readonly alerts: EcmAlertService,
  ) {}

  async listForJob(scheduledJobId: string): Promise<CarerSosAlertDto[]> {
    const rows = await this.prisma.ecmException.findMany({
      where: { scheduledJobId, kind: EcmExceptionKind.CARER_SOS },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        detail: true,
        lifecycle: true,
        createdAt: true,
        context: true,
        acknowledgedAt: true,
        acknowledgedById: true,
      },
    });
    const names = await this.userNames(
      rows.map((row) => row.acknowledgedById).filter((id): id is string => Boolean(id)),
    );
    return rows.map((row) =>
      mapCarerSosAlert(row, {
        acknowledgedByName: row.acknowledgedById
          ? names.get(row.acknowledgedById) ?? null
          : null,
      }),
    );
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(
      users.map((user) => [user.id, displayUserName(user) ?? user.id]),
    );
  }

  async send(
    employeeId: string,
    scheduledJobId: string,
    dto: EmployeeAppSosDto,
  ): Promise<{ data: CarerSosAlertDto; reused: boolean }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        personalDetail: { select: { firstName: true, lastName: true } },
      },
    });
    const employeeName =
      [employee?.personalDetail?.firstName, employee?.personalDetail?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Carer';

    const idempotencyKey = dto.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.findRecentDuplicate(scheduledJobId, idempotencyKey);
      if (existing) {
        return { data: mapCarerSosAlert(existing), reused: true };
      }
    }

    const hasCoords =
      typeof dto.latitude === 'number' &&
      Number.isFinite(dto.latitude) &&
      typeof dto.longitude === 'number' &&
      Number.isFinite(dto.longitude);
    const locationUnavailable = Boolean(dto.locationUnavailable) || !hasCoords;
    const message = dto.message?.trim() || null;

    const context: CarerSosContext = {
      employeeId,
      employeeName,
      message,
      latitude: hasCoords ? dto.latitude! : null,
      longitude: hasCoords ? dto.longitude! : null,
      accuracyMeters:
        typeof dto.accuracyMeters === 'number' && Number.isFinite(dto.accuracyMeters)
          ? dto.accuracyMeters
          : null,
      isMockedLocation: Boolean(dto.isMockedLocation),
      locationUnavailable,
      idempotencyKey,
      deviceRecordedAt: dto.deviceRecordedAt?.trim() || null,
    };

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null },
      select: { ecmEvaluation: { select: { id: true } } },
    });

    const sla = slaTargetsForCriticality('PRIORITY');
    const title = `Carer SOS — ${employeeName}`;
    const detail = message ?? 'No message';

    const exception = await this.prisma.ecmException.create({
      data: {
        scheduledJobId,
        ecmVisitEvaluationId: job?.ecmEvaluation?.id ?? null,
        kind: EcmExceptionKind.CARER_SOS,
        lifecycle: EcmExceptionLifecycle.DETECTED,
        title,
        detail,
        context: context as Prisma.InputJsonValue,
        responseTargetMinutes: sla.responseTargetMinutes,
        escalationDeadlineAt:
          sla.escalationMinutes > 0
            ? new Date(Date.now() + sla.escalationMinutes * 60_000)
            : new Date(),
      },
    });

    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_DETECTED,
      scheduledJobId,
      ecmExceptionId: exception.id,
      actorUserId: null,
      summary: title,
      detail: context as Prisma.InputJsonValue,
    });

    await this.alerts.applySlaAndAlert({
      exceptionId: exception.id,
      criticality: 'PRIORITY',
      notify: true,
    });

    return { data: mapCarerSosAlert(exception), reused: false };
  }

  private async findRecentDuplicate(scheduledJobId: string, idempotencyKey: string) {
    const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
    const recent = await this.prisma.ecmException.findMany({
      where: {
        scheduledJobId,
        kind: EcmExceptionKind.CARER_SOS,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return (
      recent.find((row) => parseCarerSosContext(row.context).idempotencyKey === idempotencyKey) ??
      null
    );
  }
}
