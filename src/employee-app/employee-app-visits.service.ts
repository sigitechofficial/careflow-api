import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  InitialAssessmentRiskStatus,
  InitialAssessmentRiskType,
  MedicationAdministrationStatus,
  MedicationKind,
  MedicationRecordStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduledJobsHousekeepingService } from '../scheduled-jobs-housekeeping/scheduled-jobs-housekeeping.service';
import { SaveVisitJobTasksDto } from '../scheduled-jobs-housekeeping/dto/save-visit-job-tasks.dto';
import { BodyMapService } from '../body-map/body-map.service';
import { VisitAttendanceService } from '../visit-attendance/visit-attendance.service';
import { EcmEvaluationService } from '../ecm/ecm-evaluation.service';
import { resolveJobMedicationRoundCode } from '../scheduled-jobs-housekeeping/visit-job-tasks.util';
import { activeServiceUserFlashMessageWhere } from '../service-user-flash-messages/active-flash-message.util';
import { CreateServiceUserObservationDto } from '../service-user-observations/dto/create-service-user-observation.dto';
import { validateObservationCreate } from '../service-user-observations/observation-payload.validation';
import { utcDayBounds } from '../scheduling/schedule-date-range.util';
import { deriveJobStatusFromVisits } from '../scheduling/scheduling-job-status.util';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import type { EmployeeAppVisitCheckInDto } from './dto/employee-app-visit-check-in.dto';
import type { EmployeeAppVisitCompleteDto } from './dto/employee-app-visit-complete.dto';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const EXCLUDED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.DRAFT,
];

const OPTIONAL_TASK_PRIORITIES = new Set(['optional', 'low', 'nice_to_have']);

const SUGGESTED_OBSERVATIONS = [
  { id: 'blood_glucose', label: 'Blood glucose', observationTypeCode: 'BLOOD_SUGAR' },
  { id: 'fluid_intake', label: 'Fluid intake', observationTypeCode: 'FLUID_MONITOR' },
  { id: 'repositioning', label: 'Repositioning', observationTypeCode: 'REPOSITIONING' },
  { id: 'mood_wellbeing', label: 'Mood & wellbeing', observationTypeCode: 'WELLBEING' },
  { id: 'skin_body_map', label: 'Skin / body map', observationTypeCode: 'INFECTION' },
] as const;

type Tone = 'danger' | 'warning' | 'primary' | 'success' | 'neutral';

type VisitJobRow = Prisma.ScheduledJobGetPayload<{
  include: {
    serviceUser: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        preferredName: true;
        dateOfBirth: true;
        address: {
          select: {
            addressLine1: true;
            addressLine2: true;
            town: true;
            county: true;
            postcode: true;
            latitude: true;
            longitude: true;
            deletedAt: true;
          };
        };
      };
    };
    visits: {
      where: { deletedAt: null; isActive: true };
      orderBy: { scheduledStartDateTime: 'asc' };
      select: {
        id: true;
        visitName: true;
        status: true;
        scheduledStartDateTime: true;
        scheduledEndDateTime: true;
        actualStartDateTime: true;
        actualEndDateTime: true;
        medicationRequired: true;
        notes: true;
        visitPlanSlot: { select: { slotCode: true; medicationRoundCode: true } };
      };
    };
    allocations: {
      where: { deletedAt: null; isActive: true };
      select: {
        id: true;
        status: true;
        employeeId: true;
        employee: {
          select: {
            id: true;
            personalDetail: { select: { firstName: true; lastName: true } };
          };
        };
      };
    };
  };
}>;

