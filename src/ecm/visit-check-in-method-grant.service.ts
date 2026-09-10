import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EcmAuditEventType,
  EcmExceptionKind,
  EcmExceptionLifecycle,
  Prisma,
  VisitCheckInMethodGrantStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAuditService } from './ecm-audit.service';
import { EcmAlertService } from './ecm-alert.service';
import { slaTargetsForCriticality } from './ecm-sla.util';
import { displayUserName } from './carer-sos.util';
import {
  mapVisitCheckInMethodGrant,
  shouldReuseCheckInMethodGrant,
  type VisitCheckInMethodGrantDto,
} from './visit-check-in-method-grant.util';
import { orgHasOptInCheckInMethod } from '../employee-app/employee-app-check-in-methods.util';
import { dayKeyInTimeZone, operationalDayBounds } from '../common/utils/operational-day.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';

export type CreateCheckInMethodRequestInput = {
  scheduledJobId: string;
  employeeId: string;
  note?: string | null;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  isMockedLocation?: boolean;
  locationUnavailable?: boolean;
  withinArea: boolean;
  distanceMeters?: number | null;
  alreadyCheckedIn: boolean;
  visitClosed: boolean;
};

@Injectable()
export class VisitCheckInMethodGrantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EcmAuditService,
    private readonly alerts: EcmAlertService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async getForCarerVisit(
    scheduledJobId: string,
    employeeId: string,
    timeZone: string,
    visitStart: Date,
    now = new Date(),
  ): Promise<VisitCheckInMethodGrantDto | null> {
    const operationalDay = dayKeyInTimeZone(visitStart, timeZone);
    const row = await this.prisma.visitCheckInMethodGrant.findFirst({
      where: { scheduledJobId, employeeId, operationalDay },
      orderBy: { requestedAt: 'desc' },
    });
    if (!row) return null;
    const employeeName = await this.employeeName(employeeId);
    return mapVisitCheckInMethodGrant(row, { employeeName, now });
  }

  async findActiveAuthorised(
    scheduledJobId: string,
    employeeId: string,
    now = new Date(),
  ) {
    const row = await this.prisma.visitCheckInMethodGrant.findFirst({
      where: {
        scheduledJobId,
        employeeId,
        status: VisitCheckInMethodGrantStatus.AUTHORISED,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { decidedAt: 'desc' },
    });
    return row;
  }

  async listForJob(scheduledJobId: string, now = new Date()): Promise<VisitCheckInMethodGrantDto[]> {
    const rows = await this.prisma.visitCheckInMethodGrant.findMany({
      where: { scheduledJobId },
      orderBy: { requestedAt: 'desc' },
    });
    const names = await this.employeeNames(rows.map((row) => row.employeeId));
    return rows.map((row) =>
      mapVisitCheckInMethodGrant(row, {
        employeeName: names.get(row.employeeId) ?? null,
        now,
      }),
    );
  }

  async createRequest(
    input: CreateCheckInMethodRequestInput,
  ): Promise<{ data: VisitCheckInMethodGrantDto; reused: boolean }> {
    if (input.visitClosed) {
      throw new ConflictException({
        code: 'VISIT_COMPLETED',
        message: 'Visit is already closed',
      });
    }
    if (input.alreadyCheckedIn) {
      throw new ConflictException({
        code: 'ALREADY_CHECKED_IN',
        message: 'You are already checked in to this visit.',
      });
    }

    const flags = await this.prisma.organisationGeneralSettings.findFirst({
      select: {
        domCheckInManualEnabled: true,
        domCheckInNfcEnabled: true,
        domCheckInQrEnabled: true,
      },
    });
    if (orgHasOptInCheckInMethod(flags)) {
      throw new ConflictException({
        code: 'OTHER_CHECK_IN_METHODS_ENABLED',
        message: 'Use another check-in method. Office request is only for GPS-only organisations.',
      });
    }

    const hasCoords =
      typeof input.latitude === 'number' &&
      Number.isFinite(input.latitude) &&
      typeof input.longitude === 'number' &&
      Number.isFinite(input.longitude);
    const locationUnavailable = Boolean(input.locationUnavailable) || !hasCoords;
    if (!locationUnavailable && input.withinArea) {
      throw new ConflictException({
        code: 'INSIDE_VISIT_AREA',
        message: 'You are inside the visit area. Clock in with GPS.',
      });
    }

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: input.scheduledJobId, deletedAt: null },
      select: {
        id: true,
        scheduledStartDateTime: true,
        ecmEvaluation: { select: { id: true, criticality: true } },
      },
    });
    if (!job) throw new NotFoundException('Visit not found');

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const operationalDay = dayKeyInTimeZone(job.scheduledStartDateTime, timeZone);
    const { end: expiresAt } = operationalDayBounds(operationalDay, timeZone);

    const existing = await this.prisma.visitCheckInMethodGrant.findFirst({
      where: {
        scheduledJobId: input.scheduledJobId,
        employeeId: input.employeeId,
        operationalDay,
      },
      orderBy: { requestedAt: 'desc' },
    });
    const now = new Date();
    if (existing && shouldReuseCheckInMethodGrant(existing, now)) {
      const employeeName = await this.employeeName(input.employeeId);
      return {
        data: mapVisitCheckInMethodGrant(existing, { employeeName }),
        reused: true,
      };
    }

    const employeeName = (await this.employeeName(input.employeeId)) || 'Carer';
    const carerNote = input.note?.trim() || null;
    const title = `Outside area check-in request — ${employeeName}`;
    const detail = carerNote ?? 'Carer is outside the visit area and asked office to enable Manual check-in.';

    const sla = slaTargetsForCriticality(job.ecmEvaluation?.criticality ?? 'STANDARD');
    const context = {
      employeeId: input.employeeId,
      employeeName,
      note: carerNote,
      latitude: hasCoords ? input.latitude! : null,
      longitude: hasCoords ? input.longitude! : null,
      accuracyMeters:
        typeof input.accuracyMeters === 'number' && Number.isFinite(input.accuracyMeters)
          ? input.accuracyMeters
          : null,
      distanceMeters: input.distanceMeters ?? null,
      isMockedLocation: Boolean(input.isMockedLocation),
      locationUnavailable,
      operationalDay,
    };

    const exception = await this.prisma.ecmException.create({
      data: {
        scheduledJobId: input.scheduledJobId,
        ecmVisitEvaluationId: job.ecmEvaluation?.id ?? null,
        kind: EcmExceptionKind.OUTSIDE_AREA_CHECK_IN_REQUEST,
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

    const grant = await this.prisma.visitCheckInMethodGrant.create({
      data: {
        scheduledJobId: input.scheduledJobId,
        employeeId: input.employeeId,
        operationalDay,
        status: VisitCheckInMethodGrantStatus.PENDING,
        carerNote,
        latitude: hasCoords ? new Prisma.Decimal(input.latitude!) : null,
        longitude: hasCoords ? new Prisma.Decimal(input.longitude!) : null,
        accuracyMeters:
          typeof input.accuracyMeters === 'number' && Number.isFinite(input.accuracyMeters)
            ? new Prisma.Decimal(input.accuracyMeters)
            : null,
        distanceMeters:
          input.distanceMeters != null ? Math.round(input.distanceMeters) : null,
        isMockedLocation: Boolean(input.isMockedLocation),
        locationUnavailable,
        expiresAt,
        ecmExceptionId: exception.id,
      },
    });

    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_DETECTED,
      scheduledJobId: input.scheduledJobId,
      ecmExceptionId: exception.id,
      actorUserId: null,
      summary: title,
      detail: { ...context, grantId: grant.id } as Prisma.InputJsonValue,
    });
    await this.alerts.applySlaAndAlert({
      exceptionId: exception.id,
      criticality: job.ecmEvaluation?.criticality ?? 'STANDARD',
      notify: true,
    });

    return {
      data: mapVisitCheckInMethodGrant(grant, { employeeName }),
      reused: false,
    };
  }

  async authorise(scheduledJobId: string, grantId: string, adminUserId: string, note?: string) {
    const grant = await this.requireGrant(scheduledJobId, grantId);
    if (grant.status !== VisitCheckInMethodGrantStatus.PENDING) {
      throw new BadRequestException({
        code: 'GRANT_NOT_PENDING',
        message: 'This request is not waiting for office authorisation.',
      });
    }
    if (grant.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: 'GRANT_EXPIRED',
        message: 'This request has expired for the visit day.',
      });
    }

    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { firstName: true, lastName: true, email: true },
    });
    const decidedByName = displayUserName(admin) ?? adminUserId;
    const officeNote = note?.trim() || null;
    const decidedAt = new Date();

    const updated = await this.prisma.visitCheckInMethodGrant.update({
      where: { id: grant.id },
      data: {
        status: VisitCheckInMethodGrantStatus.AUTHORISED,
        decidedAt,
        decidedById: adminUserId,
        decidedByName,
        officeNote,
      },
    });

    if (grant.ecmExceptionId) {
      await this.prisma.ecmException.update({
        where: { id: grant.ecmExceptionId },
        data: {
          lifecycle: EcmExceptionLifecycle.ACTION_TAKEN,
          resolutionNote: officeNote,
          firstActionAt: decidedAt,
          ownerUserId: adminUserId,
        },
      });
    }

    await this.audit.append({
      eventType: EcmAuditEventType.MANUAL_OVERRIDE,
      scheduledJobId,
      ecmExceptionId: grant.ecmExceptionId,
      actorUserId: adminUserId,
      summary: 'Office authorised Manual check-in for this visit',
      detail: {
        grantId: grant.id,
        employeeId: grant.employeeId,
        decidedByName,
        officeNote,
        expiresAt: grant.expiresAt.toISOString(),
      },
    });

    const employeeName = await this.employeeName(grant.employeeId);
    return {
      data: mapVisitCheckInMethodGrant(updated, { employeeName }),
    };
  }

  async reject(scheduledJobId: string, grantId: string, adminUserId: string, note?: string) {
    const grant = await this.requireGrant(scheduledJobId, grantId);
    if (grant.status !== VisitCheckInMethodGrantStatus.PENDING) {
      throw new BadRequestException({
        code: 'GRANT_NOT_PENDING',
        message: 'This request is not waiting for office authorisation.',
      });
    }

    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { firstName: true, lastName: true, email: true },
    });
    const decidedByName = displayUserName(admin) ?? adminUserId;
    const officeNote = note?.trim() || null;
    const decidedAt = new Date();

    const updated = await this.prisma.visitCheckInMethodGrant.update({
      where: { id: grant.id },
      data: {
        status: VisitCheckInMethodGrantStatus.REJECTED,
        decidedAt,
        decidedById: adminUserId,
        decidedByName,
        officeNote,
      },
    });

    if (grant.ecmExceptionId) {
      await this.prisma.ecmException.update({
        where: { id: grant.ecmExceptionId },
        data: {
          lifecycle: EcmExceptionLifecycle.RESOLVED,
          reasonCode: 'OFFICE_REJECTED',
          resolutionNote: officeNote,
          resolvedAt: decidedAt,
          resolvedById: adminUserId,
          firstActionAt: decidedAt,
          ownerUserId: adminUserId,
        },
      });
      await this.prisma.ecmException.update({
        where: { id: grant.ecmExceptionId },
        data: {
          lifecycle: EcmExceptionLifecycle.CLOSED,
          closedAt: decidedAt,
          closedById: adminUserId,
        },
      });
    }

    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_RESOLVED,
      scheduledJobId,
      ecmExceptionId: grant.ecmExceptionId,
      actorUserId: adminUserId,
      summary: 'Office rejected outside-area Manual check-in request',
      detail: {
        grantId: grant.id,
        employeeId: grant.employeeId,
        decidedByName,
        officeNote,
      },
    });

    const employeeName = await this.employeeName(grant.employeeId);
    return {
      data: mapVisitCheckInMethodGrant(updated, { employeeName }),
    };
  }

  async consumeOnSuccessfulCheckIn(scheduledJobId: string, employeeId: string) {
    const now = new Date();
    const open = await this.prisma.visitCheckInMethodGrant.findMany({
      where: {
        scheduledJobId,
        employeeId,
        status: VisitCheckInMethodGrantStatus.AUTHORISED,
        consumedAt: null,
      },
    });
    if (open.length === 0) return;

    for (const grant of open) {
      await this.prisma.visitCheckInMethodGrant.update({
        where: { id: grant.id },
        data: {
          status: VisitCheckInMethodGrantStatus.CONSUMED,
          consumedAt: now,
        },
      });
      if (!grant.ecmExceptionId) continue;
      const exception = await this.prisma.ecmException.findUnique({
        where: { id: grant.ecmExceptionId },
      });
      if (!exception || exception.lifecycle === EcmExceptionLifecycle.CLOSED) continue;
      await this.prisma.ecmException.update({
        where: { id: exception.id },
        data: {
          lifecycle: EcmExceptionLifecycle.RESOLVED,
          reasonCode: 'CHECK_IN_COMPLETED',
          resolutionNote: exception.resolutionNote ?? 'Carer checked in after office authorisation.',
          resolvedAt: now,
        },
      });
      await this.prisma.ecmException.update({
        where: { id: exception.id },
        data: {
          lifecycle: EcmExceptionLifecycle.CLOSED,
          closedAt: now,
        },
      });
    }
  }

  private async requireGrant(scheduledJobId: string, grantId: string) {
    const grant = await this.prisma.visitCheckInMethodGrant.findFirst({
      where: { id: grantId, scheduledJobId },
    });
    if (!grant) throw new NotFoundException('Check-in method request not found');
    return grant;
  }

  private async employeeName(employeeId: string): Promise<string | null> {
    const names = await this.employeeNames([employeeId]);
    return names.get(employeeId) ?? null;
  }

  private async employeeNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true } },
      },
    });
    return new Map(
      employees.map((employee) => {
        const name = [
          employee.personalDetail?.firstName,
          employee.personalDetail?.lastName,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
        return [employee.id, name || employee.id];
      }),
    );
  }
}
