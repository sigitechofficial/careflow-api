import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import { ScheduleLifecycleNotificationHook } from '../schedule-lifecycle-impact/schedule-lifecycle-notification.hook';
import type { ScheduleImpactResult } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import { resolveServiceUserAbsenceJobOutcome } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import {
  removeAutoSkipExceptionsForAbsence,
  syncVisitPlanSkipExceptionsForAbsence,
} from '../service-user-visit-plans/visit-plan-absence-sync.util';
import { CreateServiceUserAbsenceDto, type ServiceUserAbsenceTypeApi } from './dto/create-service-user-absence.dto';
import { UpdateServiceUserAbsenceDto } from './dto/update-service-user-absence.dto';
import {
  assertRetrospectiveReasonWhenBackdated,
  visitPlanTodayUtc,
} from '../service-user-visit-plans/visit-plan-effective-dates.util';
import { ServiceUserVisitPlansService } from '../service-user-visit-plans/service-user-visit-plans.service';
import type { VisitPlanReturnImpactPreviewQueryDto } from '../service-user-visit-plans/dto/visit-plan-impact-preview.dto';

/** Aligns with Prisma `ServiceUserAbsenceType` (generated after `npx prisma generate`). */
type StoredAbsenceType = 'PLANNED' | 'UNPLANNED' | 'NOT_APPLICABLE';

function parseCalendarDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new BadRequestException('Date must be YYYY-MM-DD');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) throw new BadRequestException('Invalid date');
  return dt;
}

function parseOptionalCalendarDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return parseCalendarDate(value);
}

function normalizeOptionalTime(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const t = value.trim();
  const m = /^([01]\d|2[0-3]):[0-5]\d/.exec(t);
  if (!m) throw new BadRequestException('Time must be HH:mm (24h)');
  return m[0];
}

function absenceStartDayUtc(startDate: Date): Date {
  return new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(), 0, 0, 0, 0),
  );
}

function validateAbsenceRetrospectiveReason(startDate: Date, retrospectiveReason?: string | null): string {
  const today = visitPlanTodayUtc();
  try {
    return assertRetrospectiveReasonWhenBackdated(absenceStartDayUtc(startDate), today, retrospectiveReason);
  } catch (e) {
    throw new BadRequestException(e instanceof Error ? e.message : 'Invalid retrospectiveReason');
  }
}

function toAbsenceType(v: ServiceUserAbsenceTypeApi | undefined): StoredAbsenceType {
  if (!v) return 'NOT_APPLICABLE';
  return v;
}