@Injectable()
export class EmployeeAppVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly housekeeping: ScheduledJobsHousekeepingService,
    private readonly bodyMap: BodyMapService,
    private readonly attendance: VisitAttendanceService,
    private readonly ecmEvaluation: EcmEvaluationService,
  ) {}

  async getWorkspace(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const [progress, overviewExtras, medProgress] = await Promise.all([
      this.resolveProgress(ctx),
      this.loadOverviewExtras(ctx),
      this.resolveMedicationProgress(ctx),
    ]);

    return {
      data: {
        shell: {
          ...this.buildShell(ctx, progress, medProgress, employeeId),
          allergies: overviewExtras.allergies,
          flags: overviewExtras.flags,
        },
        tabs: this.workspaceTabs(),
        overview: overviewExtras,
      },
    };
  }

  /**
   * Bootstrap snapshot for the complete visit workspace. Tab-specific endpoints
   * remain available for lightweight refreshes after the initial load.
   */
  async getVisitDetails(employeeId: string, jobId: string) {
    const [workspace, tasks, medication, observations, log, bodyMap] =
      await Promise.all([
        this.getWorkspace(employeeId, jobId),
        this.getTasks(employeeId, jobId),
        this.getMedication(employeeId, jobId),
        this.getObservations(employeeId, jobId),
        this.getLog(employeeId, jobId),
        this.getBodyMap(employeeId, jobId),
      ]);

    return {
      data: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        jobId,
        shell: workspace.data.shell,
        tabs: workspace.data.tabs,
        overview: workspace.data.overview,
        tasks: tasks.data,
        medication: medication.data,
        observations: observations.data,
        log: log.data,
        bodyMap: bodyMap.data,
      },
    };
  }

  async checkIn(employeeId: string, jobId: string, dto: EmployeeAppVisitCheckInDto) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const visit = ctx.primaryVisit;

    if (
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF
    ) {
      throw new BadRequestException('Visit is already closed');
    }

    const now = new Date();
    const geofence = await this.evaluateGeofence(ctx, dto.latitude, dto.longitude);

    await this.attendance.assertGeofencePolicy({
      outsideGeofence: !geofence.withinArea,
      outsideGeofenceReason: dto.outsideGeofenceReason,
      restrictOutside: geofence.restrictOutside,
    });

    const checkInPayload = {
      clientEventId: dto.clientEventId ?? null,
      deviceCapturedAt: dto.deviceCapturedAt ?? now.toISOString(),
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      accuracyMeters: dto.accuracyMeters ?? null,
      isMockLocation: dto.isMockLocation ?? false,
      outsideGeofence: !geofence.withinArea,
      outsideGeofenceReason: dto.outsideGeofenceReason?.trim() ?? null,
      identityConfirmed: dto.identityConfirmed ?? false,
      checkedInAt: now.toISOString(),
      employeeId,
      distanceMeters: geofence.distanceMeters,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.update({
        where: { id: visit.id },
        data: {
          status: ScheduledVisitStatus.STARTED,
          actualStartDateTime: visit.actualStartDateTime ?? now,
        },
      });
      const visits = await tx.scheduledVisit.findMany({
        where: { scheduledJobId: jobId, deletedAt: null, isActive: true },
        select: { status: true },
      });
      const jobRow = await tx.scheduledJob.findUnique({ where: { id: jobId } });
      if (jobRow) {
        const nextStatus = deriveJobStatusFromVisits(visits, jobRow.status);
        if (nextStatus !== jobRow.status) {
          await tx.scheduledJob.update({
            where: { id: jobId },
            data: { status: nextStatus },
          });
        }
      }

      const previousMeta = this.parseMetadata(ctx.job.metadata);
      const employeeApp = {
        ...(typeof previousMeta.employeeApp === 'object' && previousMeta.employeeApp
          ? (previousMeta.employeeApp as Record<string, unknown>)
          : {}),
        checkIn: checkInPayload,
        identityConfirmed: checkInPayload.identityConfirmed,
      };
      await tx.scheduledJob.update({
        where: { id: jobId },
        data: {
          metadata: { ...previousMeta, employeeApp } as Prisma.InputJsonValue,
        },
      });
    });

    await this.attendance.recordEvent({
      scheduledJobId: jobId,
      scheduledVisitId: visit.id,
      jobAllocationId: ctx.allocationId,
      employeeId,
      eventType: VisitAttendanceEventType.CHECK_IN,
      verificationMethod: VisitAttendanceVerificationMethod.MOBILE_GPS,
      occurredAt: now,
      deviceCapturedAt: dto.deviceCapturedAt ? new Date(dto.deviceCapturedAt) : now,
      clientEventId: dto.clientEventId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyMeters: dto.accuracyMeters,
      isMockLocation: dto.isMockLocation ?? false,
      outsideGeofence: !geofence.withinArea,
      outsideGeofenceReason: dto.outsideGeofenceReason,
      distanceMeters: geofence.distanceMeters,
      identityConfirmed: dto.identityConfirmed ?? false,
    });

    await this.ecmEvaluation.evaluateJobSafe(jobId);

    const refreshed = await this.loadJobForEmployee(employeeId, jobId);
    const progress = await this.resolveProgress(refreshed);

    return {
      data: {
        message: 'Checked in to visit',
        shell: this.buildShell(refreshed, progress, undefined, employeeId),
      },
    };
  }

  async getTasks(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const raw = await this.housekeeping.getVisitJobTasks('', jobId);
    const progress = await this.resolveProgress(ctx);
    const medProgress = await this.resolveMedicationProgress(ctx);

    const tasks = (raw.data.tasks as Array<Record<string, unknown>>).map((task) => {
      const name = String(task.name ?? '');
      const moduleLink = resolveTaskModuleLink(
        name,
        String(task.groupCode ?? ''),
        ctx.primaryVisit.medicationRequired,
      );
      const priority = String(task.priority ?? 'routine');
      const isRequired = !OPTIONAL_TASK_PRIORITIES.has(priority.toLowerCase());
      const isCompleted = Boolean(task.isCompleted);
      const completedAt = task.completedAt ? String(task.completedAt) : null;

      let subtext: string | null = null;
      if (moduleLink?.id === 'emar') {
        subtext = `${medProgress.givenCount} of ${medProgress.dueCount} medicines given`;
      } else if (task.recordedValue) {
        subtext = String(task.recordedValue);
      } else if (task.notes) {
        subtext = String(task.notes);
      }

      return {
        assignmentId: task.assignmentId,
        taskCatalogueTaskId: task.taskCatalogueTaskId,
        name,
        categoryName: task.categoryName,
        groupCode: task.groupCode,
        priority,
        isRequired,
        isExtra: Boolean(task.isExtra),
        isCompleted,
        completedAt,
        completedLabel: completedAt ? `Completed · ${formatHmUtc(new Date(completedAt))}` : null,
        recordedValue: task.recordedValue ?? null,
        notes: task.notes ?? null,
        completionInput: task.completionInput,
        carerInstructions: task.carerInstructions ?? null,
        iconType: iconForTaskGroup(String(task.groupCode ?? '')),
        moduleLink,
        subtext,
      };
    });

    const required = tasks.filter((t) => t.isRequired);
    const optional = tasks.filter((t) => !t.isRequired);

    return {
      data: {
        progress: this.buildProgress(progress, medProgress),
        medicationRoundCode: raw.data.medicationRoundCode,
        roundLabel: raw.data.roundLabel,
        windowStart: raw.data.windowStart,
        windowEnd: raw.data.windowEnd,
        requiredTasks: required,
        optionalTasks: optional,
        tasks,
      },
    };
  }

  async saveTasks(employeeId: string, jobId: string, dto: SaveVisitJobTasksDto) {
    await this.loadJobForEmployee(employeeId, jobId);
    const result = await this.housekeeping.saveVisitJobTasks('', jobId, dto);

    await this.prisma.scheduledVisitTaskCompletion.updateMany({
      where: { scheduledJobId: jobId, isCompleted: true },
      data: { completedById: employeeId },
    });

    return this.getTasks(employeeId, jobId);
  }

  async getMedication(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const [allergies, sections, progress, medProgress] = await Promise.all([
      this.loadAllergies(ctx.job.serviceUserId),
      this.loadVisitMedicationSections(ctx),
      this.resolveProgress(ctx),
      this.resolveMedicationProgress(ctx),
    ]);

    return {
      data: {
        progress: this.buildProgress(progress, medProgress),
        banner: {
          tone: 'primary' as Tone,
          message: 'Electronic MAR — record every scheduled medicine before clock-out.',
        },
        allergies: {
          tone: 'danger' as Tone,
          label: 'ALLERGIES',
          items: allergies,
        },
        sections,
      },
    };
  }

  async getObservations(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const since = ctx.primaryVisit.actualStartDateTime ?? ctx.primaryVisit.scheduledStartDateTime;
    const [progress, medProgress, recorded] = await Promise.all([
      this.resolveProgress(ctx),
      this.resolveMedicationProgress(ctx),
      this.loadVisitObservations(ctx.job.serviceUserId, since),
    ]);

    return {
      data: {
        progress: this.buildProgress(progress, medProgress),
        suggested: SUGGESTED_OBSERVATIONS.map((s) => ({ ...s })),
        emergencyProtocol: {
          id: 'medical_emergency',
          title: 'Medical emergency — launch protocol',
          description: 'Collapse, choking or acute deterioration.',
          tone: 'danger' as Tone,
        },
        recordedThisVisit: recorded,
        recordedCount: recorded.length,
      },
    };
  }

  async createObservation(
    employeeId: string,
    jobId: string,
    dto: CreateServiceUserObservationDto,
  ) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const type = await this.prisma.observationType.findFirst({
      where: { code: dto.observationTypeCode.toUpperCase(), isActive: true },
    });
    if (!type) throw new BadRequestException('Invalid observation type');
    validateObservationCreate(type.code, type.valueKind, dto);

    const recordedAt = new Date(dto.recordedAt);
    if (Number.isNaN(recordedAt.getTime())) {
      throw new BadRequestException('recordedAt must be a valid ISO date-time');
    }

    const shareCodes = (dto.shareTargetCodes ?? []).map((c) => c.toUpperCase());
    const shareTargets =
      shareCodes.length > 0
        ? await this.prisma.observationShareTarget.findMany({
            where: { code: { in: shareCodes }, isActive: true },
          })
        : [];
    if (shareCodes.length > 0 && shareTargets.length !== shareCodes.length) {
      throw new BadRequestException('One or more share targets are invalid');
    }

    const row = await this.prisma.serviceUserObservation.create({
      data: {
        serviceUserId: ctx.job.serviceUserId,
        observationTypeId: type.id,
        recordedAt,
        notes: dto.notes?.trim() ?? null,
        numericValue: dto.numericValue ?? null,
        unit: dto.unit?.trim() ?? type.unitLabel ?? null,
        payload: {
          ...(dto.payload ?? {}),
          scheduledJobId: jobId,
          scheduledVisitId: ctx.primaryVisit.id,
        } as Prisma.InputJsonValue,
        recordedByEmployeeId: employeeId,
        shares:
          shareTargets.length > 0
            ? { create: shareTargets.map((t) => ({ shareTargetId: t.id })) }
            : undefined,
      },
      include: {
        observationType: true,
      },
    });

    return {
      data: {
        id: row.id,
        observationTypeCode: row.observationType.code,
        observationTypeName: row.observationType.name,
        recordedAt: row.recordedAt.toISOString(),
        valueLabel: formatObservationValue(row),
        statusLabel: inferObservationStatus(row.observationType.code, row.numericValue, row.payload),
        tone: 'success' as Tone,
      },
    };
  }

  async getLog(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const since = ctx.primaryVisit.actualStartDateTime ?? ctx.primaryVisit.scheduledStartDateTime;
    const [progress, medProgress, timeline, handoverNote] = await Promise.all([
      this.resolveProgress(ctx),
      this.resolveMedicationProgress(ctx),
      this.buildVisitTimeline(ctx, since),
      this.resolveHandoverNote(ctx),
    ]);

    return {
      data: {
        progress: this.buildProgress(progress, medProgress),
        timeline,
        incidents: {
          title: 'INCIDENTS',
          reportLabel: 'Report an incident',
          description: 'Falls, medication errors, safeguarding concerns.',
        },
        handoverNote,
      },
    };
  }

  async getBodyMap(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const handover = await this.bodyMap.handoverPreview(ctx.job.serviceUserId);
    const progress = await this.resolveProgress(ctx);
    const medProgress = await this.resolveMedicationProgress(ctx);

    return {
      data: {
        progress: this.buildProgress(progress, medProgress),
        handover,
      },
    };
  }

  async complete(employeeId: string, jobId: string, dto: EmployeeAppVisitCompleteDto) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);

    const notes = dto.handoverNote?.trim() || dto.notes?.trim() || undefined;
    const result = await this.housekeeping.completeJob('', jobId, {
      status: dto.status,
      notes,
      deliveredCarePlanFormIds: dto.deliveredCarePlanFormIds,
      deliveredCarePlanDetails: dto.deliveredCarePlanDetails,
      extraCareNotes: dto.extraCareNotes,
      actualStartDateTime: dto.actualStartDateTime,
      actualEndDateTime: dto.actualEndDateTime,
      overrunReason: dto.overrunReason,
    });

    const now = new Date();
    const hasGps = dto.latitude != null && dto.longitude != null;
    const geofence = hasGps
      ? await this.evaluateGeofence(ctx, dto.latitude, dto.longitude)
      : { withinArea: true, distanceMeters: null as number | null };

    if (hasGps) {
      const job = await this.prisma.scheduledJob.findUnique({
        where: { id: jobId },
        select: { metadata: true },
      });
      const previousMeta = this.parseMetadata(job?.metadata);
      const employeeApp = {
        ...(typeof previousMeta.employeeApp === 'object' && previousMeta.employeeApp
          ? (previousMeta.employeeApp as Record<string, unknown>)
          : {}),
        checkOut: {
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyMeters: dto.accuracyMeters ?? null,
          completedAt: now.toISOString(),
          employeeId,
          outsideGeofence: !geofence.withinArea,
          distanceMeters: geofence.distanceMeters,
        },
      };
      await this.prisma.scheduledJob.update({
        where: { id: jobId },
        data: {
          metadata: { ...previousMeta, employeeApp } as Prisma.InputJsonValue,
        },
      });
    }

    await this.attendance.recordEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      jobAllocationId: ctx.allocationId,
      employeeId,
      eventType: VisitAttendanceEventType.CHECK_OUT,
      verificationMethod: VisitAttendanceVerificationMethod.MOBILE_GPS,
      occurredAt: now,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyMeters: dto.accuracyMeters,
      outsideGeofence: !geofence.withinArea,
      distanceMeters: geofence.distanceMeters,
    });

    await this.ecmEvaluation.evaluateJobSafe(jobId);

    return {
      data: {
        message: result.message,
        job: result.data,
      },
    };
  }

  private workspaceTabs() {
    return [
      { id: 'overview', label: 'Overview' },
      { id: 'tasks', label: 'Tasks' },
      { id: 'mar', label: 'MAR' },
      { id: 'obs', label: 'Obs' },
      { id: 'log', label: 'Log' },
    ];
  }

  private async loadJobForEmployee(employeeId: string, jobId: string): Promise<{
    job: VisitJobRow;
    primaryVisit: VisitJobRow['visits'][number];
    medicationRoundCode: string | null;
    employeeAppMeta: Record<string, unknown>;
    checkIn: Record<string, unknown> | null;
    identityConfirmed: boolean;
    allocationId: string | null;
  }> {
    const job = await this.prisma.scheduledJob.findFirst({
      where: {
        id: jobId,
        deletedAt: null,
        isActive: true,
        status: { notIn: EXCLUDED_JOB_STATUSES },
        allocations: {
          some: {
            employeeId,
            deletedAt: null,
            isActive: true,
            status: { in: ACTIVE_ALLOCATION },
          },
        },
      },
      include: {
        serviceUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            dateOfBirth: true,
            address: {
              select: {
                addressLine1: true,
                addressLine2: true,
                town: true,
                county: true,
                postcode: true,
                latitude: true,
                longitude: true,
                deletedAt: true,
              },
            },
          },
        },
        visits: {
          where: { deletedAt: null, isActive: true },
          orderBy: { scheduledStartDateTime: 'asc' },
          select: {
            id: true,
            visitName: true,
            status: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            actualStartDateTime: true,
            actualEndDateTime: true,
            medicationRequired: true,
            notes: true,
            visitPlanSlot: { select: { slotCode: true, medicationRoundCode: true } },
          },
        },
        allocations: {
          where: { deletedAt: null, isActive: true },
          select: {
            id: true,
            status: true,
            employeeId: true,
            employee: {
              select: {
                id: true,
                personalDetail: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    if (!job) {
      const exists = await this.prisma.scheduledJob.findFirst({
        where: { id: jobId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (exists) throw new ForbiddenException('You are not allocated to this visit');
      throw new NotFoundException('Visit not found');
    }

    const primaryVisit = job.visits[0];
    if (!primaryVisit) throw new BadRequestException('Visit has no scheduled visit rows');

    const metadata = this.parseMetadata(job.metadata);
    const employeeAppMeta =
      typeof metadata.employeeApp === 'object' && metadata.employeeApp
        ? (metadata.employeeApp as Record<string, unknown>)
        : {};
    const checkIn =
      typeof employeeAppMeta.checkIn === 'object' && employeeAppMeta.checkIn
        ? (employeeAppMeta.checkIn as Record<string, unknown>)
        : null;

    const allocationId =
      job.allocations.find((a) => a.employeeId === employeeId)?.id ?? null;

    return {
      job,
      primaryVisit,
      medicationRoundCode: resolveJobMedicationRoundCode(job.visits),
      employeeAppMeta,
      checkIn,
      identityConfirmed: Boolean(employeeAppMeta.identityConfirmed ?? checkIn?.identityConfirmed),
      allocationId,
    };
  }

  private buildShell(
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    progress: Awaited<ReturnType<typeof this.resolveProgress>>,
    medProgress?: { dueCount: number; givenCount: number },
    employeeId?: string,
  ) {
    const su = ctx.job.serviceUser;
    const visit = ctx.primaryVisit;
    const fullName = displayName(su.firstName, su.lastName);
    const scheduledStart = formatHmUtc(visit.scheduledStartDateTime);
    const scheduledEnd = visit.scheduledEndDateTime
      ? formatHmUtc(visit.scheduledEndDateTime)
      : null;
    const checkedInAt =
      visit.actualStartDateTime ??
      (ctx.checkIn?.checkedInAt ? new Date(String(ctx.checkIn.checkedInAt)) : null);
    const isCheckedIn =
      visit.status === ScheduledVisitStatus.STARTED ||
      Boolean(visit.actualStartDateTime);

    const geofence = this.evaluateGeofenceFromMeta(ctx);

    return {
      jobId: ctx.job.id,
      visitId: visit.id,
      clientId: su.id,
      client: {
        name: fullName,
        initials: initialsFromName(su.firstName, su.lastName),
        dateOfBirth: su.dateOfBirth ? formatDob(su.dateOfBirth) : null,
        dateOfBirthIso: su.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      },
      visitWindow: {
        scheduledStart,
        scheduledEnd,
        label:
          scheduledEnd != null ? `${scheduledStart}–${scheduledEnd}` : scheduledStart,
        scheduledStartIso: visit.scheduledStartDateTime.toISOString(),
        scheduledEndIso: visit.scheduledEndDateTime?.toISOString() ?? null,
      },
      visitName: visit.visitName,
      status: mapUiStatus(ctx.job.status, visit.status),
      identityConfirmed: ctx.identityConfirmed,
      identityBadge: ctx.identityConfirmed ? { label: 'ID', tone: 'success' as Tone } : null,
      isCheckedIn,
      checkedInAt: checkedInAt?.toISOString() ?? null,
      checkedInLabel: checkedInAt ? `In ${formatHmUtc(checkedInAt)}` : null,
      progress: this.buildProgress(progress, medProgress),
      location: geofence,
      coCarers: ctx.job.allocations
        .filter((a) => ACTIVE_ALLOCATION.includes(a.status))
        .map((a) => ({
          employeeId: a.employeeId,
          name: displayName(
            a.employee.personalDetail?.firstName,
            a.employee.personalDetail?.lastName,
          ),
          isYou: employeeId ? a.employeeId === employeeId : false,
        })),
      requiredCarers: ctx.job.requiredCarers,
    };
  }

  private buildProgress(
    progress: { tasksDone: number; tasksTotal: number; obsCount?: number },
    medProgress?: { dueCount: number; givenCount: number },
  ) {
    const tasksPercent =
      progress.tasksTotal === 0
        ? 0
        : Math.round((progress.tasksDone / progress.tasksTotal) * 100);
    return {
      tasksDone: progress.tasksDone,
      tasksTotal: progress.tasksTotal,
      tasksLabel: `${progress.tasksDone}/${progress.tasksTotal} done`,
      tasksPercent,
      medsDone: medProgress?.givenCount ?? 0,
      medsTotal: medProgress?.dueCount ?? 0,
      medsLabel:
        medProgress != null
          ? `${medProgress.givenCount}/${medProgress.dueCount}`
          : '0/0',
      obsCount: progress.obsCount ?? 0,
    };
  }

  private async resolveProgress(ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>) {
    const [taskRaw, obsCount] = await Promise.all([
      this.housekeeping.getVisitJobTasks('', ctx.job.id).catch(() => ({
        data: { tasks: [] as unknown[] },
      })),
      this.countVisitObservations(
        ctx.job.serviceUserId,
        ctx.primaryVisit.actualStartDateTime ?? ctx.primaryVisit.scheduledStartDateTime,
      ),
    ]);

    const tasks = (taskRaw.data.tasks as Array<{ isCompleted?: boolean }>) ?? [];
    const tasksDone = tasks.filter((t) => t.isCompleted).length;
    const tasksTotal = tasks.length;

    return { tasksDone, tasksTotal, obsCount };
  }

  private async resolveMedicationProgress(ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>) {
    const visitDate = formatScheduleDate(ctx.primaryVisit.scheduledStartDateTime);
    const { start, end } = utcDayBounds(visitDate);
    const roundCode = ctx.medicationRoundCode;
    if (!roundCode) return { dueCount: 0, givenCount: 0 };

    const round = await this.prisma.medicationAdministrationRound.findFirst({
      where: { code: roundCode, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!round) return { dueCount: 0, givenCount: 0 };

    const meds = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId: ctx.job.serviceUserId,
        deletedAt: null,
        isActive: true,
        status: MedicationRecordStatus.ACTIVE,
        medicationKind: { not: MedicationKind.PRN },
        schedules: {
          some: {
            deletedAt: null,
            isActive: true,
            round: { code: roundCode },
          },
        },
      },
      select: { id: true },
    });

    const dueCount = meds.length;
    if (dueCount === 0) return { dueCount: 0, givenCount: 0 };

    const givenCount = await this.prisma.medicationAdministrationEvent.count({
      where: {
        serviceUserId: ctx.job.serviceUserId,
        deletedAt: null,
        roundId: round.id,
        status: MedicationAdministrationStatus.GIVEN,
        OR: [
          { scheduledDateTime: { gte: start, lte: end } },
          { actualDateTime: { gte: start, lte: end } },
        ],
        serviceUserMedicationId: { in: meds.map((m) => m.id) },
      },
    });

    return { dueCount, givenCount };
  }

  private async loadOverviewExtras(ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>) {
    const suId = ctx.job.serviceUserId;
    const [allergies, openRisks, flash, carePlans, ia, progress, medProgress, bodyMapHandover] =
      await Promise.all([
        this.loadAllergies(suId),
        this.prisma.initialAssessmentRiskRecord.findMany({
          where: {
            serviceUserId: suId,
            status: InitialAssessmentRiskStatus.OPEN,
            riskType: {
              in: [
                InitialAssessmentRiskType.FALLS,
                InitialAssessmentRiskType.HYDRATION,
                InitialAssessmentRiskType.SKIN_INTEGRITY,
                InitialAssessmentRiskType.MOVING_HANDLING,
              ],
            },
          },
          select: { riskType: true },
        }),
        this.prisma.serviceUserFlashMessage.findFirst({
          where: { serviceUserId: suId, ...activeServiceUserFlashMessageWhere() },
          select: { id: true, message: true, displayUntil: true },
        }),
        this.prisma.serviceUserCarePlanInstance.findMany({
          where: { serviceUserId: suId },
          take: 4,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            carePathwayForm: { select: { name: true } },
            publishedVersions: {
              orderBy: { versionNumber: 'desc' },
              take: 1,
              select: { summary: true, valuesJson: true },
            },
          },
        }),
        this.prisma.serviceUserInitialAssessment.findFirst({
          where: { serviceUserId: suId, deletedAt: null },
          select: { previousMedicalHistory: true, careInstructions: true },
        }),
        this.resolveProgress(ctx),
        this.resolveMedicationProgress(ctx),
        this.bodyMap.handoverPreview(suId).catch(() => null),
      ]);

    const riskTags = openRisks.map((r) => ({
      id: r.riskType.toLowerCase(),
      label: riskLabel(r.riskType),
      tone: 'warning' as Tone,
    }));

    const extraFlags = riskTags.filter((t) => !/allerg/i.test(t.label));
    const communicationNotes = extractCommunicationNotes(ia?.careInstructions ?? '');

    const carePlanEssentials = carePlans
      .map((plan) => {
        const pub = plan.publishedVersions[0];
        if (!pub) return null;
        const description =
          (typeof pub.summary === 'string' && pub.summary.trim()) ||
          extractCarePlanBlurb(pub.valuesJson);
        return {
          id: plan.id,
          title: plan.carePathwayForm.name,
          description,
          iconType: iconForCarePlan(plan.carePathwayForm.name),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .slice(0, 4);

    return {
      allergies: {
        tone: 'danger' as Tone,
        label: 'ALLERGIES',
        items: allergies,
        display: allergies.length > 0 ? `Allergies: ${allergies.join(', ')}` : null,
      },
      flags: {
        extraCount: extraFlags.length,
        extraCountLabel: extraFlags.length > 0 ? `+${extraFlags.length} flags` : null,
        items: riskTags,
      },
      flashMessage: flash
        ? { id: flash.id, message: flash.message, displayUntil: flash.displayUntil.toISOString() }
        : null,
      summaryWidgets: [
        {
          id: 'tasks',
          label: 'Tasks',
          value: `${progress.tasksDone}/${progress.tasksTotal}`,
        },
        {
          id: 'meds',
          label: 'Medicines',
          value: `${medProgress.givenCount}/${medProgress.dueCount}`,
        },
        {
          id: 'obs',
          label: 'Observations',
          value: String(progress.obsCount),
        },
      ],
      safetyBriefing: {
        title: 'Pre-visit safety briefing',
        risks: riskTags,
        loneWorkerNote: 'Lone-worker & SOS',
      },
      communication: {
        title: 'Communication & sensory',
        items: communicationNotes,
      },
      carePlanEssentials,
      bodyMapHandover: bodyMapHandover
        ? {
            activeCount: bodyMapHandover.activeCount,
            highRiskCount: bodyMapHandover.highRiskCount,
            concerns: bodyMapHandover.concerns.slice(0, 4),
          }
        : null,
    };
  }

  private async loadVisitMedicationSections(ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>) {
    const visitDate = formatScheduleDate(ctx.primaryVisit.scheduledStartDateTime);
    const { start, end } = utcDayBounds(visitDate);
    const roundCode = ctx.medicationRoundCode;
    const allergies = await this.loadAllergies(ctx.job.serviceUserId);
    const allergyLower = allergies.map((a) => a.toLowerCase());

    const round = roundCode
      ? await this.prisma.medicationAdministrationRound.findFirst({
          where: { code: roundCode, deletedAt: null, isActive: true },
          select: { id: true, name: true },
        })
      : null;

    const scheduledMeds = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId: ctx.job.serviceUserId,
        deletedAt: null,
        isActive: true,
        status: MedicationRecordStatus.ACTIVE,
        medicationKind: { not: MedicationKind.PRN },
        ...(round
          ? {
              schedules: {
                some: {
                  deletedAt: null,
                  isActive: true,
                  roundId: round.id,
                },
              },
            }
          : {}),
      },
      orderBy: { medicationName: 'asc' },
      select: {
        id: true,
        medicationName: true,
        dose: true,
        strength: true,
        instructions: true,
        isControlledMedication: true,
        route: { select: { name: true } },
        schedules: {
          where: { deletedAt: null, isActive: true, ...(round ? { roundId: round.id } : {}) },
          select: { dueTime: true, round: { select: { name: true } } },
          take: 1,
        },
        medicationPack: { select: { adminRules: true } },
      },
    });

    const prnMeds = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId: ctx.job.serviceUserId,
        deletedAt: null,
        isActive: true,
        status: MedicationRecordStatus.ACTIVE,
        medicationKind: MedicationKind.PRN,
      },
      orderBy: { medicationName: 'asc' },
      select: {
        id: true,
        medicationName: true,
        dose: true,
        strength: true,
        instructions: true,
        isControlledMedication: true,
        route: { select: { name: true } },
      },
    });

    const medIds = [...scheduledMeds, ...prnMeds].map((m) => m.id);
    const events =
      medIds.length > 0
        ? await this.prisma.medicationAdministrationEvent.findMany({
            where: {
              serviceUserId: ctx.job.serviceUserId,
              deletedAt: null,
              serviceUserMedicationId: { in: medIds },
              OR: [
                { scheduledDateTime: { gte: start, lte: end } },
                { actualDateTime: { gte: start, lte: end } },
              ],
            },
            select: {
              id: true,
              serviceUserMedicationId: true,
              status: true,
              actualDateTime: true,
            },
          })
        : [];

    const eventByMed = new Map<string, (typeof events)[number]>();
    for (const e of events) {
      if (!eventByMed.has(e.serviceUserMedicationId)) eventByMed.set(e.serviceUserMedicationId, e);
    }

    const mapMed = (m: (typeof scheduledMeds)[number] | (typeof prnMeds)[number], isPrn: boolean) => {
      const dose = [m.dose, m.strength].filter(Boolean).join(' ') || null;
      const route = m.route?.name ?? null;
      const timing = isPrn
        ? 'PRN'
        : 'schedules' in m && m.schedules[0]?.round?.name
          ? m.schedules[0].round.name
          : null;
      const detailParts = [dose, route, m.instructions?.trim() || timing].filter(Boolean);
      const allergyHit = allergyLower.some((a) => m.medicationName.toLowerCase().includes(a));
      const adminRules =
        'medicationPack' in m &&
        m.medicationPack?.adminRules &&
        typeof m.medicationPack.adminRules === 'object'
          ? (m.medicationPack.adminRules as Record<string, unknown>)
          : {};
      const tags: Array<{ id: string; label: string; tone: Tone }> = [];
      if (allergyHit) tags.push({ id: 'allergy', label: 'Allergy', tone: 'danger' });
      if (m.isControlledMedication) tags.push({ id: 'cd', label: 'CD', tone: 'warning' });
      if (Boolean(adminRules.timeCritical)) {
        tags.push({ id: 'time_critical', label: 'Time-critical', tone: 'warning' });
      }

      const evt = eventByMed.get(m.id);
      const isRecorded = evt?.status === MedicationAdministrationStatus.GIVEN;

      return {
        id: m.id,
        name: m.medicationName,
        dose,
        route,
        detail: detailParts.join(' · '),
        isPrn,
        isRecorded,
        administrationEventId: evt?.id ?? null,
        tags,
      };
    };

    const sections: Array<{
      id: string;
      title: string;
      medicines: ReturnType<typeof mapMed>[];
    }> = [];

    if (scheduledMeds.length > 0) {
      sections.push({
        id: 'scheduled',
        title: round ? `SCHEDULED · ${round.name.toUpperCase()}` : 'SCHEDULED',
        medicines: scheduledMeds.map((m) => mapMed(m, false)),
      });
    }

    if (prnMeds.length > 0) {
      sections.push({
        id: 'prn',
        title: 'PRN · AS REQUIRED',
        medicines: prnMeds.map((m) => mapMed(m, true)),
      });
    }

    return sections;
  }

  private async loadVisitObservations(serviceUserId: string, since: Date) {
    const rows = await this.prisma.serviceUserObservation.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        recordedAt: { gte: since },
      },
      orderBy: { recordedAt: 'desc' },
      include: { observationType: true },
      take: 20,
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.observationType.name,
      valueLabel: formatObservationValue(row),
      recordedAt: row.recordedAt.toISOString(),
      timeLabel: formatHmUtc(row.recordedAt),
      statusLabel: inferObservationStatus(row.observationType.code, row.numericValue, row.payload),
      tone: 'success' as Tone,
    }));
  }

  private async countVisitObservations(serviceUserId: string, since: Date) {
    return this.prisma.serviceUserObservation.count({
      where: { serviceUserId, deletedAt: null, recordedAt: { gte: since } },
    });
  }

  private async buildVisitTimeline(
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    since: Date,
  ) {
    const entries: Array<{
      id: string;
      at: string;
      timeLabel: string;
      title: string;
      subtitle: string | null;
      tone: Tone;
      sortAt: number;
    }> = [];

    if (ctx.primaryVisit.actualStartDateTime || ctx.checkIn) {
      const at = ctx.primaryVisit.actualStartDateTime ?? new Date(String(ctx.checkIn?.checkedInAt));
      const geofence = this.evaluateGeofenceFromMeta(ctx);
      entries.push({
        id: 'check-in',
        at: at.toISOString(),
        timeLabel: formatHmUtc(at),
        title: 'Clocked in',
        subtitle: geofence.withinArea
          ? 'Within geofence · GPS confirmed'
          : 'Outside geofence · GPS recorded',
        tone: 'primary',
        sortAt: at.getTime(),
      });
    }

    const [taskCompletions, observations, medEvents] = await Promise.all([
      this.prisma.scheduledVisitTaskCompletion.findMany({
        where: {
          scheduledJobId: ctx.job.id,
          isCompleted: true,
          completedAt: { gte: since },
        },
        include: {
          assignment: { include: { task: { select: { name: true } } } },
        },
        orderBy: { completedAt: 'asc' },
      }),
      this.loadVisitObservations(ctx.job.serviceUserId, since),
      this.prisma.medicationAdministrationEvent.findMany({
        where: {
          serviceUserId: ctx.job.serviceUserId,
          deletedAt: null,
          actualDateTime: { gte: since },
          status: MedicationAdministrationStatus.GIVEN,
        },
        include: { medication: { select: { medicationName: true } } },
        orderBy: { actualDateTime: 'asc' },
        take: 20,
      }),
    ]);

    for (const t of taskCompletions) {
      if (!t.completedAt) continue;
      const name =
        t.assignment?.task.name ??
        (await this.prisma.taskCatalogueTask.findUnique({
          where: { id: t.taskCatalogueTaskId },
          select: { name: true },
        }))?.name ??
        'Task';
      entries.push({
        id: `task-${t.id}`,
        at: t.completedAt.toISOString(),
        timeLabel: formatHmUtc(t.completedAt),
        title: 'Task completed',
        subtitle: name,
        tone: 'success',
        sortAt: t.completedAt.getTime(),
      });
    }

    for (const o of observations) {
      entries.push({
        id: `obs-${o.id}`,
        at: o.recordedAt,
        timeLabel: o.timeLabel,
        title: 'Observation recorded',
        subtitle: `${o.title} ${o.valueLabel ?? ''}`.trim(),
        tone: 'success',
        sortAt: new Date(o.recordedAt).getTime(),
      });
    }

    for (const m of medEvents) {
      if (!m.actualDateTime) continue;
      entries.push({
        id: `mar-${m.id}`,
        at: m.actualDateTime.toISOString(),
        timeLabel: formatHmUtc(m.actualDateTime),
        title: 'Medication given',
        subtitle: m.medication.medicationName,
        tone: 'success',
        sortAt: m.actualDateTime.getTime(),
      });
    }

    entries.sort((a, b) => b.sortAt - a.sortAt);
    return entries.map(({ sortAt: _sortAt, ...rest }) => rest);
  }

  private resolveHandoverNote(ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>) {
    const meta = this.parseMetadata(ctx.job.metadata);
    const extra =
      typeof meta.extraCareNotes === 'string' ? meta.extraCareNotes.trim() : '';
    const visitNotes = ctx.primaryVisit.notes?.trim() ?? '';
    const value = extra || visitNotes || null;
    return {
      title: 'VISIT NOTE / HANDOVER',
      value,
      placeholder: 'Add handover notes for the next carer or office…',
    };
  }

  private async loadAllergies(serviceUserId: string) {
    const rows = await this.prisma.serviceUserAllergy.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      select: { allergyName: true },
      orderBy: { allergyName: 'asc' },
    });
    return rows.map((r) => r.allergyName.trim()).filter(Boolean);
  }

  private parseMetadata(raw: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...(raw as Record<string, unknown>) };
    }
    return {};
  }

  private async evaluateGeofence(
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    latitude?: number,
    longitude?: number,
  ) {
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      select: {
        domGeofenceDistanceMeters: true,
        domGeofenceToleranceMeters: true,
        domRestrictJobOutsideGeofence: true,
      },
    });
    const restrictOutside = Boolean(settings?.domRestrictJobOutsideGeofence);

    if (latitude == null || longitude == null) {
      return {
        withinArea: true,
        label: 'Within area',
        tone: 'success' as Tone,
        distanceMeters: null as number | null,
        restrictOutside,
      };
    }

    const addr = ctx.job.serviceUser.address;
    const jobLat = ctx.job.latitude != null ? Number(ctx.job.latitude) : null;
    const jobLng = ctx.job.longitude != null ? Number(ctx.job.longitude) : null;
    const suLat =
      addr && !addr.deletedAt && addr.latitude != null ? Number(addr.latitude) : null;
    const suLng =
      addr && !addr.deletedAt && addr.longitude != null ? Number(addr.longitude) : null;
    const targetLat = jobLat ?? suLat;
    const targetLng = jobLng ?? suLng;

    if (targetLat == null || targetLng == null) {
      return {
        withinArea: true,
        label: 'Within area',
        tone: 'success' as Tone,
        distanceMeters: null as number | null,
        restrictOutside,
      };
    }

    const radius =
      (settings?.domGeofenceDistanceMeters ?? 100) +
      (settings?.domGeofenceToleranceMeters ?? 0);
    const distanceMeters = haversineMeters(latitude, longitude, targetLat, targetLng);
    const withinArea = distanceMeters <= radius;

    return {
      withinArea,
      label: withinArea ? 'Within area' : 'Outside area',
      tone: (withinArea ? 'success' : 'warning') as Tone,
      distanceMeters: Math.round(distanceMeters),
      restrictOutside,
    };
  }

  private evaluateGeofenceFromMeta(ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>) {
    const checkIn = ctx.checkIn;
    if (!checkIn) {
      return { withinArea: true, label: 'Within area', tone: 'success' as Tone };
    }
    const outside = Boolean(checkIn.outsideGeofence);
    return {
      withinArea: !outside,
      label: outside ? 'Outside area' : 'Within area',
      tone: (outside ? 'warning' : 'success') as Tone,
    };
  }
}

function resolveTaskModuleLink(
  name: string,
  groupCode: string,
  medicationRequired: boolean,
): { id: string; label: string; tone: Tone } | null {
  const lower = name.toLowerCase();
  if (/medication|medicine|\bmar\b|prompt.*med/.test(lower) || (medicationRequired && /prompt/.test(lower))) {
    return { id: 'emar', label: 'eMAR', tone: 'danger' };
  }
  if (/observations_monitoring|observation/.test(groupCode)) {
    return { id: 'obs', label: 'Obs', tone: 'success' };
  }
  if (/fluid|drink|glucose|pressure|observation|mood|reposition|skin|body map/.test(lower)) {
    return { id: 'obs', label: 'Obs', tone: 'success' };
  }
  return null;
}

function mapUiStatus(
  jobStatus: ScheduledJobStatus,
  visitStatus: ScheduledVisitStatus,
): string {
  if (jobStatus === ScheduledJobStatus.IN_PROGRESS || visitStatus === ScheduledVisitStatus.STARTED) {
    return 'in_progress';
  }
  if (
    jobStatus === ScheduledJobStatus.COMPLETED ||
    visitStatus === ScheduledVisitStatus.COMPLETED ||
    visitStatus === ScheduledVisitStatus.PARTIALLY_COMPLETED
  ) {
    return 'completed';
  }
  if (jobStatus === ScheduledJobStatus.MISSED || visitStatus === ScheduledVisitStatus.MISSED) {
    return 'missed';
  }
  if (
    jobStatus === ScheduledJobStatus.NEEDS_ATTENTION ||
    visitStatus === ScheduledVisitStatus.NEEDS_ATTENTION
  ) {
    return 'needs_attention';
  }
  return 'upcoming';
}