function mapAbsence(row: {
  id: string;
  serviceUserId: string;
  startDate: Date;
  endDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  absenceType: StoredAbsenceType;
  absenceReasonCatalogId: string;
  notes: string;
  contactInformation: string;
  retrospectiveReason: string;
  createdAt: Date;
  updatedAt: Date;
  absenceReasonCatalog: { id: string; name: string; code: string };
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
    startTime: row.startTime,
    endTime: row.endTime,
    absenceType: row.absenceType,
    absenceReasonCatalogId: row.absenceReasonCatalogId,
    reason: { id: row.absenceReasonCatalog.id, name: row.absenceReasonCatalog.name, code: row.absenceReasonCatalog.code },
    notes: row.notes,
    contactInformation: row.contactInformation,
    retrospectiveReason: row.retrospectiveReason ?? '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type SuAbsenceClient = {
  absenceReasonCatalog: { findFirst: (args: { where: { id: string; isActive: boolean } }) => Promise<{ id: string } | null> };
  serviceUserAbsence: {
    findMany: (args: unknown) => Promise<Array<Parameters<typeof mapAbsence>[0]>>;
    create: (args: unknown) => Promise<Parameters<typeof mapAbsence>[0]>;
    findFirst: (args: unknown) => Promise<Parameters<typeof mapAbsence>[0] | null>;
    update: (args: unknown) => Promise<Parameters<typeof mapAbsence>[0]>;
  };
};

@Injectable()
export class ServiceUserAbsencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
    private readonly scheduleNotifications: ScheduleLifecycleNotificationHook,
    @Inject(forwardRef(() => ServiceUserVisitPlansService))
    private readonly visitPlans: ServiceUserVisitPlansService,
  ) {}

  /** New Prisma delegates; remove cast after `npx prisma generate` refreshes the client. */
  private su(): SuAbsenceClient {
    return this.prisma as unknown as SuAbsenceClient;
  }

  private txAbsence(tx: unknown): SuAbsenceClient['serviceUserAbsence'] {
    return (tx as unknown as SuAbsenceClient).serviceUserAbsence;
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private async ensureReasonCatalogId(id: string) {
    const row = await this.su().absenceReasonCatalog.findFirst({ where: { id, isActive: true } });
    if (!row) throw new BadRequestException('Invalid reason for absence');
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const rows = await this.su().serviceUserAbsence.findMany({
      where: { serviceUserId, deletedAt: null },
      include: { absenceReasonCatalog: true },
      orderBy: { startDate: 'desc' },
    });
    return { data: rows.map(mapAbsence) };
  }

  async previewScheduleImpact(serviceUserId: string, query: { startDate: Date; endDate?: Date }) {
    await this.ensureServiceUser(serviceUserId);
    const scheduleImpact = await this.scheduleImpact.previewCancelServiceUserJobsInRange({
      serviceUserId,
      fromDate: query.startDate,
      toDate: query.endDate ?? null,
    });
    return { data: scheduleImpact };
  }

  async previewReturnScheduleImpact(
    serviceUserId: string,
    absenceId: string,
    query: VisitPlanReturnImpactPreviewQueryDto,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const absence = await this.su().serviceUserAbsence.findFirst({
      where: { id: absenceId, serviceUserId, deletedAt: null },
    });
    if (!absence) throw new NotFoundException('Absence not found');
    return this.visitPlans.previewReturnScheduleImpact(serviceUserId, query);
  }

  async create(userId: string, serviceUserId: string, dto: CreateServiceUserAbsenceDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureReasonCatalogId(dto.absenceReasonCatalogId);
    const startDate = parseCalendarDate(dto.startDate);
    const endDate = parseOptionalCalendarDate(dto.endDate);
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('Absence end date cannot be before start date');
    }
    const startTime = normalizeOptionalTime(dto.startTime);
    const endTime = normalizeOptionalTime(dto.endTime);
    const absenceType = toAbsenceType(dto.absenceType);
    const notes = dto.notes?.trim() ?? '';
    const contactInformation = dto.contactInformation?.trim() ?? '';
    const retrospectiveReason = validateAbsenceRetrospectiveReason(startDate, dto.retrospectiveReason);

    return this.prisma.$transaction(async (tx) => {
      const abs = this.txAbsence(tx);
      const created = await abs.create({
        data: {
          serviceUserId,
          startDate,
          endDate: endDate ?? null,
          startTime: startTime ?? null,
          endTime: endTime ?? null,
          absenceType,
          absenceReasonCatalogId: dto.absenceReasonCatalogId,
          notes,
          contactInformation,
          retrospectiveReason,
          createdById: userId,
        },
        include: { absenceReasonCatalog: true },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_ABSENCE_ADDED,
        recordType: 'ServiceUserAbsence',
        recordId: created.id,
        newValues: auditSnapshot(mapAbsence(created)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      let scheduleImpact: ScheduleImpactResult | undefined;
      let planSkipExceptionsAdded = 0;
      if (dto.applyToSchedule !== false) {
        const reasonLabel = created.absenceReasonCatalog?.name ?? 'Service user absence';
        const outcome = resolveServiceUserAbsenceJobOutcome(absenceType, reasonLabel);
        scheduleImpact = await this.scheduleImpact.cancelServiceUserJobsInRange(
          userId,
          {
            serviceUserId,
            fromDate: startDate,
            toDate: endDate ?? null,
            reason: `${reasonLabel}${notes ? `: ${notes}` : ''}`,
            source: 'service_user_absence',
            outcome,
          },
          meta,
          tx,
        );
        const skipSync = await syncVisitPlanSkipExceptionsForAbsence(
          tx,
          serviceUserId,
          startDate,
          endDate ?? null,
          created.id,
          reasonLabel,
        );
        planSkipExceptionsAdded = skipSync.exceptionsAdded;
        if (scheduleImpact) scheduleImpact.planSkipExceptionsAdded = planSkipExceptionsAdded;
      }

      const response = {
        message: 'Absence recorded',
        data: mapAbsence(created),
        ...(scheduleImpact ? { scheduleImpact } : {}),
      };

      if (dto.applyToSchedule !== false && (scheduleImpact?.jobsCancelled || planSkipExceptionsAdded)) {
        void this.scheduleNotifications.notifyBulkScheduleImpact({
          source: 'service_user_absence',
          reason: `${created.absenceReasonCatalog?.name ?? 'Service user absence'}${notes ? `: ${notes}` : ''}`,
          jobsCancelled: scheduleImpact?.jobsCancelled ?? 0,
          jobsUnallocated: 0,
          planSkipExceptionsAdded,
          serviceUserId,
          actorUserId: userId,
        });
      }

      return response;
    });
  }

  async update(
    userId: string,
    serviceUserId: string,
    absenceId: string,
    dto: UpdateServiceUserAbsenceDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    if (dto.absenceReasonCatalogId) await this.ensureReasonCatalogId(dto.absenceReasonCatalogId);

    return this.prisma.$transaction(async (tx) => {
      const abs = this.txAbsence(tx);
      const before = await abs.findFirst({
        where: { id: absenceId, serviceUserId, deletedAt: null },
        include: { absenceReasonCatalog: true },
      });
      if (!before) throw new NotFoundException('Absence not found');

      const startDate = dto.startDate !== undefined ? parseCalendarDate(dto.startDate) : undefined;
      const endDate = dto.endDate !== undefined ? parseOptionalCalendarDate(dto.endDate) : undefined;
      const effectiveStart = startDate ?? before.startDate;
      const effectiveEnd = endDate !== undefined ? endDate : before.endDate;
      if (effectiveEnd && effectiveEnd.getTime() < effectiveStart.getTime()) {
        throw new BadRequestException('Absence end date cannot be before start date');
      }

      const startTime = dto.startTime !== undefined ? normalizeOptionalTime(dto.startTime) : undefined;
      const endTime = dto.endTime !== undefined ? normalizeOptionalTime(dto.endTime) : undefined;
      const notes = dto.notes !== undefined ? dto.notes.trim() : undefined;
      const contactInformation = dto.contactInformation !== undefined ? dto.contactInformation.trim() : undefined;
      const absenceType =
        dto.absenceType !== undefined ? toAbsenceType(dto.absenceType as ServiceUserAbsenceTypeApi) : undefined;

      let retrospectiveReason: string | undefined;
      if (dto.retrospectiveReason !== undefined) {
        retrospectiveReason = dto.retrospectiveReason.trim();
      } else if (startDate !== undefined) {
        retrospectiveReason = validateAbsenceRetrospectiveReason(effectiveStart, before.retrospectiveReason);
      }

      const updated = await abs.update({
        where: { id: absenceId },
        data: {
          ...(startDate !== undefined ? { startDate } : {}),
          ...(endDate !== undefined ? { endDate } : {}),
          ...(startTime !== undefined ? { startTime } : {}),
          ...(endTime !== undefined ? { endTime } : {}),
          ...(absenceType !== undefined ? { absenceType } : {}),
          ...(dto.absenceReasonCatalogId !== undefined ? { absenceReasonCatalogId: dto.absenceReasonCatalogId } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(contactInformation !== undefined ? { contactInformation } : {}),
          ...(retrospectiveReason !== undefined ? { retrospectiveReason } : {}),
          updatedById: userId,
        },
        include: { absenceReasonCatalog: true },
      });
      const oldS = auditSnapshot(mapAbsence(before));
      const newS = auditSnapshot(mapAbsence(updated));
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_ABSENCE_UPDATED,
        recordType: 'ServiceUserAbsence',
        recordId: absenceId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      const effectiveAbsenceType =
        absenceType !== undefined ? absenceType : before.absenceType;
      const reasonLabel =
        updated.absenceReasonCatalog?.name ?? before.absenceReasonCatalog?.name ?? 'Service user absence';

      let scheduleImpact: ScheduleImpactResult | undefined;
      let planSkipExceptionsAdded = 0;
      const shouldApplySchedule = dto.applyToSchedule !== false;
      const datesChanged =
        startDate !== undefined ||
        endDate !== undefined ||
        dto.absenceReasonCatalogId !== undefined ||
        absenceType !== undefined;

      if (shouldApplySchedule && (datesChanged || dto.applyToSchedule === true)) {
        await removeAutoSkipExceptionsForAbsence(tx, absenceId);
        const outcome = resolveServiceUserAbsenceJobOutcome(
          effectiveAbsenceType as 'PLANNED' | 'UNPLANNED' | 'NOT_APPLICABLE',
          reasonLabel,
        );
        scheduleImpact = await this.scheduleImpact.cancelServiceUserJobsInRange(
          userId,
          {
            serviceUserId,
            fromDate: effectiveStart,
            toDate: effectiveEnd ?? null,
            reason: `${reasonLabel}${(notes ?? before.notes) ? `: ${notes ?? before.notes}` : ''}`,
            source: 'service_user_absence',
            outcome,
          },
          meta,
          tx,
        );
        const skipSync = await syncVisitPlanSkipExceptionsForAbsence(
          tx,
          serviceUserId,
          effectiveStart,
          effectiveEnd ?? null,
          absenceId,
          reasonLabel,
        );
        planSkipExceptionsAdded = skipSync.exceptionsAdded;
        if (scheduleImpact) scheduleImpact.planSkipExceptionsAdded = planSkipExceptionsAdded;
      }

      if (shouldApplySchedule && (scheduleImpact?.jobsCancelled || planSkipExceptionsAdded)) {
        void this.scheduleNotifications.notifyBulkScheduleImpact({
          source: 'service_user_absence',
          reason: reasonLabel,
          jobsCancelled: scheduleImpact?.jobsCancelled ?? 0,
          jobsUnallocated: 0,
          planSkipExceptionsAdded,
          serviceUserId,
          actorUserId: userId,
        });
      }

      return {
        message: 'Absence updated',
        data: mapAbsence(updated),
        ...(scheduleImpact ? { scheduleImpact } : {}),
      };
    });
  }

  async remove(userId: string, serviceUserId: string, absenceId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const abs = this.txAbsence(tx);
      const before = await abs.findFirst({
        where: { id: absenceId, serviceUserId, deletedAt: null },
        include: { absenceReasonCatalog: true },
      });
      if (!before) throw new NotFoundException('Absence not found');
      await removeAutoSkipExceptionsForAbsence(tx, absenceId);
      await abs.update({
        where: { id: absenceId },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_ABSENCE_DELETED,
        recordType: 'ServiceUserAbsence',
        recordId: absenceId,
        oldValues: auditSnapshot(mapAbsence(before)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Absence removed', data: {} };
    });
  }
}