function displayName(first: string | null | undefined, last: string | null | undefined) {
  return [first, last].filter(Boolean).join(' ').trim() || 'Service user';
}

function initialsFromName(first: string | null | undefined, last: string | null | undefined) {
  const a = first?.trim().charAt(0) ?? '';
  const b = last?.trim().charAt(0) ?? '';
  return (a + b).toUpperCase() || '?';
}

function formatHmUtc(d: Date) {
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDob(d: Date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function riskLabel(risk: InitialAssessmentRiskType) {
  switch (risk) {
    case InitialAssessmentRiskType.FALLS:
      return 'Falls risk';
    case InitialAssessmentRiskType.HYDRATION:
      return 'Dehydration risk';
    case InitialAssessmentRiskType.SKIN_INTEGRITY:
      return 'Pressure ulcer risk';
    case InitialAssessmentRiskType.MOVING_HANDLING:
      return 'Moving & handling risk';
    default:
      return 'Risk flagged';
  }
}

function iconForTaskGroup(groupCode: string) {
  if (/hygiene|personal/.test(groupCode)) return 'hygiene';
  if (/nutrition|fluid/.test(groupCode)) return 'fluid';
  if (/medication/.test(groupCode)) return 'medication';
  if (/observation|monitor/.test(groupCode)) return 'observation';
  return 'task';
}

function iconForCarePlan(name: string) {
  if (/diabet/i.test(name)) return 'medication';
  if (/memory|dement/i.test(name)) return 'memory';
  if (/nutrition|hydrat/i.test(name)) return 'fluid';
  return 'care_plan';
}

function extractCarePlanBlurb(valuesJson: Prisma.JsonValue | null | undefined): string | null {
  if (!valuesJson || typeof valuesJson !== 'object' || Array.isArray(valuesJson)) return null;
  const obj = valuesJson as Record<string, unknown>;
  for (const key of ['summary', 'goal', 'overview', 'description']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 240);
  }
  return null;
}

function extractCommunicationNotes(text: string): string[] {
  const items: string[] = [];
  const lower = text.toLowerCase();
  if (/glasses|spectacle/.test(lower)) items.push('Reading glasses');
  if (/hard of hearing|hearing aid|deaf/.test(lower)) items.push('Hard of hearing');
  if (/announce yourself|knock before/.test(lower)) items.push('Announce yourself');
  return items;
}

function formatObservationValue(row: {
  numericValue: Prisma.Decimal | number | null;
  unit: string | null;
  payload: Prisma.JsonValue | null;
  observationType?: { name: string };
}): string | null {
  if (row.numericValue != null) {
    const unit = row.unit?.trim();
    const num = Number(row.numericValue);
    return unit ? `${num} ${unit}` : String(num);
  }
  if (row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)) {
    const p = row.payload as Record<string, unknown>;
    if (typeof p.amountMl === 'number') return `${p.amountMl} ml`;
    if (typeof p.fluidType === 'string' && typeof p.amountMl === 'number') {
      return `${p.fluidType} · ${p.amountMl} ml`;
    }
  }
  return null;
}

function inferObservationStatus(
  code: string,
  numericValue: Prisma.Decimal | number | null,
  payload: Prisma.JsonValue | null,
): string | null {
  if (code === 'BLOOD_SUGAR' && numericValue != null) {
    const v = Number(numericValue);
    if (v >= 4 && v <= 15) return 'Normal';
    if (v < 4) return 'Low';
    return 'High';
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    if (typeof p.interpretation === 'string') return p.interpretation;
  }
  return null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
