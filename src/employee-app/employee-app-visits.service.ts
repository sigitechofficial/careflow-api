import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  AllocationStatus,
  CarerVisitPushKind,
  BodyMapPhotoConsentStatus,
  BodyMapRecordStatus,
  InitialAssessmentRiskStatus,
  InitialAssessmentRiskType,
  MedicationAdministrationStatus,
  MedicationKind,
  MedicationPackStatus,
  MedicationRecordStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitCareConsentStatus,
  VisitClockInArrivalKind,
  VisitOutcomeArea,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  mapMedicationOutcomesFromStatusCodes,
  syncMedicationVisitOutcomesFromStatusCodes,
} from '../lookups/visit-outcome-medication.util';
import { ScheduledJobsHousekeepingService } from '../scheduled-jobs-housekeeping/scheduled-jobs-housekeeping.service';
import { SaveVisitJobTasksDto } from '../scheduled-jobs-housekeeping/dto/save-visit-job-tasks.dto';
import { BodyMapService } from '../body-map/body-map.service';
import { bodyMapDiagramCatalogForMobile } from '../body-map/body-map-diagram-catalog.util';
import type {
  CreateBodyMapRecordDto,
  CreateBodyMapReviewDto,
} from '../body-map/dto/create-body-map-record.dto';
import { VisitAttendanceService } from '../visit-attendance/visit-attendance.service';
import { EcmEvaluationService } from '../ecm/ecm-evaluation.service';
import { VisitAreaLockService } from '../ecm/visit-area-lock.service';
import { VisitCheckInMethodGrantService } from '../ecm/visit-check-in-method-grant.service';
import { isAuthorisedManualGrantActive } from '../ecm/visit-check-in-method-grant.util';
import { EmployeeAppSosService } from './employee-app-sos.service';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import type { EmployeeAppSosDto } from './dto/employee-app-sos.dto';
import { resolveJobMedicationRoundCode } from '../scheduled-jobs-housekeeping/visit-job-tasks.util';
import { activeServiceUserFlashMessageWhere } from '../service-user-flash-messages/active-flash-message.util';
import { CreateServiceUserObservationDto } from '../service-user-observations/dto/create-service-user-observation.dto';
import { validateObservationCreate } from '../service-user-observations/observation-payload.validation';
import {
  calculateNews2Score,
  extractWellbeingScoresFromPayload,
  shouldValidateEmployeeObservationPayload,
} from '../service-user-observations/observation-clinical.catalog';
import {
  VisitObservationsCatalogService,
  formatVisitObservationValue,
  inferVisitObservationStatus,
} from '../service-user-observations/visit-observations-catalog.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  jobMetadataIsOvernight,
  nightDutyAppLabel,
  resolveStoredNightDuty,
} from '../service-user-visit-plans/visit-plan-night-duty.util';
import {
  dayKeyInTimeZone,
  formatHmUtc,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { formatUkDateLabel } from '../common/utils/uk-date-label.util';
import { deriveJobStatusFromVisits } from '../scheduling/scheduling-job-status.util';
import { loadVisitRefsByScheduledVisitIds } from '../scheduling/visit-ref-lookup.util';
import { VisitReconciliationsService } from '../billing/visit-reconciliations.service';
import { resolveAllocationWindow } from '../job-allocations/allocation-window.util';
import { ScheduledVisitStatus as LocalVisitStatus } from '../scheduled-visits/enums/scheduled-visit-status.enum';
import type { EmployeeAppVisitCheckInDto } from './dto/employee-app-visit-check-in.dto';
import type { EmployeeAppAreaPresenceDto } from './dto/employee-app-area-presence.dto';
import {
  isCheckInMethodEnabled,
  mergeEnabledMethodsWithGrant,
  normalizeCheckInMethod,
  orgHasOptInCheckInMethod,
  resolveEnabledCheckInMethods,
} from './employee-app-check-in-methods.util';
import type { EmployeeAppCheckInMethodRequestDto } from './dto/employee-app-check-in-method-request.dto';
import type { EmployeeAppVisitCompleteDto } from './dto/employee-app-visit-complete.dto';
import type {
  EmployeeAppHandoverAcknowledgeDto,
  EmployeeAppIdentityDto,
  EmployeeAppIncidentDto,
  EmployeeAppLogConcernDto,
  EmployeeAppLogHandoverDto,
  EmployeeAppLogNoteDto,
  EmployeeAppMedicationAdminDto,
  EmployeeAppObservationWriteDto,
  EmployeeAppSaveTaskDto,
  EmployeeAppUnableToStartDto,
  EmployeeAppCareConsentDto,
} from './dto/employee-app-visit-writes.dto';
import type { EmployeeAppCreateBodyMapRecordDto } from './dto/employee-app-body-map-record.dto';
import type { EmployeeAppBodyMapWizardSubmitDto } from './dto/employee-app-body-map-wizard.dto';
import { employeeAppBodyMapWizardCatalog } from './body-map/employee-app-body-map-wizard.catalog';
import { mapWizardSubmitToCreateDto } from './body-map/employee-app-body-map-wizard.util';
import {
  enrichBodyMapRecordForMobile,
  flattenObservationBodyMapPins,
} from './body-map/employee-app-body-map-records.util';
import {
  buildVisitBlisterPacks,
  collectActivePackMedicationIds,
} from './medication/employee-app-visit-blister-packs.util';
import { indexMarBodyMapSites } from './medication/employee-app-mar-body-map-site.util';
import {
  buildMarAdminEchoFields,
  emptyMarAdminEchoFields,
} from './medication/employee-app-mar-echo.util';
import {
  buildMedicationWitnessEcho,
  medicationWitnessTimelineDetail,
  resolveMedicationWitnessColumns,
} from '../medications/medication-witness.util';
import {
  plannedHowAssistedLabel,
  resolveVisitMedicationRoundFromDb,
} from './medication/employee-app-visit-medication-round.util';
import { medicationRequiresBodyMapSiteFromMed } from '../body-map/body-map-medication-eligibility.util';
import {
  EMPLOYEE_APP_COMPLETION_OUTCOMES,
  employeeAppTimingExceptionReasons,
  isEmployeeAppCompletionStatus,
} from './employee-app-visit-completion.util';
import { employeeAppKeySafePayload } from './employee-app-access.util';
import {
  mobileTypeCode,
  resolveObservationTypeCode,
} from './employee-app-observations.catalog';
import {
  contractError,
  mapMarOutcomeCode,
  mapVisitOutcomeToStatus,
  newAuditRecordId,
  parseMedicationAdministrationKey,
  statusToContractLabel,
  validationError,
} from './employee-app-contract.util';
import { formatHm } from '../medication-charts/medication-chart-rounds.util';
import {
  computeVisitTaskProgress,
  inferVisitTaskOutcome,
  isVisitTaskAddressed,
  stripVisitTaskOutcomeNotes,
} from './visit-task-progress.util';
import {
  pickScheduleFromAssignment,
  visitTaskMatchesDay,
} from '../visit-tasks/visit-task-schedule.util';
import {
  parseObservationNumeric,
  resolveTaskObsLink,
} from './visit-task-obs-link.util';
import { syncObservationFromCompletedVisitTask } from './visit-task-obs-sync.util';
import { VisitTimelineService } from './visit-timeline.service';
import {
  HANDOVER_TIMELINE_SOURCE_ID,
  VISIT_NOTE_TIMELINE_SOURCE_ID,
} from './visit-timeline.types';
import {
  checkInTimelineDetail,
  concernTimelineTone,
  handoverTimelineTone,
  medicationOutcomeLabel,
  medicationTimelineTone,
  observationTimelineTone,
  parseOccurredAt,
  summarizeTimelineDetail,
  taskOutcomeTimelineDetail,
  taskOutcomeTimelineTone,
} from './visit-timeline.util';
import { mapClockInArrivalReasonRow } from './employee-app-check-in-arrival-reasons';
import {
  buildUnableToStartBlock,
  employeeAppUnableToStartReasonLabel,
  isEmployeeAppUnableToStartReasonCode,
  type UnableToStartSummary,
} from './employee-app-unable-to-start.util';
import {
  allocationIso,
  isLeadCarerOnVisit,
  isMultiCarerVisit,
  buildSupportClockedOutBeforeLeadComplete,
  mapTwoPersonTaskFlags,
  readCoCarerPresenceMap,
  resolveCarerRole,
  resolveLeadEmployeeId,
  type CoCarerPresenceRecord,
} from './employee-app-multi-carer.util';
import type { EmployeeAppCoCarerPresenceDto } from './dto/employee-app-co-carer-presence.dto';

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

/** Carer-app check-in / shell geofence radius (meters). */
const EMPLOYEE_APP_ALLOWED_RADIUS_METERS = 10000;

/** Keys removed from `shell.location` (client computes geofence from lat/lng/radius only). */
export const EMPLOYEE_APP_SHELL_LOCATION_REMOVED_KEYS = [
  'label',
  'tone',
  'withinArea',
  'serviceUser',
  'source',
  'job',
  'distanceMeters',
] as const;

/** Trimmed visit destination for shell / details (API-02). Coords as 4dp strings. */
export function buildShellLocation(input: {
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
}) {
  return {
    latitude: formatCoord4(input.latitude),
    longitude: formatCoord4(input.longitude),
    allowedRadiusMeters: input.allowedRadiusMeters,
  };
}

/** Round to 4 decimal places (numeric, for geofence math). */
export function roundCoord4(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Serialize lat/lng for API responses with exactly 4 digits after the decimal
 * (e.g. "31.4390"). JSON numbers drop trailing zeros, so these are strings.
 */
export function formatCoord4(value: number | null | undefined): string | null {
  const rounded = roundCoord4(value);
  return rounded == null ? null : rounded.toFixed(4);
}

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
        nhsNumber: true;
        address: {
          select: {
            addressLine1: true;
            addressLine2: true;
            town: true;
            county: true;
            postcode: true;
            latitude: true;
            longitude: true;
            accessInstructions: true;
            keySafeNumber: true;
            accessMethod: true;
            keySafeLocation: true;
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
        visitPlanSlot: { select: { slotCode: true; medicationRoundCode: true; nightDuty: true } };
      };
    };
    allocations: {
      where: { deletedAt: null; isActive: true };
      select: {
        id: true;
        status: true;
        employeeId: true;
        isLeadCarer: true;
        actualStartDateTime: true;
        actualEndDateTime: true;
        scheduledStartDateTime: true;
        scheduledEndDateTime: true;
        durationMinutes: true;
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
    private readonly visitTimeline: VisitTimelineService,
    private readonly visitObservationsCatalog: VisitObservationsCatalogService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly areaLocks: VisitAreaLockService,
    private readonly checkInMethodGrants: VisitCheckInMethodGrantService,
    private readonly sos: EmployeeAppSosService,
    private readonly visitReconciliations: VisitReconciliationsService,
    private readonly carerPush: CarerVisitPushHook,
  ) {}

  async sendSos(employeeId: string, jobId: string, dto: EmployeeAppSosDto) {
    await this.loadJobForEmployee(employeeId, jobId);
    return this.sos.send(employeeId, jobId, dto);
  }

  async requestCheckInMethod(
    employeeId: string,
    jobId: string,
    dto: EmployeeAppCheckInMethodRequestDto,
  ) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const visit = ctx.primaryVisit;
    const multi = isMultiCarerVisit(ctx.job.requiredCarers, ctx.job.allocations);
    const myAllocation = ctx.job.allocations.find((a) => a.employeeId === employeeId);
    const visitClosed =
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF;
    const alreadyCheckedIn = multi
      ? Boolean(myAllocation?.actualStartDateTime)
      : Boolean(visit.actualStartDateTime) ||
        visit.status === ScheduledVisitStatus.STARTED ||
        Boolean(ctx.checkIn);
    const geofence = await this.evaluateGeofence(ctx, dto.latitude, dto.longitude);
    return this.checkInMethodGrants.createRequest({
      scheduledJobId: jobId,
      employeeId,
      note: dto.note,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyMeters: dto.accuracyMeters,
      isMockedLocation: dto.isMockedLocation,
      locationUnavailable: dto.locationUnavailable,
      withinArea: geofence.withinArea,
      distanceMeters: geofence.distanceMeters,
      alreadyCheckedIn,
      visitClosed,
    });
  }

  async getWorkspace(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const [progress, overviewExtras, medProgress, geofenceSettings, checkInFlags, areaLock, methodGrant, officeContact, emergencyProtocols] =
      await Promise.all([
        this.resolveProgress(ctx),
        this.loadOverviewExtras(ctx),
        this.resolveMedicationProgress(ctx),
        this.loadGeofenceSettings(),
        this.loadCheckInMethodFlags(),
        this.areaLocks.getState(jobId),
        this.checkInMethodGrants.getForCarerVisit(
          jobId,
          employeeId,
          ctx.timeZone,
          ctx.job.scheduledStartDateTime,
        ),
        this.loadOfficeContact(),
        this.getEmergencyProtocols(),
      ]);
    const checkInMethod = this.resolveCheckInMethod(ctx, employeeId);
    const gpsCheckIn = checkInMethod === 'GPS';
    const orgMethods = resolveEnabledCheckInMethods(checkInFlags);
    const enabledMethods = mergeEnabledMethodsWithGrant(orgMethods, methodGrant);
    const manualFromGrant = isAuthorisedManualGrantActive(methodGrant);

    return {
      data: {
        shell: {
          ...(await this.buildShell(ctx, progress, medProgress, employeeId, geofenceSettings)),
          allergies: overviewExtras.allergies,
          flags: overviewExtras.flags,
          operationsLocked: gpsCheckIn && areaLock.operationsLocked,
          operationsLockedAt: gpsCheckIn ? areaLock.lockedAt : null,
          areaContinueAllowed: gpsCheckIn && areaLock.continueAllowed,
          checkInMethod,
        },
        overview: overviewExtras,
        clockInSettings: {
          enabledMethods,
          maxLocationAccuracyMeters: 50,
          timingGraceMinutes: 15,
          allowManualOverride:
            Boolean(checkInFlags.domCheckInManualEnabled) || manualFromGrant,
          allowedRadiusMeters: geofenceSettings.allowedRadiusMeters,
          requestOfficeAvailable: !orgHasOptInCheckInMethod(checkInFlags),
          checkInMethodRequest: methodGrant,
          ...(await this.getClockInArrivalReasons()),
        },
        clockOutSettings: await this.getClockOutEndReasons(),
        visitOutcomes: await this.getVisitOutcomesCatalog(),
        officeContact,
        emergencyProtocols,
      },
    };
  }

  /** Admin Settings → Company details (contact name + phone). */
  private async loadOfficeContact() {
    const row = await this.prisma.companyProfile.findFirst({
      select: {
        contactName: true,
        displayName: true,
        companyName: true,
        phoneNumber: true,
      },
    });
    const phoneNumber = row?.phoneNumber?.trim() || null;
    const name =
      row?.contactName?.trim() ||
      row?.displayName?.trim() ||
      row?.companyName?.trim() ||
      'Office';
    return { name, phoneNumber };
  }

  /**
   * Bootstrap snapshot for the complete visit workspace. Tab-specific endpoints
   * remain available for lightweight refreshes after the initial load.
   */
  async getVisitDetails(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const [workspace, tasks, medication, observations, log, bodyMap, welfareOutcomes, careConsent] =
      await Promise.all([
        this.getWorkspace(employeeId, jobId),
        this.getTasks(employeeId, jobId),
        this.getMedication(employeeId, jobId),
        this.getObservations(employeeId, jobId),
        this.getLog(employeeId, jobId),
        this.getBodyMapWizard(employeeId, jobId),
        this.getWelfareOutcomes(),
        this.getCareConsent(employeeId, ctx.primaryVisit.id),
      ]);

    return {
      data: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        jobId,
        organisationTimezone: ctx.timeZone,
        shell: workspace.data.shell,
        overview: workspace.data.overview,
        tasks: tasks.data,
        medication: medication.data,
        observations: observations.data,
        log: log.data,
        bodyMap: bodyMap.data,
        clockInSettings: workspace.data.clockInSettings,
        clockOutSettings: workspace.data.clockOutSettings,
        visitOutcomes: workspace.data.visitOutcomes,
        officeContact: workspace.data.officeContact,
        emergencyProtocols: workspace.data.emergencyProtocols,
        unableToStart: this.buildUnableToStartPayload(ctx, employeeId),
        welfareOutcomes,
        careConsent,
      },
    };
  }

  /**
   * Org emergency protocols for the carer-app runner.
   * Maps catalog `code` → app `id`. Empty list → the app uses its built-in list.
   */
  async getEmergencyProtocols() {
    try {
      const rows = await this.prisma.emergencyProtocolCatalog.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        select: {
          code: true,
          title: true,
          subtitle: true,
          version: true,
          iconKey: true,
          steps: {
            orderBy: [{ sortOrder: 'asc' }, { action: 'asc' }],
            select: { action: true, detail: true },
          },
        },
      });
      return rows.map((r) => ({
        id: r.code,
        title: r.title,
        subtitle: r.subtitle,
        version: r.version,
        iconKey: r.iconKey,
        steps: r.steps.map((s) => ({ action: s.action, detail: s.detail })),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Org-configurable on-entry welfare outcomes for the carer-app clock-in sheet.
   * Maps catalog `code` → app `id` (the app's existing shape). Empty list → the
   * app falls back to its built-in options.
   */
  async getWelfareOutcomes() {
    const rows = await this.prisma.visitWelfareOutcomeCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: { code: true, label: true, tone: true },
    });
    return rows.map((r) => ({ id: r.code, label: r.label, tone: r.tone }));
  }

  async getVisitOutcomesCatalog() {
    try {
      await syncMedicationVisitOutcomesFromStatusCodes(this.prisma);
    } catch {
      // Fall through — medication pills still come from status codes below.
    }
    const [statusCodes, rows] = await Promise.all([
      this.prisma.medicationStatusCode.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        select: {
          code: true,
          label: true,
          color: true,
          textColor: true,
          reasonRequirement: true,
          sortOrder: true,
        },
      }),
      this.prisma.visitOutcomeCatalog.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        select: {
          area: true,
          code: true,
          label: true,
          allowsReasons: true,
          sortOrder: true,
          reasons: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
            select: { label: true, requiresNotes: true, sortOrder: true },
          },
        },
      }),
    ]);
    const reasonsByCode = new Map<
      string,
      Array<{ label: string; requiresNotes: boolean; sortOrder: number }>
    >();
    for (const row of rows) {
      if (row.area !== VisitOutcomeArea.MEDICATION) continue;
      reasonsByCode.set(row.code.toUpperCase(), row.reasons);
    }
    const mapRows = (area: VisitOutcomeArea) =>
      rows
        .filter((r) => r.area === area)
        .map((r) => ({
          code: r.code,
          label: r.label,
          allowsReasons: r.allowsReasons,
          sortOrder: r.sortOrder,
          reasons: r.reasons.map((reason) => ({
            label: reason.label,
            requiresNotes: reason.requiresNotes,
            enabled: true,
            sortOrder: reason.sortOrder,
          })),
        }));
    return {
      medication: mapMedicationOutcomesFromStatusCodes({
        statusCodes,
        reasonsByCode,
      }),
      task: mapRows(VisitOutcomeArea.TASK),
      observation: mapRows(VisitOutcomeArea.OBSERVATION),
    };
  }

  /** Admin Settings catalogues — empty lists mean the app shows no picker. */
  async getClockOutEndReasons() {
    const rows = await this.prisma.visitClockOutEndReasonCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: {
        kind: true,
        label: true,
        requiresNotes: true,
        sortOrder: true,
        isActive: true,
      },
    });
    return {
      earlyEndReasons: rows
        .filter((r) => r.kind === VisitClockInArrivalKind.EARLY)
        .map(mapClockInArrivalReasonRow),
      lateEndReasons: rows
        .filter((r) => r.kind === VisitClockInArrivalKind.LATE)
        .map(mapClockInArrivalReasonRow),
    };
  }

  /** Admin Settings catalogues — empty lists mean the app shows no picker. */
  async getClockInArrivalReasons() {
    const rows = await this.prisma.visitClockInArrivalReasonCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: {
        kind: true,
        label: true,
        requiresNotes: true,
        sortOrder: true,
        isActive: true,
      },
    });
    return {
      earlyArrivalReasons: rows
        .filter((r) => r.kind === VisitClockInArrivalKind.EARLY)
        .map(mapClockInArrivalReasonRow),
      lateArrivalReasons: rows
        .filter((r) => r.kind === VisitClockInArrivalKind.LATE)
        .map(mapClockInArrivalReasonRow),
    };
  }

  /** When a catalogue has rows, early/late check-in must pick one of those labels. */
  private async assertCheckInArrivalReason(dto: EmployeeAppVisitCheckInDto) {
    const status = dto.timingStatus?.trim().toLowerCase();
    const kind =
      status === 'early'
        ? VisitClockInArrivalKind.EARLY
        : status === 'late'
          ? VisitClockInArrivalKind.LATE
          : null;
    if (!kind) return;

    const rows = await this.prisma.visitClockInArrivalReasonCatalog.findMany({
      where: { isActive: true, kind },
      select: { label: true, requiresNotes: true },
    });
    if (rows.length === 0) {
      if (!dto.timingExceptionNotes?.trim()) {
        contractError(
          'TIMING_NOTES_REQUIRED',
          kind === VisitClockInArrivalKind.EARLY
            ? 'Write why you arrived early'
            : 'Write why you arrived late',
        );
      }
      return;
    }

    const chosen = dto.timingExceptionReasonCode?.trim();
    if (!chosen) {
      contractError(
        'TIMING_REASON_REQUIRED',
        kind === VisitClockInArrivalKind.EARLY
          ? 'Select a reason for early arrival'
          : 'Select a reason for late arrival',
      );
    }
    const match = rows.find((r) => r.label === chosen);
    if (!match) {
      contractError('INVALID_TIMING_REASON', 'Arrival reason is not in the office catalogue');
    }
    if (match.requiresNotes && !dto.timingExceptionNotes?.trim()) {
      contractError('TIMING_NOTES_REQUIRED', `Add notes for “${match.label}”`);
    }
  }

  /** Clock-out picker is end-only. Arrival reasons were already captured at check-in. */
  private async assertClockOutEndReason(
    dto: EmployeeAppVisitCompleteDto,
    plannedEnd: Date | null | undefined,
    actualEnd: Date,
    graceMinutes: number,
  ) {
    if (!plannedEnd) return;
    const graceMs = Math.max(0, graceMinutes) * 60_000;
    const planned = plannedEnd.getTime();
    const actual = actualEnd.getTime();
    const kind =
      actual < planned - graceMs
        ? VisitClockInArrivalKind.EARLY
        : actual > planned + graceMs
          ? VisitClockInArrivalKind.LATE
          : null;
    if (!kind) return;

    const rows = await this.prisma.visitClockOutEndReasonCatalog.findMany({
      where: { isActive: true, kind },
      select: { label: true, requiresNotes: true },
    });
    if (rows.length === 0) {
      if (!dto.timingExceptionNotes?.trim()) {
        contractError(
          'TIMING_NOTES_REQUIRED',
          kind === VisitClockInArrivalKind.EARLY
            ? 'Write why you clocked out early'
            : 'Write why you clocked out late',
        );
      }
      return;
    }

    const chosen = dto.timingExceptionReasonCode?.trim();
    if (!chosen) {
      contractError(
        'TIMING_REASON_REQUIRED',
        kind === VisitClockInArrivalKind.EARLY
          ? 'Select a reason for early clock-out'
          : 'Select a reason for late clock-out',
      );
    }
    const match = rows.find((r) => r.label === chosen);
    if (!match) {
      contractError('INVALID_TIMING_REASON', 'Clock-out reason is not in the office catalogue');
    }
    if (match.requiresNotes && !dto.timingExceptionNotes?.trim()) {
      contractError('TIMING_NOTES_REQUIRED', `Add notes for “${match.label}”`);
    }
  }

  private mapCareConsent(row: {
    status: VisitCareConsentStatus;
    reason: string | null;
    deviceRecordedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    capturedByEmployeeId: string;
  } | null) {
    if (!row) {
      return {
        required: true,
        status: null,
        reason: null,
        recordedAt: null,
        capturedByEmployeeId: null,
      };
    }
    return {
      required: true,
      status: row.status,
      reason: row.reason,
      recordedAt: (row.deviceRecordedAt ?? row.updatedAt ?? row.createdAt).toISOString(),
      capturedByEmployeeId: row.capturedByEmployeeId,
    };
  }

  async getCareConsent(_employeeId: string, scheduledVisitId: string) {
    const row = await this.prisma.visitCareConsent.findUnique({
      where: { scheduledVisitId },
      select: {
        status: true,
        reason: true,
        deviceRecordedAt: true,
        createdAt: true,
        updatedAt: true,
        capturedByEmployeeId: true,
      },
    });
    return this.mapCareConsent(row);
  }

  async getCareConsentForJob(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    return { data: await this.getCareConsent(employeeId, ctx.primaryVisit.id) };
  }

  async saveCareConsent(employeeId: string, jobId: string, dto: EmployeeAppCareConsentDto) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const visit = ctx.primaryVisit;
    const myAllocation = ctx.job.allocations.find((a) => a.employeeId === employeeId);

    if (!isLeadCarerOnVisit(employeeId, ctx.job.requiredCarers, ctx.job.allocations)) {
      validationError('Only the lead carer can record consent to care');
    }

    if (
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF
    ) {
      contractError('VISIT_COMPLETED', 'Visit is already closed');
    }

    const checkedIn =
      Boolean(myAllocation?.actualStartDateTime) || Boolean(ctx.checkIn);
    if (!checkedIn) {
      validationError('Clock in before recording consent to care');
    }

    if (dto.status === 'DECLINED' && !dto.reason?.trim()) {
      validationError('A reason is required when consent is declined');
    }

    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    const deviceRecordedAt = dto.deviceRecordedAt ? new Date(dto.deviceRecordedAt) : new Date();
    const status =
      dto.status === 'DECLINED' ? VisitCareConsentStatus.DECLINED : VisitCareConsentStatus.GRANTED;
    const reason = dto.status === 'DECLINED' ? dto.reason!.trim() : dto.reason?.trim() || null;

    const row = await this.prisma.visitCareConsent.upsert({
      where: { scheduledVisitId: visit.id },
      create: {
        scheduledVisitId: visit.id,
        scheduledJobId: jobId,
        serviceUserId: ctx.job.serviceUserId,
        capturedByEmployeeId: employeeId,
        status,
        reason,
        deviceRecordedAt,
      },
      update: {
        capturedByEmployeeId: employeeId,
        status,
        reason,
        deviceRecordedAt,
      },
    });

    const data = this.mapCareConsent(row);
    await this.mergeEmployeeAppMeta(jobId, (ea) => ({
      ...ea,
      careConsent: data,
      idempotency: {
        ...((ea.idempotency as Record<string, unknown>) ?? {}),
        [dto.idempotencyKey]: data,
      },
    }));

    return { data };
  }

  async reportAreaPresence(
    employeeId: string,
    jobId: string,
    dto: EmployeeAppAreaPresenceDto,
  ) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const visit = ctx.primaryVisit;
    const completed =
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      ctx.job.status === ScheduledJobStatus.COMPLETED ||
      ctx.job.status === ScheduledJobStatus.PARTIALLY_COMPLETED;
    if (completed) {
      throw new BadRequestException('Visit is already completed');
    }
    if (!this.isEmployeeCheckedInForVisit(employeeId, ctx)) {
      contractError('NOT_CHECKED_IN', 'Clock in before reporting visit area presence');
    }

    const checkInMethod = this.resolveCheckInMethod(ctx, employeeId);
    if (checkInMethod !== 'GPS') {
      return {
        data: {
          operationsLocked: false,
          operationsLockedAt: null,
          withinArea: true,
          skipped: true,
          skipReason: 'CHECK_IN_METHOD',
        },
      };
    }

    const geofence = await this.evaluateGeofence(ctx, dto.latitude, dto.longitude);
    const outsideArea = Boolean(dto.outsideArea) || !geofence.withinArea;
    const state = await this.areaLocks.syncOutsidePresence({
      scheduledJobId: jobId,
      employeeId,
      outsideArea,
      latitude: dto.latitude,
      longitude: dto.longitude,
      distanceMeters: geofence.distanceMeters,
    });

    return {
      data: {
        operationsLocked: state.operationsLocked,
        operationsLockedAt: state.lockedAt,
        withinArea: state.withinArea,
        continueAllowed: state.continueAllowed,
      },
    };
  }

  async checkIn(employeeId: string, jobId: string, dto: EmployeeAppVisitCheckInDto) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const visit = ctx.primaryVisit;
    const multi = isMultiCarerVisit(ctx.job.requiredCarers, ctx.job.allocations);
    const myAllocation = ctx.job.allocations.find((a) => a.employeeId === employeeId);

    if (
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF
    ) {
      contractError('VISIT_COMPLETED', 'Visit is already closed');
    }

    // Single-carer: visit-level already-checked-in (unchanged).
    // Double-up: each carer clocks in independently via allocation actualStart.
    await this.assertCheckInArrivalReason(dto);
    await this.assertCheckInMethodEnabled(dto.method, jobId, employeeId);
    this.assertManualCheckInReason(dto);

    const alreadyCheckedIn = multi
      ? Boolean(myAllocation?.actualStartDateTime)
      : Boolean(visit.actualStartDateTime) ||
        visit.status === ScheduledVisitStatus.STARTED ||
        Boolean(ctx.checkIn);
    if (alreadyCheckedIn) {
      contractError(
        'ALREADY_CHECKED_IN',
        multi
          ? 'You are already checked in to this visit'
          : 'Visit is already checked in',
      );
    }

    const now = new Date();
    const deviceRecordedAt = dto.deviceRecordedAt ?? dto.deviceCapturedAt ?? now.toISOString();
    const idempotencyKey = dto.idempotencyKey ?? dto.clientEventId ?? null;
    const geofence = await this.evaluateGeofence(ctx, dto.latitude, dto.longitude);

    const checkInMethod = normalizeCheckInMethod(dto.method);
    // GPS is the only method that must be inside the visit area (or give a
    // geofence reason). Manual / NFC / QR already carry their own exception
    // evidence — do not fail them because last-known GPS is far from the job.
    if (checkInMethod === 'GPS') {
      await this.attendance.assertGeofencePolicy({
        outsideGeofence: !geofence.withinArea,
        outsideGeofenceReason:
          dto.outsideGeofenceReason ?? dto.manualOverrideNotes,
        restrictOutside: geofence.restrictOutside,
      });
    }

    const checkInPayload = {
      clientEventId: dto.clientEventId ?? null,
      idempotencyKey,
      deviceCapturedAt: deviceRecordedAt,
      deviceRecordedAt,
      locationCapturedAt: dto.locationCapturedAt ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      accuracyMeters: dto.accuracyMeters ?? null,
      isMockLocation: dto.isMockedLocation ?? dto.isMockLocation ?? false,
      outsideGeofence: !geofence.withinArea,
      outsideGeofenceReason: dto.outsideGeofenceReason?.trim() ?? null,
      identityConfirmed: dto.identityConfirmed ?? false,
      method: dto.method ?? 'GPS',
      timingStatus: dto.timingStatus ?? null,
      timingExceptionReasonCode: dto.timingExceptionReasonCode ?? null,
      timingExceptionNotes: dto.timingExceptionNotes ?? null,
      manualOverrideReasonCode: dto.manualOverrideReasonCode ?? null,
      manualOverrideNotes: dto.manualOverrideNotes ?? null,
      welfareOutcomeId: dto.welfareOutcomeId ?? null,
      personSeen: dto.personSeen ?? null,
      accessViaKeySafe: dto.accessViaKeySafe ?? null,
      requiresManagerReview: dto.requiresManagerReview ?? false,
      checkedInAt: now.toISOString(),
      employeeId,
      distanceMeters: geofence.distanceMeters,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.update({
        where: { id: visit.id },
        data: {
          status: ScheduledVisitStatus.STARTED,
          // Envelope start = first carer on site (do not overwrite later partners).
          actualStartDateTime: visit.actualStartDateTime ?? now,
        },
      });
      if (myAllocation?.id) {
        await tx.jobAllocation.update({
          where: { id: myAllocation.id },
          data: { actualStartDateTime: myAllocation.actualStartDateTime ?? now },
        });
      }
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
      const previousEa =
        typeof previousMeta.employeeApp === 'object' && previousMeta.employeeApp
          ? (previousMeta.employeeApp as Record<string, unknown>)
          : {};
      const previousCheckIns =
        typeof previousEa.checkIns === 'object' && previousEa.checkIns
          ? (previousEa.checkIns as Record<string, unknown>)
          : {};
      const employeeApp = {
        ...previousEa,
        // Keep last checkIn blob for single-carer / legacy clients.
        checkIn: checkInPayload,
        checkIns: { ...previousCheckIns, [employeeId]: checkInPayload },
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
      deviceCapturedAt: new Date(deviceRecordedAt),
      clientEventId: idempotencyKey ?? undefined,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyMeters: dto.accuracyMeters,
      isMockLocation: dto.isMockedLocation ?? dto.isMockLocation ?? false,
      outsideGeofence: !geofence.withinArea,
      outsideGeofenceReason: dto.outsideGeofenceReason,
      distanceMeters: geofence.distanceMeters,
      identityConfirmed: dto.identityConfirmed ?? false,
    });

    await this.checkInMethodGrants.consumeOnSuccessfulCheckIn(jobId, employeeId);

    await this.ecmEvaluation.evaluateJobSafe(jobId);

    const occurredAt = parseOccurredAt(deviceRecordedAt, now);
    const timelineItem = await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: visit.id,
      eventType: 'clock_in',
      sourceType: 'check_in',
      sourceId: `check_in:${employeeId}`,
      title: 'Clocked in',
      detail: checkInTimelineDetail(dto.method),
      tone: 'primary',
      occurredAt,
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: idempotencyKey,
    });

    const refreshed = await this.loadJobForEmployee(employeeId, jobId);
    const progress = await this.resolveProgress(refreshed);

    const geofenceSettings = await this.loadGeofenceSettings();
    return {
      data: {
        message: 'Checked in to visit',
        jobId,
        visitId: visit.id,
        isCheckedIn: true,
        checkedInAt: now.toISOString(),
        checkedInLabel: formatHmUtc(now),
        method: dto.method ?? 'GPS',
        withinArea: geofence.withinArea,
        distanceMeters: geofence.distanceMeters,
        serverReceivedAt: now.toISOString(),
        shell: await this.buildShell(refreshed, progress, undefined, employeeId, geofenceSettings),
        ...(timelineItem ? { timelineItem } : {}),
      },
    };
  }

  async getTasks(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    // Heal eMAR-linked tasks if the MAR round is already complete (Home reads completions).
    await this.syncEmarLinkedTasksIfRoundComplete({
      employeeId,
      jobId,
      serviceUserId: ctx.job.serviceUserId,
      medicationRoundCode: ctx.medicationRoundCode,
      visitStart: ctx.primaryVisit.scheduledStartDateTime,
      timeZone: ctx.timeZone,
    });

    const since =
      ctx.primaryVisit.actualStartDateTime ?? ctx.primaryVisit.scheduledStartDateTime;
    const [raw, medProgress, obsCount, progress] = await Promise.all([
      this.housekeeping.getVisitJobTasks('', jobId),
      this.resolveMedicationProgress(ctx),
      this.countVisitObservations(ctx.job.serviceUserId, since),
      this.resolveProgress(ctx),
    ]);

    const tasks = (raw.data.tasks as Array<Record<string, unknown>>).map((task) => {
      const name = String(task.name ?? '');
      const groupCode = String(task.groupCode ?? '');
      const obsLink = resolveTaskObsLink({
        name,
        groupCode,
        flagsJson: task.flagsJson,
      });
      const emarLink = resolveTaskModuleLink(
        name,
        groupCode,
        ctx.primaryVisit.medicationRequired,
      );
      // Obs badge only when a concrete observation type is resolved (never catalog-only).
      const moduleLink =
        emarLink?.id === 'emar'
          ? emarLink
          : obsLink
            ? { id: 'obs' as const, label: 'Obs', tone: 'success' as Tone }
            : null;
      const priority = String(task.priority ?? 'routine');
      // COMPLETED / PARTIAL / DECLINED all count as addressed for progress.
      const isCompleted = isVisitTaskAddressed({
        isCompleted: Boolean(task.isCompleted),
        recordedValue: task.recordedValue != null ? String(task.recordedValue) : null,
        notes: task.notes != null ? String(task.notes) : null,
      });
      const outcome = inferVisitTaskOutcome({
        isCompleted: Boolean(task.isCompleted),
        recordedValue: task.recordedValue != null ? String(task.recordedValue) : null,
        notes: task.notes != null ? String(task.notes) : null,
      });
      const completedAt = task.completedAt ? String(task.completedAt) : null;
      const twoPersonFlags = mapTwoPersonTaskFlags(Boolean(task.requiresMultipleCarers));

      let subtext: string | null = null;
      if (moduleLink?.id === 'emar') {
        subtext = `${medProgress.givenCount} of ${medProgress.dueCount} medicines given`;
      } else if (task.recordedValue) {
        subtext = String(task.recordedValue);
      } else if (task.notes) {
        subtext = String(task.notes);
      }

      return {
        id: String(task.assignmentId ?? task.taskCatalogueTaskId ?? ''),
        assignmentId: task.assignmentId,
        taskCatalogueTaskId: task.taskCatalogueTaskId,
        title: name,
        name,
        subtitle: subtext,
        subtext,
        category: task.categoryName != null ? String(task.categoryName) : null,
        categoryName: task.categoryName,
        groupCode: task.groupCode,
        priority,
        isExtra: Boolean(task.isExtra),
        done: isCompleted,
        isCompleted,
        outcome,
        completedAt,
        completedLabel: completedAt
          ? `Completed · ${formatHmUtc(new Date(completedAt))}`
          : null,
        recordedValue: task.recordedValue ?? null,
        notes: stripVisitTaskOutcomeNotes(
          task.notes != null ? String(task.notes) : null,
        ),
        completionInput: task.completionInput,
        instruction:
          task.carerInstructions != null ? String(task.carerInstructions) : null,
        carerInstructions: task.carerInstructions ?? null,
        bodyMapRequired: Boolean(task.bodyMapRequired),
        iconType: iconForTaskGroup(groupCode),
        badge: moduleLink?.label ?? null,
        badgeTone: moduleLink?.tone ?? null,
        linkTab:
          moduleLink?.id === 'emar' ? 'mar' : moduleLink?.id === 'obs' ? 'obs' : null,
        linkedTypeCode: obsLink?.linkedTypeCode ?? null,
        observationTypeCode: obsLink?.observationTypeCode ?? null,
        moduleLink,
        /** Canonical dual-carer flag (from TaskCatalogueTask.requiresMultipleCarers). */
        twoPerson: twoPersonFlags.twoPerson,
        /** Alias for mobile copy (“Your presence needed”); same as twoPerson. */
        requiresSupport: twoPersonFlags.requiresSupport,
        requiredForRoles: twoPersonFlags.requiredForRoles,
      };
    });

    // One-way heal only: completed Obs-linked tasks mirror into observations.
    // Never re-complete a task from Obs on GET (that fought Home after reopen).
    for (const task of tasks) {
      if (!task.isCompleted || !task.observationTypeCode) continue;
      if (!task.recordedValue && !task.notes) continue;
      await this.syncObservationFromCompletedTask({
        employeeId,
        jobId,
        serviceUserId: ctx.job.serviceUserId,
        visitId: ctx.primaryVisit.id,
        taskName: String(task.name ?? ''),
        groupCode: task.groupCode != null ? String(task.groupCode) : null,
        recordedValue: task.recordedValue != null ? String(task.recordedValue) : null,
        notes: task.notes != null ? String(task.notes) : null,
      });
    }

    // 24 Aug 2026: every visit task must be addressed — no required/optional split.
    const builtProgress = this.buildProgress(
      { tasksDone: progress.tasksDone, tasksTotal: progress.tasksTotal, obsCount },
      medProgress,
    );

    return {
      data: {
        progress: builtProgress,
        medicationRoundCode: raw.data.medicationRoundCode,
        roundLabel: raw.data.roundLabel,
        windowStart: raw.data.windowStart,
        windowEnd: raw.data.windowEnd,
        requiredTasks: tasks,
        optionalTasks: [],
        tasks,
      },
    };
  }

  async saveTasks(employeeId: string, jobId: string, dto: SaveVisitJobTasksDto) {
    await this.assertOperationsUnlocked(employeeId, jobId);
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
    const [allergies, medicationPayload, progress, medProgress] = await Promise.all([
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
        sections: medicationPayload.sections,
        blisterPacks: medicationPayload.blisterPacks,
      },
    };
  }

  async getObservations(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const since = ctx.primaryVisit.actualStartDateTime ?? ctx.primaryVisit.scheduledStartDateTime;
    const [progress, medProgress, payload] = await Promise.all([
      this.resolveProgress(ctx),
      this.resolveMedicationProgress(ctx),
      this.visitObservationsCatalog.buildVisitObservationsPayload({
        serviceUserId: ctx.job.serviceUserId,
        since,
        scheduledJobId: jobId,
      }),
    ]);

    return {
      data: {
        progress: this.buildProgress(progress, medProgress),
        ...payload,
      },
    };
  }

  /**
   * @deprecated Catalog is built by VisitObservationsCatalogService — kept as thin wrapper.
   */
  private async buildObservationsCatalogPayload(serviceUserId: string) {
    return this.visitObservationsCatalog.buildCatalogPayload(serviceUserId);
  }

  private async loadVisitObservations(serviceUserId: string, since: Date) {
    return this.visitObservationsCatalog.loadVisitObservations(serviceUserId, since);
  }

  private async persistWellbeingScores(
    observationId: string,
    scores: Array<{ dimensionCode: string; level: number }>,
  ) {
    if (!scores.length) return;
    const codes = [...new Set(scores.map((s) => s.dimensionCode.toUpperCase()))];
    const dimensions = await this.prisma.wellbeingDimension.findMany({
      where: { code: { in: codes }, isActive: true },
    });
    if (dimensions.length !== codes.length) {
      throw new BadRequestException('One or more wellbeing dimensions are invalid');
    }
    const byCode = new Map(dimensions.map((d) => [d.code, d]));
    await this.prisma.wellbeingObservationScore.deleteMany({ where: { observationId } });
    await this.prisma.wellbeingObservationScore.createMany({
      data: scores.map((s) => ({
        observationId,
        dimensionId: byCode.get(s.dimensionCode.toUpperCase())!.id,
        level: s.level,
      })),
    });
  }

  async createObservation(
    employeeId: string,
    jobId: string,
    dto: CreateServiceUserObservationDto,
  ) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const type = await this.prisma.observationType.findFirst({
      where: {
        code: resolveObservationTypeCode(dto.observationTypeCode),
        isActive: true,
      },
    });
    if (!type) throw new BadRequestException('Invalid observation type');
    validateObservationCreate(type.code, type.valueKind, dto);
    const wellbeingScores =
      dto.wellbeingScores?.map((s) => ({
        dimensionCode: s.dimensionCode,
        level: s.level,
      })) ?? extractWellbeingScoresFromPayload(dto.payload);

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
    await this.persistWellbeingScores(row.id, wellbeingScores);

    return {
      data: {
        id: row.id,
        observationTypeCode: row.observationType.code,
        observationTypeName: row.observationType.name,
        recordedAt: row.recordedAt.toISOString(),
        valueLabel: formatVisitObservationValue(row),
        statusLabel: inferVisitObservationStatus(row.observationType.code, row.numericValue, row.payload),
        tone: 'success' as Tone,
      },
    };
  }

  async getLog(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const [progress, medProgress, timeline, handoverNote] = await Promise.all([
      this.resolveProgress(ctx),
      this.resolveMedicationProgress(ctx),
      this.visitTimeline.listForJob(jobId),
      this.resolveHandoverNote(ctx),
    ]);

    const meta = this.parseMetadata(ctx.job.metadata);
    const employeeApp =
      typeof meta.employeeApp === 'object' && meta.employeeApp
        ? (meta.employeeApp as Record<string, unknown>)
        : {};
    const storedIncidents = Array.isArray(employeeApp.incidents)
      ? (employeeApp.incidents as Array<Record<string, unknown>>)
      : [];

    return {
      data: {
        progress: this.buildProgress(progress, medProgress),
        timeline,
        incidents: {
          title: 'INCIDENTS',
          reportLabel: 'Report an incident',
          description: 'Falls, medication errors, safeguarding concerns.',
          items: storedIncidents.map((inc) => {
            const bodyMapRaw =
              inc.bodyMap && typeof inc.bodyMap === 'object' && !Array.isArray(inc.bodyMap)
                ? (inc.bodyMap as Record<string, unknown>)
                : null;
            const regions = Array.isArray(bodyMapRaw?.regions)
              ? bodyMapRaw!.regions.map((r) => String(r))
              : [];
            const marks = Array.isArray(bodyMapRaw?.marks)
              ? bodyMapRaw!.marks
                  .filter((m) => m && typeof m === 'object' && !Array.isArray(m))
                  .map((m) => {
                    const mark = m as Record<string, unknown>;
                    return {
                      view: String(mark.view ?? ''),
                      x: Number(mark.x),
                      y: Number(mark.y),
                      part: String(mark.part ?? ''),
                      ...(mark.canvasView != null ? { canvasView: String(mark.canvasView) } : {}),
                      ...(mark.recordView != null ? { recordView: String(mark.recordView) } : {}),
                    };
                  })
                  .filter((m) => m.view && m.part && !Number.isNaN(m.x) && !Number.isNaN(m.y))
              : [];
            return {
              id: String(inc.id ?? ''),
              incidentType: String(inc.incidentType ?? ''),
              body: String(inc.body ?? ''),
              severity: inc.severity != null ? String(inc.severity) : null,
              isDraft: Boolean(inc.isDraft),
              recordedAt: inc.recordedAt != null ? String(inc.recordedAt) : null,
              ...(bodyMapRaw
                ? {
                    bodyMap: {
                      regions,
                      ...(marks.length > 0 ? { marks } : {}),
                      ...(bodyMapRaw.notes != null ? { notes: String(bodyMapRaw.notes) } : {}),
                    },
                  }
                : {}),
            };
          }),
        },
        handoverNote,
      },
    };
  }

  async getBodyMap(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const serviceUserId = ctx.job.serviceUserId;
    const visit = ctx.primaryVisit;
    const [handover, progress, medProgress, lookups, bodyMapList, observations] = await Promise.all([
      this.bodyMap.handoverPreview(serviceUserId),
      this.resolveProgress(ctx),
      this.resolveMedicationProgress(ctx),
      this.bodyMap.lookups(),
      this.bodyMap.listForServiceUser(serviceUserId, false),
      this.getObservations(employeeId, jobId),
    ]);

    const enrichedRecords = bodyMapList.records.map(enrichBodyMapRecordForMobile);
    const recordsThisVisit = enrichedRecords.filter((r) => r.scheduledJobId === jobId);
    const chartMaxNumber = enrichedRecords.reduce(
      (max, r) => Math.max(max, r.canvasDisplayNumber ?? 0),
      0,
    );
    const observationPins = flattenObservationBodyMapPins(
      observations.data?.recordedThisVisit ?? [],
      chartMaxNumber,
    );

    return {
      data: {
        serviceUserId,
        scheduledJobId: jobId,
        scheduledVisitId: visit.id,
        progress: this.buildProgress(progress, medProgress),
        handover,
        lookups,
        /** All active chart markers for this client (handover context). */
        records: enrichedRecords,
        /** Chart records linked to this visit — includes admin + mobile saves. */
        recordsThisVisit,
        /** Observation payload pins (API-13) on this visit — blue overlay on admin; render on mobile too. */
        observationPins,
        diagram: bodyMapDiagramCatalogForMobile(),
        canRecord: this.isEmployeeCheckedInForVisit(employeeId, ctx),
      },
    };
  }

  async getBodyMapWizard(employeeId: string, jobId: string) {
    const base = await this.getBodyMap(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const eligibleMedications = await this.listBodyMapEligibleMedications(ctx.job.serviceUserId);
    return {
      data: {
        ...base.data,
        wizard: {
          ...employeeAppBodyMapWizardCatalog(),
          eligibleMedications,
        },
      },
    };
  }

  async submitBodyMapWizardRecord(
    employeeId: string,
    jobId: string,
    dto: EmployeeAppBodyMapWizardSubmitDto,
  ) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    if (!this.isEmployeeCheckedInForVisit(employeeId, ctx)) {
      contractError('NOT_CHECKED_IN', 'Clock in before recording a body map observation');
    }

    const visitClosed =
      ctx.primaryVisit.status === ScheduledVisitStatus.COMPLETED ||
      ctx.primaryVisit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      ctx.primaryVisit.status === ScheduledVisitStatus.CANCELLED ||
      ctx.primaryVisit.status === ScheduledVisitStatus.CALLED_OFF ||
      ctx.primaryVisit.status === ScheduledVisitStatus.MISSED;
    if (visitClosed) {
      contractError('VISIT_COMPLETED', 'Visit is already closed');
    }

    const createDto = mapWizardSubmitToCreateDto(
      jobId,
      ctx.primaryVisit.id,
      ctx.job.serviceUserId,
      employeeId,
      dto,
    );

    let record;
    try {
      record = await this.bodyMap.createRecord(undefined, createDto);
    } catch (e) {
      if (e instanceof BadRequestException) {
        const msg =
          typeof e.getResponse() === 'string'
            ? e.getResponse()
            : (e.getResponse() as { message?: string | string[] })?.message;
        validationError(Array.isArray(msg) ? msg.join('; ') : String(msg ?? e.message));
      }
      throw e;
    }

    return this.finalizeBodyMapRecordWrite({
      employeeId,
      jobId,
      visitId: ctx.primaryVisit.id,
      idempotencyKey: dto.idempotencyKey,
      deviceRecordedAt: dto.deviceRecordedAt,
      record,
    });
  }

  private async listBodyMapEligibleMedications(serviceUserId: string) {
    const rows = await this.prisma.serviceUserMedication.findMany({
      where: { serviceUserId, deletedAt: null, status: 'ACTIVE' },
      include: {
        medicationType: { select: { code: true, name: true, requiresBodyMapSite: true } },
        route: { select: { code: true, name: true, requiresBodyMapSite: true } },
        frequency: { select: { name: true } },
      },
      orderBy: { medicationName: 'asc' },
    });
    return rows
      .filter((m) => medicationRequiresBodyMapSiteFromMed(m))
      .map((m) => ({
        id: m.id,
        medicationName: m.medicationName,
        strength: m.strength,
        frequencyText: m.frequencyText ?? m.frequency?.name ?? null,
        medicationTypeCode: m.medicationType?.code ?? null,
        routeCode: m.route?.code ?? null,
      }));
  }

  private async finalizeBodyMapRecordWrite(input: {
    employeeId: string;
    jobId: string;
    visitId: string;
    idempotencyKey: string;
    deviceRecordedAt: string;
    record: Awaited<ReturnType<BodyMapService['createRecord']>>;
  }) {
    const { employeeId, jobId, visitId, idempotencyKey, deviceRecordedAt, record } = input;
    const now = new Date().toISOString();
    const auditRecordId = newAuditRecordId();
    const response = {
      recordId: record.id,
      entryType: 'body_map' as const,
      serverConfirmedAt: now,
      auditRecordId,
      record,
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => ({
      ...ea,
      idempotency: {
        ...((ea.idempotency as Record<string, unknown>) ?? {}),
        [idempotencyKey]: response,
      },
    }));

    const marker = record.markers?.[0];
    const title = record.title ?? record.recordType ?? 'Body map';
    const detailParts = [
      marker?.bodyPart,
      record.riskLevel ? `Risk: ${record.riskLevel}` : null,
      record.description,
    ].filter(Boolean);
    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: visitId,
      eventType: 'body_map',
      sourceType: 'body_map',
      sourceId: record.id,
      title: String(title).slice(0, 120),
      detail: summarizeTimelineDetail(detailParts.join(' · ')),
      tone: record.safeguardingTriggered || record.managerReviewRequired ? 'danger' : 'warning',
      occurredAt: parseOccurredAt(deviceRecordedAt, new Date(now)),
      logEntryId: record.id,
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: idempotencyKey,
    });

    return { data: response };
  }

  async createBodyMapRecord(
    employeeId: string,
    jobId: string,
    dto: EmployeeAppCreateBodyMapRecordDto,
  ) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    if (!this.isEmployeeCheckedInForVisit(employeeId, ctx)) {
      contractError('NOT_CHECKED_IN', 'Clock in before recording a body map observation');
    }

    const visitClosed =
      ctx.primaryVisit.status === ScheduledVisitStatus.COMPLETED ||
      ctx.primaryVisit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      ctx.primaryVisit.status === ScheduledVisitStatus.CANCELLED ||
      ctx.primaryVisit.status === ScheduledVisitStatus.CALLED_OFF ||
      ctx.primaryVisit.status === ScheduledVisitStatus.MISSED;
    if (visitClosed) {
      contractError('VISIT_COMPLETED', 'Visit is already closed');
    }

    const {
      deviceRecordedAt,
      idempotencyKey,
      clientEntryId,
      ...recordFields
    } = dto;

    const observationDetails = {
      ...(recordFields.observationDetails ?? {}),
      recordedDuringVisit: true,
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      recordedByEmployeeId: employeeId,
      channel: 'employee_app',
      ...(clientEntryId ? { clientEntryId } : {}),
    };

    const createDto: CreateBodyMapRecordDto = {
      ...(recordFields as Omit<CreateBodyMapRecordDto, 'serviceUserId' | 'observationDetails'>),
      serviceUserId: ctx.job.serviceUserId,
      observationDetails,
    };

    let record;
    try {
      record = await this.bodyMap.createRecord(undefined, createDto);
    } catch (e) {
      if (e instanceof BadRequestException) {
        const msg =
          typeof e.getResponse() === 'string'
            ? e.getResponse()
            : (e.getResponse() as { message?: string | string[] })?.message;
        validationError(Array.isArray(msg) ? msg.join('; ') : String(msg ?? e.message));
      }
      throw e;
    }

    return this.finalizeBodyMapRecordWrite({
      employeeId,
      jobId,
      visitId: ctx.primaryVisit.id,
      idempotencyKey,
      deviceRecordedAt,
      record,
    });
  }

  private async assertBodyMapRecordOnVisit(
    employeeId: string,
    jobId: string,
    recordId: string,
  ) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const record = await this.bodyMap.getRecord(recordId);
    if (record.serviceUserId !== ctx.job.serviceUserId) {
      throw new ForbiddenException('Body map record is not on this visit');
    }
    return { ctx, record };
  }

  async addBodyMapReview(
    employeeId: string,
    jobId: string,
    recordId: string,
    dto: CreateBodyMapReviewDto,
  ) {
    const { ctx } = await this.assertBodyMapRecordOnVisit(employeeId, jobId, recordId);
    if (!this.isEmployeeCheckedInForVisit(employeeId, ctx)) {
      contractError('NOT_CHECKED_IN', 'Clock in before updating a body map record');
    }
    return { data: await this.bodyMap.addReview(undefined, recordId, dto) };
  }

  async uploadBodyMapPhoto(
    employeeId: string,
    jobId: string,
    recordId: string,
    file: Express.Multer.File,
    consentStatus: BodyMapPhotoConsentStatus,
    caption?: string,
  ) {
    const { ctx } = await this.assertBodyMapRecordOnVisit(employeeId, jobId, recordId);
    if (!this.isEmployeeCheckedInForVisit(employeeId, ctx)) {
      contractError('NOT_CHECKED_IN', 'Clock in before adding a body map photo');
    }
    return {
      data: await this.bodyMap.uploadPhoto(undefined, recordId, file, consentStatus, caption),
    };
  }

  async patchRotationCheckForVisit(
    employeeId: string,
    jobId: string,
    opts: { bodyView: string; x: number; y: number },
  ) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    return this.bodyMap.patchRotationCheck(ctx.job.serviceUserId, opts);
  }

  private resolveCheckInMethod(
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    employeeId?: string,
  ): string {
    const checkIns =
      typeof ctx.employeeAppMeta.checkIns === 'object' && ctx.employeeAppMeta.checkIns
        ? (ctx.employeeAppMeta.checkIns as Record<string, unknown>)
        : null;
    const mine =
      employeeId && checkIns && typeof checkIns[employeeId] === 'object' && checkIns[employeeId]
        ? (checkIns[employeeId] as Record<string, unknown>)
        : null;
    const raw = mine?.method ?? ctx.checkIn?.method;
    return normalizeCheckInMethod(typeof raw === 'string' ? raw : null);
  }

  private async assertOperationsUnlocked(employeeId: string, jobId: string) {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { metadata: true },
    });
    const metadata =
      job?.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};
    const employeeApp =
      typeof metadata.employeeApp === 'object' && metadata.employeeApp
        ? (metadata.employeeApp as Record<string, unknown>)
        : {};
    const checkIns =
      typeof employeeApp.checkIns === 'object' && employeeApp.checkIns
        ? (employeeApp.checkIns as Record<string, unknown>)
        : null;
    const mine =
      checkIns && typeof checkIns[employeeId] === 'object' && checkIns[employeeId]
        ? (checkIns[employeeId] as Record<string, unknown>)
        : null;
    const checkIn =
      typeof employeeApp.checkIn === 'object' && employeeApp.checkIn
        ? (employeeApp.checkIn as Record<string, unknown>)
        : null;
    const raw = mine?.method ?? checkIn?.method;
    if (normalizeCheckInMethod(typeof raw === 'string' ? raw : null) !== 'GPS') {
      return;
    }
    await this.areaLocks.assertUnlocked(jobId);
  }

  private isEmployeeCheckedInForVisit(
    employeeId: string,
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
  ): boolean {
    const visit = ctx.primaryVisit;
    const myAllocation = ctx.job.allocations.find((a) => a.employeeId === employeeId);
    const multi = isMultiCarerVisit(ctx.job.requiredCarers, ctx.job.allocations);
    if (multi) {
      return (
        Boolean(myAllocation?.actualStartDateTime) ||
        Boolean(visit.actualStartDateTime) ||
        Boolean(ctx.checkIn)
      );
    }
    return (
      Boolean(visit.actualStartDateTime) ||
      visit.status === ScheduledVisitStatus.STARTED ||
      Boolean(ctx.checkIn)
    );
  }

  async complete(employeeId: string, jobId: string, dto: EmployeeAppVisitCompleteDto) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const role = resolveCarerRole(employeeId, ctx.job.requiredCarers, ctx.job.allocations);

    // Support on double-up: end this carer's attendance only — visit stays open for lead.
    if (role === 'support') {
      return this.completeAsSupport(employeeId, jobId, ctx, dto);
    }

    const status = mapVisitOutcomeToStatus(
      dto.visitOutcome,
      dto.status as LocalVisitStatus | undefined,
    );
    if (!isEmployeeAppCompletionStatus(status)) {
      throw new BadRequestException(
        `Carer app cannot set status ${status}. Allowed: COMPLETED, PARTIALLY_COMPLETED, MISSED, NEEDS_ATTENTION. Use office schedule-jobs for cancel/call-off.`,
      );
    }

    // Idempotent: already completed + client asks COMPLETED → 200, not 400.
    const visitAlreadyCompleted =
      ctx.primaryVisit.status === ScheduledVisitStatus.COMPLETED ||
      ctx.job.status === ScheduledJobStatus.COMPLETED;
    if (status === LocalVisitStatus.COMPLETED && visitAlreadyCompleted) {
      await this.visitTimeline.upsertEvent({
        scheduledJobId: jobId,
        scheduledVisitId: ctx.primaryVisit.id,
        eventType: 'clock_out',
        sourceType: 'complete',
        sourceId: 'complete',
        title: 'Clocked out',
        detail: 'Visit complete',
        tone: 'success',
        occurredAt: parseOccurredAt(dto.deviceRecordedAt, new Date()),
        createdByEmployeeId: employeeId,
        writeIdempotencyKey: dto.idempotencyKey,
      });
      return this.buildCompleteResponse(employeeId, jobId, ctx, {
        status: LocalVisitStatus.COMPLETED,
        message: 'Visit already completed',
        actualStartDateTime: dto.actualStartDateTime,
        actualEndDateTime: dto.actualEndDateTime,
      });
    }

    // Enforce clinical gates only for explicit contract full-delivery / leaving-safe flows.
    // Legacy COMPLETED without visitOutcome/leavingSafeChecks stays permissive for one release.
    // Lead may complete even if support is still checked in / on site.
    const enforceGates =
      dto.visitOutcome === 'fully_delivered' ||
      (status === LocalVisitStatus.COMPLETED && dto.leavingSafeChecks != null);
    if (enforceGates) {
      await this.assertFullDeliveryGates(ctx, dto);
    }

    const outcome = EMPLOYEE_APP_COMPLETION_OUTCOMES.find((o) => o.status === status)!;
    const notes = dto.handoverNote?.trim() || dto.notes?.trim() || undefined;
    if (outcome.requiresNotes && !notes) {
      throw new BadRequestException(`Notes are required when status is ${status}`);
    }

    const myAllocation = ctx.job.allocations.find((a) => a.employeeId === employeeId);
    const endIso = dto.actualEndDateTime ?? new Date().toISOString();
    const startIso =
      dto.actualStartDateTime ??
      myAllocation?.actualStartDateTime?.toISOString() ??
      ctx.primaryVisit.actualStartDateTime?.toISOString();

    const endDate = new Date(endIso);
    const plannedEnd =
      ctx.job.scheduledEndDateTime ?? ctx.primaryVisit.scheduledEndDateTime ?? null;
    await this.assertClockOutEndReason(dto, plannedEnd, endDate, 15);

    const previousMetaForTiming = this.parseMetadata(ctx.job.metadata);
    const eaMeta =
      typeof previousMetaForTiming.employeeApp === 'object' && previousMetaForTiming.employeeApp
        ? (previousMetaForTiming.employeeApp as Record<string, unknown>)
        : {};
    const checkInsMeta =
      typeof eaMeta.checkIns === 'object' && eaMeta.checkIns
        ? (eaMeta.checkIns as Record<string, unknown>)
        : {};
    const myCheckIn =
      (typeof checkInsMeta[employeeId] === 'object' && checkInsMeta[employeeId]
        ? (checkInsMeta[employeeId] as Record<string, unknown>)
        : null) ??
      (typeof eaMeta.checkIn === 'object' && eaMeta.checkIn
        ? (eaMeta.checkIn as Record<string, unknown>)
        : null);
    const checkInReason =
      typeof myCheckIn?.timingExceptionReasonCode === 'string'
        ? myCheckIn.timingExceptionReasonCode.trim()
        : '';
    const checkInNotes =
      typeof myCheckIn?.timingExceptionNotes === 'string'
        ? myCheckIn.timingExceptionNotes.trim()
        : '';

    const result = await this.housekeeping.completeJob('', jobId, {
      status,
      notes,
      deliveredCarePlanFormIds: dto.deliveredCarePlanFormIds,
      deliveredCarePlanDetails: dto.deliveredCarePlanDetails,
      extraCareNotes: dto.extraCareNotes,
      actualStartDateTime: startIso,
      actualEndDateTime: endIso,
      overrunReason: dto.overrunReason,
      timingExceptionReasonCode: dto.timingExceptionReasonCode?.trim() || checkInReason || undefined,
      timingExceptionNotes: dto.timingExceptionNotes?.trim() || checkInNotes || undefined,
    });

    // Lead allocation clock-out only — do not force support allocation end if still on site.
    if (myAllocation?.id) {
      await this.prisma.jobAllocation.update({
        where: { id: myAllocation.id },
        data: {
          actualStartDateTime:
            myAllocation.actualStartDateTime ??
            (startIso ? new Date(startIso) : new Date()),
          actualEndDateTime: new Date(endIso),
        },
      });
    }

    const now = new Date();
    const hasGps = dto.latitude != null && dto.longitude != null;
    const geofence = hasGps
      ? await this.evaluateGeofence(ctx, dto.latitude, dto.longitude)
      : { withinArea: true, distanceMeters: null as number | null };

    const previousMeta = this.parseMetadata(
      (await this.prisma.scheduledJob.findUnique({ where: { id: jobId }, select: { metadata: true } }))
        ?.metadata,
    );
    const employeeApp = {
      ...(typeof previousMeta.employeeApp === 'object' && previousMeta.employeeApp
        ? (previousMeta.employeeApp as Record<string, unknown>)
        : {}),
      checkOut: {
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        accuracyMeters: dto.accuracyMeters ?? null,
        isMockLocation: dto.isMockedLocation ?? dto.isMockLocation ?? false,
        withinArea: dto.withinArea ?? geofence.withinArea,
        distanceMeters: dto.distanceMeters ?? geofence.distanceMeters,
        completedAt: now.toISOString(),
        deviceRecordedAt: dto.deviceRecordedAt ?? null,
        idempotencyKey: dto.idempotencyKey ?? null,
        employeeId,
        status,
        visitOutcome: dto.visitOutcome ?? null,
        leavingSafeChecks: dto.leavingSafeChecks ?? null,
        outsideGeofence: !geofence.withinArea,
        role: role ?? 'lead',
      },
    };
    await this.prisma.scheduledJob.update({
      where: { id: jobId },
      data: {
        metadata: {
          ...previousMeta,
          ecmCompletionSource: 'mobile',
          employeeApp,
        } as Prisma.InputJsonValue,
      },
    });

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
      isMockLocation: dto.isMockedLocation ?? dto.isMockLocation ?? false,
      outsideGeofence: !geofence.withinArea,
      distanceMeters: geofence.distanceMeters,
      clientEventId: dto.idempotencyKey ?? undefined,
    });

    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      eventType: 'clock_out',
      sourceType: 'complete',
      sourceId: 'complete',
      title: 'Clocked out',
      detail: 'Visit complete',
      tone: 'success',
      occurredAt: parseOccurredAt(dto.deviceRecordedAt, now),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    await this.ecmEvaluation.evaluateJobSafe(jobId);

    this.carerPush.notify({
      employeeIds: [employeeId],
      kind: CarerVisitPushKind.VISIT_COMPLETE,
      title: 'Visit completed',
      body: `"${ctx.job.jobName}" is complete.`,
      scheduledJobId: jobId,
      serviceUserId: ctx.job.serviceUserId,
    });

    return this.buildCompleteResponse(employeeId, jobId, ctx, {
      status,
      message: result.message,
      actualStartDateTime: dto.actualStartDateTime,
      actualEndDateTime: dto.actualEndDateTime,
      job: result.data,
    });
  }

  /**
   * Support carer clock-out on a double-up visit.
   * Does NOT close the visit/job — only ends this allocation's attendance.
   * Gates: twoPerson / requiresSupport tasks must be addressed; no MAR/obs/log/all-tasks.
   */
  private async completeAsSupport(
    employeeId: string,
    jobId: string,
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    dto: EmployeeAppVisitCompleteDto,
  ) {
    const visit = ctx.primaryVisit;
    const myAllocation = ctx.job.allocations.find((a) => a.employeeId === employeeId);

    if (
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF ||
      visit.status === ScheduledVisitStatus.MISSED
    ) {
      // Visit already closed by lead — idempotent success for support.
      return this.buildCompleteResponse(employeeId, jobId, ctx, {
        status: visit.status as LocalVisitStatus,
        message: 'Visit already completed by lead',
        actualStartDateTime: dto.actualStartDateTime,
        actualEndDateTime: dto.actualEndDateTime,
        supportCheckoutOnly: true,
        visitRemainsOpen: false,
      });
    }

    if (myAllocation?.actualEndDateTime) {
      return this.buildCompleteResponse(employeeId, jobId, ctx, {
        status: LocalVisitStatus.STARTED,
        message: 'Support carer already clocked out — visit remains open for lead',
        actualStartDateTime:
          dto.actualStartDateTime ?? myAllocation.actualStartDateTime?.toISOString(),
        actualEndDateTime: myAllocation.actualEndDateTime.toISOString(),
        supportCheckoutOnly: true,
        visitRemainsOpen: true,
      });
    }

    if (!myAllocation?.actualStartDateTime && !visit.actualStartDateTime) {
      contractError('NOT_CHECKED_IN', 'Clock in before completing as support');
    }

    await this.assertSupportTwoPersonTasksDone(jobId);

    const now = new Date();
    const endAt = dto.actualEndDateTime ? new Date(dto.actualEndDateTime) : now;
    const startAt =
      myAllocation?.actualStartDateTime ??
      (dto.actualStartDateTime ? new Date(dto.actualStartDateTime) : null) ??
      visit.actualStartDateTime ??
      now;

    if (myAllocation?.id) {
      await this.prisma.jobAllocation.update({
        where: { id: myAllocation.id },
        data: {
          actualStartDateTime: myAllocation.actualStartDateTime ?? startAt,
          actualEndDateTime: endAt,
        },
      });
    }

    const previousMeta = this.parseMetadata(
      (await this.prisma.scheduledJob.findUnique({ where: { id: jobId }, select: { metadata: true } }))
        ?.metadata,
    );
    const previousEa =
      typeof previousMeta.employeeApp === 'object' && previousMeta.employeeApp
        ? (previousMeta.employeeApp as Record<string, unknown>)
        : {};
    const previousCheckOuts =
      typeof previousEa.supportCheckOuts === 'object' && previousEa.supportCheckOuts
        ? (previousEa.supportCheckOuts as Record<string, unknown>)
        : {};
    const supportCheckout = {
      completedAt: now.toISOString(),
      actualStartDateTime: startAt.toISOString(),
      actualEndDateTime: endAt.toISOString(),
      deviceRecordedAt: dto.deviceRecordedAt ?? null,
      idempotencyKey: dto.idempotencyKey ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      accuracyMeters: dto.accuracyMeters ?? null,
      isMockLocation: dto.isMockedLocation ?? dto.isMockLocation ?? false,
      employeeId,
      role: 'support',
    };
    await this.prisma.scheduledJob.update({
      where: { id: jobId },
      data: {
        metadata: {
          ...previousMeta,
          employeeApp: {
            ...previousEa,
            supportCheckOuts: { ...previousCheckOuts, [employeeId]: supportCheckout },
          },
        } as Prisma.InputJsonValue,
      },
    });

    await this.attendance.recordEvent({
      scheduledJobId: jobId,
      scheduledVisitId: visit.id,
      jobAllocationId: ctx.allocationId,
      employeeId,
      eventType: VisitAttendanceEventType.CHECK_OUT,
      verificationMethod: VisitAttendanceVerificationMethod.MOBILE_GPS,
      occurredAt: endAt,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyMeters: dto.accuracyMeters,
      isMockLocation: dto.isMockedLocation ?? dto.isMockLocation ?? false,
      clientEventId: dto.idempotencyKey ?? undefined,
    });

    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: visit.id,
      eventType: 'clock_out',
      sourceType: 'complete',
      sourceId: `support_complete:${employeeId}`,
      title: 'Support clocked out',
      detail: 'Support carer left — visit remains open for lead',
      tone: 'primary',
      occurredAt: parseOccurredAt(dto.deviceRecordedAt, endAt),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    await this.ecmEvaluation.evaluateJobSafe(jobId);

    return this.buildCompleteResponse(employeeId, jobId, ctx, {
      status: LocalVisitStatus.STARTED,
      message: 'Support carer clocked out — visit remains open for lead',
      actualStartDateTime: startAt.toISOString(),
      actualEndDateTime: endAt.toISOString(),
      supportCheckoutOnly: true,
      visitRemainsOpen: true,
    });
  }

  private async assertSupportTwoPersonTasksDone(jobId: string) {
    const raw = await this.housekeeping.getVisitJobTasks('', jobId);
    const tasks = (raw.data.tasks as Array<Record<string, unknown>>) ?? [];
    const twoPerson = tasks.filter((t) => Boolean(t.requiresMultipleCarers));
    if (twoPerson.length === 0) return;

    const incomplete = twoPerson.filter(
      (t) =>
        !isVisitTaskAddressed({
          isCompleted: Boolean(t.isCompleted),
          recordedValue: t.recordedValue != null ? String(t.recordedValue) : null,
          notes: t.notes != null ? String(t.notes) : null,
        }),
    );
    if (incomplete.length > 0) {
      contractError(
        'SUPPORT_TASKS_INCOMPLETE',
        `Complete two-person / support-required tasks before clocking out (${twoPerson.length - incomplete.length}/${twoPerson.length} done)`,
      );
    }
  }

  private async buildCompleteResponse(
    employeeId: string,
    jobId: string,
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    opts: {
      status: LocalVisitStatus;
      message: string;
      actualStartDateTime?: string;
      actualEndDateTime?: string;
      job?: unknown;
      supportCheckoutOnly?: boolean;
      visitRemainsOpen?: boolean;
    },
  ) {
    const refreshed = await this.loadJobForEmployee(employeeId, jobId).catch(() => ctx);
    const [progress, medProgress] = await Promise.all([
      this.resolveProgress(refreshed),
      this.resolveMedicationProgress(refreshed),
    ]);

    const now = new Date();
    const start = opts.actualStartDateTime
      ? new Date(opts.actualStartDateTime)
      : refreshed.primaryVisit.actualStartDateTime;
    const end = opts.actualEndDateTime
      ? new Date(opts.actualEndDateTime)
      : refreshed.primaryVisit.actualEndDateTime ?? now;
    const durationMinutes =
      start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) : null;

    const role = resolveCarerRole(
      employeeId,
      refreshed.job.requiredCarers,
      refreshed.job.allocations,
    );

    return {
      data: {
        message: opts.message,
        jobId,
        status: statusToContractLabel(opts.status),
        completedAt: (end ?? now).toISOString(),
        durationMinutes,
        tasksDone: progress.tasksDone,
        tasksTotal: progress.tasksTotal,
        medsDone: medProgress.givenCount,
        medsTotal: medProgress.dueCount,
        obsCount: progress.obsCount,
        summaryLabel: `${progress.tasksDone}/${progress.tasksTotal} tasks · ${medProgress.givenCount}/${medProgress.dueCount} meds · ${progress.obsCount} obs`,
        alreadyCompleted: opts.message === 'Visit already completed',
        role: role ?? undefined,
        supportCheckoutOnly: opts.supportCheckoutOnly === true ? true : undefined,
        visitRemainsOpen: opts.visitRemainsOpen === true ? true : undefined,
        visitClosed: opts.visitRemainsOpen === true ? false : undefined,
        ...(opts.job !== undefined ? { job: opts.job } : {}),
      },
    };
  }

  async unableToStart(employeeId: string, jobId: string, dto: EmployeeAppUnableToStartDto) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const visit = ctx.primaryVisit;

    if (!isLeadCarerOnVisit(employeeId, ctx.job.requiredCarers, ctx.job.allocations)) {
      throw new ForbiddenException({
        code: 'LEAD_ONLY',
        message:
          'Only the lead carer can report unable to start on a double-up visit. Ask the lead to report, or contact the office.',
      });
    }

    const myAllocation = ctx.job.allocations.find((a) => a.employeeId === employeeId);
    const multi = isMultiCarerVisit(ctx.job.requiredCarers, ctx.job.allocations);
    const isCheckedIn = multi
      ? Boolean(myAllocation?.actualStartDateTime) ||
        Boolean(visit.actualStartDateTime) ||
        Boolean(ctx.checkIn)
      : Boolean(visit.actualStartDateTime) ||
        visit.status === ScheduledVisitStatus.STARTED ||
        Boolean(ctx.checkIn);
    if (!isCheckedIn) {
      contractError(
        'NOT_CHECKED_IN',
        'Clock in before reporting unable to start visit',
      );
    }

    const visitClosed =
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF ||
      visit.status === ScheduledVisitStatus.MISSED;
    if (visitClosed) {
      contractError('VISIT_COMPLETED', 'Visit is already closed');
    }

    const existingSummary = this.resolveUnableToStartSummary(ctx);
    if (existingSummary) {
      contractError('ALREADY_REPORTED', 'Unable to start has already been reported for this visit');
    }

    if (!isEmployeeAppUnableToStartReasonCode(dto.reasonCode)) {
      validationError(
        'reasonCode must be one of: CLIENT_NOT_HOME, CLIENT_IN_HOSPITAL, CLIENT_DECEASED, CLIENT_REFUSED, UNSAFE_SITUATION, OTHER',
      );
    }
    if (!dto.notes?.trim()) {
      validationError('notes are required');
    }

    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    const now = new Date();
    const attemptedAt = parseOccurredAt(dto.attemptedAt, now);
    const actualStart =
      myAllocation?.actualStartDateTime ??
      visit.actualStartDateTime ??
      (ctx.checkIn?.checkedInAt ? new Date(String(ctx.checkIn.checkedInAt)) : attemptedAt);
    const actualEnd =
      attemptedAt.getTime() > actualStart.getTime() ? attemptedAt : now;
    const notes = dto.notes.trim();
    const reasonLabel =
      employeeAppUnableToStartReasonLabel(dto.reasonCode) ?? dto.reasonCode;

    // Carer attended (checked in) but care was not delivered — keep COMPLETED + careNotDelivered.
    await this.housekeeping.completeJob('', jobId, {
      status: LocalVisitStatus.COMPLETED,
      notes: `[Unable to start: ${dto.reasonCode}] ${notes}`.trim(),
      actualStartDateTime: actualStart.toISOString(),
      actualEndDateTime: actualEnd.toISOString(),
      careNotDelivered: true,
      careNotDeliveredReasonCode: dto.reasonCode,
      careNotDeliveredNotes: notes,
    });

    const auditRecordId = newAuditRecordId();
    const refreshed = await this.loadJobForEmployee(employeeId, jobId).catch(() => ctx);
    const response = {
      jobId,
      status: 'unable_to_start',
      recordedAt: now.toISOString(),
      auditRecordId,
      reasonCode: dto.reasonCode,
      notes,
      visitStatus: refreshed.primaryVisit.status,
      officeNotified: true,
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => ({
      ...ea,
      unableToStart: {
        reasonCode: dto.reasonCode,
        reasonLabel,
        notes,
        attemptedAt: attemptedAt.toISOString(),
        employeeId,
        recordedAt: now.toISOString(),
        auditRecordId,
        officeNotified: true,
        // Checked in earlier; report closes the visit as attended / care not delivered.
        isCheckedIn: true,
      },
      checkOut: {
        ...(typeof ea.checkOut === 'object' && ea.checkOut
          ? (ea.checkOut as Record<string, unknown>)
          : {}),
        completedAt: actualEnd.toISOString(),
        deviceRecordedAt: attemptedAt.toISOString(),
        employeeId,
        status: LocalVisitStatus.COMPLETED,
        careNotDelivered: true,
        unableToStart: true,
      },
      idempotency: {
        ...((ea.idempotency as Record<string, unknown>) ?? {}),
        [dto.idempotencyKey]: response,
      },
    }));

    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: visit.id,
      eventType: 'concern',
      sourceType: 'complete',
      sourceId: 'unable_to_start',
      title: 'Unable to start visit',
      detail: `${reasonLabel}: ${notes}`,
      tone: dto.reasonCode === 'UNSAFE_SITUATION' || dto.reasonCode === 'CLIENT_DECEASED'
        ? 'danger'
        : 'warning',
      occurredAt: attemptedAt,
      logEntryId: auditRecordId,
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    await this.ecmEvaluation.evaluateJobSafe(jobId);
    return { data: response };
  }

  /**
   * Mark a co-carer as arrived/left for two-person task UI sync.
   * Independent of ECM check-in; does not block lead task writes.
   * Auth: caller must be allocated to the job; target must also be an active co-carer.
   */
  async setCoCarerPresence(
    employeeId: string,
    jobId: string,
    targetEmployeeId: string,
    dto: EmployeeAppCoCarerPresenceDto,
  ) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    if (!isMultiCarerVisit(ctx.job.requiredCarers, ctx.job.allocations)) {
      throw new BadRequestException(
        'Partner presence is only available on double-up (multi-carer) visits',
      );
    }

    const target = ctx.job.allocations.find(
      (a) => a.employeeId === targetEmployeeId && ACTIVE_ALLOCATION.includes(a.status),
    );
    if (!target) {
      throw new NotFoundException('Co-carer is not allocated to this visit');
    }

    const visit = ctx.primaryVisit;
    if (
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF ||
      visit.status === ScheduledVisitStatus.MISSED
    ) {
      contractError('VISIT_COMPLETED', 'Visit is already closed');
    }

    const previousMeta = this.parseMetadata(ctx.job.metadata);
    const previousEa =
      typeof previousMeta.employeeApp === 'object' && previousMeta.employeeApp
        ? (previousMeta.employeeApp as Record<string, unknown>)
        : {};
    const presenceMap = readCoCarerPresenceMap(previousEa);
    const existing = presenceMap[targetEmployeeId];
    if (
      existing?.updatedAt &&
      dto.idempotencyKey &&
      previousEa.coCarerPresenceIdempotency &&
      typeof previousEa.coCarerPresenceIdempotency === 'object' &&
      (previousEa.coCarerPresenceIdempotency as Record<string, unknown>)[
        `${targetEmployeeId}:${dto.idempotencyKey}`
      ]
    ) {
      const geofenceSettings = await this.loadGeofenceSettings();
      const progress = await this.resolveProgress(ctx);
      return {
        data: {
          message: 'Presence already recorded',
          jobId,
          employeeId: targetEmployeeId,
          present: existing.present,
          arrivedAt: existing.arrivedAt ?? null,
          leftAt: existing.leftAt ?? null,
          shell: await this.buildShell(ctx, progress, undefined, employeeId, geofenceSettings),
        },
      };
    }

    const at = parseOccurredAt(dto.at, new Date());
    const atIso = at.toISOString();
    const next: CoCarerPresenceRecord = {
      present: dto.present,
      arrivedAt: dto.present ? atIso : existing?.arrivedAt ?? null,
      leftAt: dto.present ? null : atIso,
      markedByEmployeeId: employeeId,
      updatedAt: new Date().toISOString(),
    };
    const idempotency =
      typeof previousEa.coCarerPresenceIdempotency === 'object' &&
      previousEa.coCarerPresenceIdempotency
        ? { ...(previousEa.coCarerPresenceIdempotency as Record<string, unknown>) }
        : {};
    idempotency[`${targetEmployeeId}:${dto.idempotencyKey}`] = next.updatedAt;

    await this.prisma.scheduledJob.update({
      where: { id: jobId },
      data: {
        metadata: {
          ...previousMeta,
          employeeApp: {
            ...previousEa,
            coCarerPresence: { ...presenceMap, [targetEmployeeId]: next },
            coCarerPresenceIdempotency: idempotency,
          },
        } as Prisma.InputJsonValue,
      },
    });

    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: visit.id,
      eventType: 'presence',
      sourceType: 'presence',
      sourceId: `presence:${targetEmployeeId}:${dto.idempotencyKey}`,
      title: dto.present ? 'Co-carer marked arrived' : 'Co-carer marked left',
      detail: dto.notes?.trim() || null,
      tone: 'primary',
      occurredAt: at,
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    const refreshed = await this.loadJobForEmployee(employeeId, jobId);
    const progress = await this.resolveProgress(refreshed);
    const geofenceSettings = await this.loadGeofenceSettings();
    return {
      data: {
        message: dto.present ? 'Co-carer marked arrived' : 'Co-carer marked left',
        jobId,
        employeeId: targetEmployeeId,
        present: next.present,
        arrivedAt: next.arrivedAt ?? null,
        leftAt: next.leftAt ?? null,
        shell: await this.buildShell(refreshed, progress, undefined, employeeId, geofenceSettings),
      },
    };
  }

  private buildUnableToStartPayload(
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    employeeId?: string,
  ) {
    const visit = ctx.primaryVisit;
    const myAllocation = employeeId
      ? ctx.job.allocations.find((a) => a.employeeId === employeeId)
      : null;
    const multi = isMultiCarerVisit(ctx.job.requiredCarers, ctx.job.allocations);
    const isCheckedIn = multi
      ? Boolean(myAllocation?.actualStartDateTime) ||
        Boolean(visit.actualStartDateTime) ||
        Boolean(ctx.checkIn)
      : Boolean(visit.actualStartDateTime) ||
        visit.status === ScheduledVisitStatus.STARTED ||
        Boolean(ctx.checkIn);
    const visitClosed =
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF ||
      visit.status === ScheduledVisitStatus.MISSED;
    const block = buildUnableToStartBlock({
      isCheckedIn,
      visitClosed,
      existing: this.resolveUnableToStartSummary(ctx),
    });
    // Support carers never report unable-to-start on double-up.
    if (
      employeeId &&
      !isLeadCarerOnVisit(employeeId, ctx.job.requiredCarers, ctx.job.allocations)
    ) {
      return { ...block, canReport: false, leadOnly: true };
    }
    return block;
  }

  private resolveUnableToStartSummary(
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
  ): UnableToStartSummary | null {
    const ea = ctx.employeeAppMeta;
    const stored =
      typeof ea.unableToStart === 'object' && ea.unableToStart
        ? (ea.unableToStart as Record<string, unknown>)
        : null;
    if (stored?.reasonCode) {
      const code = String(stored.reasonCode);
      return {
        reasonCode: code,
        reasonLabel:
          String(stored.reasonLabel ?? '') ||
          employeeAppUnableToStartReasonLabel(code) ||
          code,
        notes: stored.notes != null ? String(stored.notes) : null,
        recordedAt: String(stored.recordedAt ?? ''),
        attemptedAt: stored.attemptedAt != null ? String(stored.attemptedAt) : null,
        auditRecordId: stored.auditRecordId != null ? String(stored.auditRecordId) : null,
      };
    }

    const jobMeta = this.parseMetadata(ctx.job.metadata);
    if (jobMeta.careNotDelivered === true && typeof jobMeta.careNotDeliveredReasonCode === 'string') {
      const code = jobMeta.careNotDeliveredReasonCode;
      return {
        reasonCode: code,
        reasonLabel:
          (typeof jobMeta.careNotDeliveredReasonLabel === 'string'
            ? jobMeta.careNotDeliveredReasonLabel
            : null) ||
          employeeAppUnableToStartReasonLabel(code) ||
          code,
        notes:
          typeof jobMeta.careNotDeliveredNotes === 'string'
            ? jobMeta.careNotDeliveredNotes
            : null,
        recordedAt:
          ctx.primaryVisit.actualEndDateTime?.toISOString() ?? new Date().toISOString(),
      };
    }
    return null;
  }

  async saveTask(
    employeeId: string,
    jobId: string,
    taskId: string,
    dto: EmployeeAppSaveTaskDto,
  ) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    await this.loadJobForEmployee(employeeId, jobId);
    const outcome = dto.outcome.toUpperCase();
    if (!['COMPLETED', 'PARTIAL', 'DECLINED'].includes(outcome)) {
      validationError('outcome must be COMPLETED, PARTIAL, or DECLINED');
    }
    if ((outcome === 'PARTIAL' || outcome === 'DECLINED') && !dto.notes?.trim() && !dto.outcomeReasonCode) {
      validationError('notes or outcomeReasonCode required for PARTIAL/DECLINED');
    }

    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    const raw = await this.housekeeping.getVisitJobTasks('', jobId);
    const tasks = (raw.data.tasks as Array<Record<string, unknown>>) ?? [];
    const match = tasks.find(
      (t) =>
        String(t.assignmentId ?? '') === taskId ||
        String(t.taskCatalogueTaskId ?? '') === taskId ||
        String(t.assignmentId ?? t.taskCatalogueTaskId ?? '') === taskId,
    );
    if (!match) throw new NotFoundException(`Task ${taskId} not found on this visit`);

    const isFullyCompleted = outcome === 'COMPLETED';
    // Carer addressed the task (progress). PARTIAL / DECLINED count toward tasksDone.
    const isAddressed = outcome === 'COMPLETED' || outcome === 'PARTIAL' || outcome === 'DECLINED';
    const notesParts = [
      outcome !== 'COMPLETED' ? `Outcome: ${outcome}` : null,
      dto.outcomeReasonCode ? `Reason: ${dto.outcomeReasonCode}` : null,
      dto.notes?.trim() || null,
      dto.checklist?.length
        ? `Checklist: ${dto.checklist.map((c) => `${c.label ?? c.itemId}=${c.checked}`).join(', ')}`
        : null,
    ].filter(Boolean);

    const completionInput =
      match.completionInput && typeof match.completionInput === 'object'
        ? (match.completionInput as { inputMode?: string })
        : null;
    const inputMode = completionInput?.inputMode ?? 'tick';
    const needsRecordedValue = inputMode === 'value' || inputMode === 'value_and_note';

    let recordedValue: string | undefined =
      dto.recordedValue?.trim() ||
      (dto.value != null && String(dto.value).trim() !== '' ? String(dto.value).trim() : undefined);

    // Mobile often puts the reading in `notes` (e.g. "5 mmol/L") for value-input tasks.
    if (!recordedValue && isFullyCompleted && needsRecordedValue && dto.notes?.trim()) {
      recordedValue = dto.notes.trim();
    }

    if (outcome === 'PARTIAL') recordedValue = recordedValue || 'PARTIAL';
    if (outcome === 'DECLINED') recordedValue = recordedValue || 'DECLINED';

    if (isFullyCompleted && needsRecordedValue && !recordedValue) {
      validationError('recordedValue (or notes with the reading) is required for this task');
    }

    await this.housekeeping.saveVisitJobTasks(
      '',
      jobId,
      {
        tasks: [
          {
            assignmentId: match.assignmentId ? String(match.assignmentId) : undefined,
            taskCatalogueTaskId: match.taskCatalogueTaskId
              ? String(match.taskCatalogueTaskId)
              : undefined,
            isExtra: Boolean(match.isExtra),
            isCompleted: isAddressed,
            notes: notesParts.join(' · ') || undefined,
            recordedValue,
          },
        ],
      },
      undefined,
      { pruneMissingExtras: false },
    );

    await this.prisma.scheduledVisitTaskCompletion.updateMany({
      where: { scheduledJobId: jobId, isCompleted: true },
      data: { completedById: employeeId },
    });

    // Only fully completed clinical readings sync into Obs (not decline/partial).
    if (isFullyCompleted) {
      const ctx = await this.loadJobForEmployee(employeeId, jobId);
      await this.syncObservationFromCompletedTask({
        employeeId,
        jobId,
        serviceUserId: ctx.job.serviceUserId,
        visitId: ctx.primaryVisit.id,
        taskName: String(match.name ?? ''),
        groupCode: match.groupCode != null ? String(match.groupCode) : null,
        recordedValue: recordedValue ?? null,
        notes: notesParts.join(' · ') || null,
      });
    }

    const now = new Date().toISOString();
    const auditRecordId = newAuditRecordId();
    const progress = await this.resolveProgress(await this.loadJobForEmployee(employeeId, jobId));
    const response = {
      taskId,
      auditRecordId,
      serverConfirmedAt: now,
      taskVersion: dto.taskVersion ?? null,
      syncStatus: 'confirmed',
      progress: this.buildProgress(
        progress,
        await this.resolveMedicationProgress(await this.loadJobForEmployee(employeeId, jobId)),
      ),
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => ({
      ...ea,
      idempotency: {
        ...((ea.idempotency as Record<string, unknown>) ?? {}),
        [dto.idempotencyKey]: response,
      },
    }));

    const taskTitle = String(match.name ?? 'Task').trim() || 'Task';
    const taskSourceId =
      (match.assignmentId != null ? String(match.assignmentId) : null) ||
      (match.taskCatalogueTaskId != null ? String(match.taskCatalogueTaskId) : null) ||
      taskId;
    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      eventType: 'task',
      sourceType: 'task',
      sourceId: taskSourceId,
      title: taskTitle,
      detail: taskOutcomeTimelineDetail(outcome),
      tone: taskOutcomeTimelineTone(outcome),
      occurredAt: parseOccurredAt(dto.deviceRecordedAt, new Date(now)),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    return { data: response };
  }

  async recordMedicationAdministration(
    employeeId: string,
    jobId: string,
    medicationKey: string,
    dto: EmployeeAppMedicationAdminDto,
  ) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    const { medId, doseKey } = parseMedicationAdministrationKey(medicationKey);
    if (!medId) validationError('Invalid medicationKey');

    const med = await this.prisma.serviceUserMedication.findFirst({
      where: {
        id: medId,
        serviceUserId: ctx.job.serviceUserId,
        deletedAt: null,
      },
      include: {
        route: { select: { name: true } },
        schedules: {
          where: { deletedAt: null, isActive: true },
          select: { id: true, dueTime: true },
          take: 5,
        },
      },
    });
    if (!med) throw new NotFoundException('Medication not found for this visit');

    const allergies = await this.loadAllergies(ctx.job.serviceUserId);
    const allergyHit = allergies.some((a) =>
      med.medicationName.toLowerCase().includes(a.toLowerCase()),
    );
    if (allergyHit && !dto.allergyAcknowledged) {
      validationError('allergyAcknowledged is required when allergy warning applies');
    }
    if (!dto.identityConfirmed) {
      validationError('identityConfirmed must be true to record administration');
    }

    const mapped = mapMarOutcomeCode(dto.outcomeCode);
    const isPrn = doseKey === 'prn' || med.medicationKind === MedicationKind.PRN;
    const doseHm = doseKey && doseKey !== 'dose' ? formatHm(doseKey) : null;
    const schedule =
      !isPrn && doseHm
        ? med.schedules.find((s) => formatHm(s.dueTime) === doseHm) ?? med.schedules[0]
        : med.schedules[0];

    const recordedAt = new Date(dto.deviceRecordedAt);
    if (Number.isNaN(recordedAt.getTime())) {
      validationError('deviceRecordedAt must be a valid ISO date-time');
    }
    const witness = resolveMedicationWitnessColumns(
      Boolean(med.isControlledMedication),
      dto,
    );
    const timeGiven =
      dto.timeGiven?.trim() || formatHmUtc(recordedAt);
    const roundRow = ctx.medicationRoundCode
      ? await this.prisma.medicationAdministrationRound.findFirst({
          where: { code: ctx.medicationRoundCode, deletedAt: null, isActive: true },
          select: { id: true },
        })
      : null;

    const created = await this.prisma.medicationAdministrationEvent.create({
      data: {
        serviceUserId: ctx.job.serviceUserId,
        serviceUserMedicationId: med.id,
        medicationScheduleId: schedule?.id,
        roundId: roundRow?.id ?? null,
        administeredById: employeeId,
        scheduledDateTime: ctx.primaryVisit.scheduledStartDateTime,
        actualDateTime: recordedAt,
        status: mapped.status,
        statusCode: mapped.statusCode,
        reason: dto.reasonCode ?? null,
        notes: dto.notes?.trim() || null,
        supportLevel: dto.supportLevel?.trim() || null,
        timeGiven,
        outcomeLabel: dto.outcomeLabel?.trim() || null,
        ...witness,
        visitId: ctx.primaryVisit.id,
        isPrn,
        prnReason: dto.prnIndication ?? null,
        prnOutcome: dto.prnEffectiveness ?? null,
        medicationNameSnapshot: med.medicationName,
        doseSnapshot: med.dose,
        strengthSnapshot: med.strength,
        routeNameSnapshot: med.route?.name ?? null,
      },
    });

    // When the scheduled MAR round is fully recorded, close eMAR-linked visit tasks
    // (e.g. "Medication prompt") so Home + Details task progress stay aligned.
    await this.syncEmarLinkedTasksIfRoundComplete({
      employeeId,
      jobId,
      serviceUserId: ctx.job.serviceUserId,
      medicationRoundCode: ctx.medicationRoundCode,
      visitStart: ctx.primaryVisit.scheduledStartDateTime,
      timeZone: ctx.timeZone,
    });

    const auditRecordId = newAuditRecordId();
    const progress = await this.resolveProgress(ctx);
    const medProgress = await this.resolveMedicationProgress(ctx);
    const response = {
      administrationId: created.id,
      medicationKey,
      outcomeCode: dto.outcomeCode,
      serverConfirmedAt: new Date().toISOString(),
      auditRecordId,
      progress: this.buildProgress(progress, medProgress),
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => ({
      ...ea,
      idempotency: {
        ...((ea.idempotency as Record<string, unknown>) ?? {}),
        [dto.idempotencyKey]: response,
      },
    }));

    const medTitle = [med.medicationName, med.dose].filter(Boolean).join(' · ');
    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      eventType: 'medication',
      sourceType: 'medication',
      sourceId: created.id,
      title: medTitle || 'Medication',
      detail: [
        medicationOutcomeLabel(dto.outcomeLabel, mapped.status),
        medicationWitnessTimelineDetail(buildMedicationWitnessEcho(witness)),
      ]
        .filter(Boolean)
        .join(' · '),
      tone: medicationTimelineTone(mapped.status),
      occurredAt: parseOccurredAt(dto.deviceRecordedAt, recordedAt),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    return { data: response };
  }

  async createObservationContract(
    employeeId: string,
    jobId: string,
    dto: EmployeeAppObservationWriteDto,
  ) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    // Legacy path: admin CreateServiceUserObservationDto shape
    if (dto.observationTypeCode && dto.recordedAt && !dto.typeCode && !dto.definitionId) {
      return this.createObservation(employeeId, jobId, dto as CreateServiceUserObservationDto);
    }

    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    if (dto.idempotencyKey) {
      const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
      if (replay) return { data: replay };
    }

    const rawType = dto.typeCode ?? dto.definitionId ?? dto.observationTypeCode ?? '';
    const typeCode = resolveObservationTypeCode(rawType);
    if (!typeCode) validationError('typeCode (or observationTypeCode) is required');
    if (!dto.outcome) validationError('outcome is required');
    if (dto.outcome === 'recorded' && dto.value == null && dto.numericValue == null) {
      validationError('value is required when outcome is recorded');
    }
    if (dto.outcome === 'unable' && !dto.unableReasonCode) {
      validationError('unableReasonCode is required when outcome is unable');
    }

    const type = await this.prisma.observationType.findFirst({
      where: { code: typeCode, isActive: true },
    });
    if (!type) throw new BadRequestException('Invalid observation type');

    const recordedAt = new Date(dto.deviceRecordedAt ?? dto.recordedAt ?? new Date().toISOString());
    if (Number.isNaN(recordedAt.getTime())) {
      validationError('deviceRecordedAt must be a valid ISO date-time');
    }
    const payloadRecord =
      dto.payload && typeof dto.payload === 'object' && !Array.isArray(dto.payload)
        ? (dto.payload as Record<string, unknown>)
        : {};
    const wellbeingScores = extractWellbeingScoresFromPayload(payloadRecord);
    let numericValue =
      dto.numericValue ??
      parseObservationNumeric(dto.value) ??
      parseObservationNumeric(dto.notes);
    if (type.code === 'NEWS2' && numericValue == null) {
      numericValue = calculateNews2Score(payloadRecord);
    }
    if (dto.outcome === 'recorded' && shouldValidateEmployeeObservationPayload(type.code)) {
      validateObservationCreate(type.code, type.valueKind, {
        payload: payloadRecord,
        wellbeingScores,
        numericValue,
        notes: dto.notes,
      } as CreateServiceUserObservationDto);
    }

    const unableReasonCode = dto.unableReasonCode?.trim() || null;
    const carerNotes = dto.notes?.trim() || null;

    const row = await this.prisma.serviceUserObservation.create({
      data: {
        serviceUserId: ctx.job.serviceUserId,
        observationTypeId: type.id,
        recordedAt,
        notes: carerNotes,
        numericValue,
        unit: dto.unit?.trim() ?? type.unitLabel ?? null,
        payload: {
          ...(dto.payload ?? {}),
          definitionId: dto.definitionId ?? mobileTypeCode(type.code),
          outcome: dto.outcome,
          value: dto.value ?? numericValue ?? null,
          secondaryValue: dto.secondaryValue ?? null,
          unableReasonCode: dto.outcome === 'unable' ? unableReasonCode : null,
          abnormal: dto.abnormal ?? false,
          critical: dto.critical ?? false,
          emergencyProtocolOpened: dto.emergencyProtocolOpened ?? false,
          escalationAction: dto.escalationAction ?? null,
          deviceRecordedAt: recordedAt.toISOString(),
          scheduledJobId: jobId,
          scheduledVisitId: ctx.primaryVisit.id,
          recordedByEmployeeId: employeeId,
        } as Prisma.InputJsonValue,
        recordedByEmployeeId: employeeId,
      },
    });
    await this.persistWellbeingScores(row.id, wellbeingScores);

    if (dto.outcome === 'recorded' || dto.outcome === 'unable') {
      await this.syncVisitTaskFromObservation({
        employeeId,
        jobId,
        serviceUserId: ctx.job.serviceUserId,
        medicationRoundCode: ctx.medicationRoundCode,
        observationTypeCode: type.code,
        valueLabel:
          numericValue != null
            ? String(numericValue)
            : dto.value != null
              ? String(dto.value)
              : null,
        notes: dto.notes ?? null,
      });
    }

    const auditRecordId = newAuditRecordId();
    const response = {
      observationId: row.id,
      definitionId: dto.definitionId ?? type.code.toLowerCase(),
      outcome: dto.outcome,
      serverConfirmedAt: new Date().toISOString(),
      auditRecordId,
      abnormal: dto.abnormal ?? false,
      critical: dto.critical ?? false,
    };

    if (dto.idempotencyKey) {
      await this.mergeEmployeeAppMeta(jobId, (ea) => ({
        ...ea,
        idempotency: {
          ...((ea.idempotency as Record<string, unknown>) ?? {}),
          [dto.idempotencyKey!]: response,
        },
      }));
    }

    const valueSummary =
      numericValue != null
        ? String(numericValue)
        : dto.value != null
          ? String(dto.value)
          : dto.outcome === 'unable'
            ? dto.unableReasonCode ?? 'Unable'
            : dto.outcome ?? null;
    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      eventType: 'observation',
      sourceType: 'observation',
      sourceId: row.id,
      title: type.name,
      detail: valueSummary,
      tone: observationTimelineTone({
        abnormal: dto.abnormal,
        critical: dto.critical,
      }),
      occurredAt: parseOccurredAt(dto.deviceRecordedAt ?? dto.recordedAt, new Date()),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    return { data: response };
  }

  async updateObservationContract(
    employeeId: string,
    jobId: string,
    observationId: string,
    dto: EmployeeAppObservationWriteDto,
  ) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    if (dto.idempotencyKey) {
      const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
      if (replay) return { data: replay };
    }

    const existing = await this.prisma.serviceUserObservation.findFirst({
      where: {
        id: observationId,
        serviceUserId: ctx.job.serviceUserId,
        deletedAt: null,
      },
      include: { observationType: true },
    });
    if (!existing) throw new NotFoundException('Observation not found');

    const prevPayload =
      existing.payload && typeof existing.payload === 'object' && !Array.isArray(existing.payload)
        ? (existing.payload as Record<string, unknown>)
        : {};

    const incomingPayload =
      dto.payload && typeof dto.payload === 'object' && !Array.isArray(dto.payload)
        ? (dto.payload as Record<string, unknown>)
        : {};
    const wellbeingScores = extractWellbeingScoresFromPayload({
      ...prevPayload,
      ...incomingPayload,
    });
    let numericValue =
      dto.numericValue ??
      (typeof dto.value === 'number'
        ? dto.value
        : typeof dto.value === 'string' && !Number.isNaN(Number(dto.value))
          ? Number(dto.value)
          : undefined);
    if (existing.observationType.code === 'NEWS2' && numericValue == null) {
      numericValue = calculateNews2Score({ ...prevPayload, ...incomingPayload }) ?? undefined;
    }
    if (
      (dto.outcome ?? prevPayload.outcome) === 'recorded' &&
      shouldValidateEmployeeObservationPayload(existing.observationType.code)
    ) {
      validateObservationCreate(existing.observationType.code, existing.observationType.valueKind, {
        payload: { ...prevPayload, ...incomingPayload },
        wellbeingScores,
        numericValue: numericValue ?? (existing.numericValue != null ? Number(existing.numericValue) : undefined),
        notes: dto.notes ?? existing.notes ?? undefined,
      } as CreateServiceUserObservationDto);
    }

    const updated = await this.prisma.serviceUserObservation.update({
      where: { id: observationId },
      data: {
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : existing.notes,
        numericValue: numericValue !== undefined ? numericValue : existing.numericValue,
        unit: dto.unit !== undefined ? dto.unit : existing.unit,
        recordedAt: dto.deviceRecordedAt
          ? new Date(dto.deviceRecordedAt)
          : existing.recordedAt,
        payload: {
          ...prevPayload,
          ...(dto.payload ?? {}),
          definitionId: dto.definitionId ?? prevPayload.definitionId ?? null,
          outcome: dto.outcome ?? prevPayload.outcome ?? null,
          value: dto.value ?? prevPayload.value ?? null,
          secondaryValue: dto.secondaryValue ?? prevPayload.secondaryValue ?? null,
          unableReasonCode:
            dto.unableReasonCode !== undefined
              ? dto.unableReasonCode
              : prevPayload.unableReasonCode ?? null,
          abnormal: dto.abnormal ?? prevPayload.abnormal ?? false,
          critical: dto.critical ?? prevPayload.critical ?? false,
          escalationAction:
            dto.escalationAction !== undefined
              ? dto.escalationAction
              : prevPayload.escalationAction ?? null,
          deviceRecordedAt: dto.deviceRecordedAt ?? prevPayload.deviceRecordedAt ?? null,
          correctionReason: dto.correctionReason ?? null,
          correctedByEmployeeId: employeeId,
          correctedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    await this.persistWellbeingScores(updated.id, wellbeingScores);

    const auditRecordId = newAuditRecordId();
    const response = {
      observationId: updated.id,
      definitionId: dto.definitionId ?? String(prevPayload.definitionId ?? existing.observationType.code.toLowerCase()),
      outcome: dto.outcome ?? String(prevPayload.outcome ?? 'recorded'),
      serverConfirmedAt: new Date().toISOString(),
      auditRecordId,
      abnormal: Boolean(dto.abnormal ?? prevPayload.abnormal),
      critical: Boolean(dto.critical ?? prevPayload.critical),
    };

    if (dto.idempotencyKey) {
      await this.mergeEmployeeAppMeta(jobId, (ea) => ({
        ...ea,
        idempotency: {
          ...((ea.idempotency as Record<string, unknown>) ?? {}),
          [dto.idempotencyKey!]: response,
        },
      }));
    }

    const updateValueSummary =
      (numericValue !== undefined ? String(numericValue) : null) ||
      (dto.value != null ? String(dto.value) : null) ||
      (existing.numericValue != null ? String(existing.numericValue) : null) ||
      String(response.outcome);
    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      eventType: 'observation',
      sourceType: 'observation',
      sourceId: updated.id,
      title: existing.observationType.name,
      detail: updateValueSummary,
      tone: observationTimelineTone({
        abnormal: Boolean(dto.abnormal ?? prevPayload.abnormal),
        critical: Boolean(dto.critical ?? prevPayload.critical),
      }),
      occurredAt: parseOccurredAt(dto.deviceRecordedAt, existing.recordedAt),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    return { data: response };
  }

  async addObservationPhoto(
    employeeId: string,
    jobId: string,
    observationId: string,
    file: Express.Multer.File | undefined,
    body: {
      idempotencyKey?: string;
      clientPhotoId?: string;
      consentStatus?: string;
      caption?: string;
      capturedAt?: string;
    },
  ) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    if (!this.isEmployeeCheckedInForVisit(employeeId, ctx)) {
      contractError('NOT_CHECKED_IN', 'Clock in before adding an observation photo');
    }
    if (!file) validationError('file is required');
    const idempotencyKey = body.idempotencyKey?.trim() ?? '';
    if (!idempotencyKey) validationError('idempotencyKey is required');

    const consent = body.consentStatus?.trim().toUpperCase();
    if (
      !consent ||
      !Object.values(BodyMapPhotoConsentStatus).includes(consent as BodyMapPhotoConsentStatus)
    ) {
      validationError('Valid consentStatus is required (GRANTED, DENIED, PENDING)');
    }
    if (consent !== BodyMapPhotoConsentStatus.GRANTED) {
      validationError('Photo consent must be granted before upload');
    }

    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      validationError('Only JPEG, PNG, and WebP images are allowed');
    }

    const replay = await this.findIdempotentReplay(jobId, idempotencyKey);
    if (replay) return { data: replay };

    const observation = await this.prisma.serviceUserObservation.findFirst({
      where: {
        id: observationId,
        serviceUserId: ctx.job.serviceUserId,
        deletedAt: null,
      },
      select: { id: true, payload: true },
    });
    if (!observation) throw new NotFoundException('Observation not found');

    const payload =
      observation.payload && typeof observation.payload === 'object' && !Array.isArray(observation.payload)
        ? (observation.payload as Record<string, unknown>)
        : {};
    const payloadJobId = typeof payload.scheduledJobId === 'string' ? payload.scheduledJobId : null;
    if (payloadJobId && payloadJobId !== jobId) {
      throw new NotFoundException('Observation not found');
    }

    const dir = path.join(process.cwd(), 'uploads', 'employee-app-observations', jobId);
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(file.originalname) || '.jpg';
    const storedName = `${randomUUID()}${ext}`;
    const abs = path.join(dir, storedName);
    await fs.writeFile(abs, file.buffer);
    const fileUrl = `/uploads/employee-app-observations/${jobId}/${storedName}`;
    const now = new Date().toISOString();

    const created = await this.prisma.serviceUserObservationPhoto.create({
      data: {
        observationId,
        fileName: storedName,
        originalName: file.originalname,
        fileUrl,
        fileSize: file.size,
        mimeType: file.mimetype,
        consentStatus: BodyMapPhotoConsentStatus.GRANTED,
        caption: body.caption?.trim() || null,
        uploadedByEmployeeId: employeeId,
      },
    });

    const response = {
      id: created.id,
      photoId: created.id,
      fileUrl: created.fileUrl,
      url: created.fileUrl,
      consentStatus: created.consentStatus,
      caption: created.caption,
      mimeType: created.mimeType,
      sizeBytes: created.fileSize,
      serverConfirmedAt: now,
      capturedAt: body.capturedAt ?? null,
    };

    await this.mergeEmployeeAppMeta(jobId, (current) => ({
      ...current,
      idempotency: {
        ...((current.idempotency as Record<string, unknown>) ?? {}),
        [idempotencyKey]: response,
      },
    }));

    return { data: response };
  }

  async createLogNote(employeeId: string, jobId: string, dto: EmployeeAppLogNoteDto) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    /**
     * Same `clientEntryId` + `idempotencyKey` may be reused to edit a note.
     * Only short-circuit when there is no clientEntryId (pure offline replay of create).
     */
    if (!dto.clientEntryId?.trim()) {
      const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
      if (replay) return { data: replay };
    }

    const entryId = dto.clientEntryId?.trim() || randomUUID();
    const now = new Date().toISOString();
    const occurredAt = parseOccurredAt(dto.deviceRecordedAt, new Date(now));
    const occurredAtIso = occurredAt.toISOString();
    const title = dto.title?.trim() || 'Visit note';
    const detail = summarizeTimelineDetail(dto.body);
    const timelineItem = await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      eventType: 'visit_note',
      sourceType: 'log_note',
      sourceId: VISIT_NOTE_TIMELINE_SOURCE_ID,
      title,
      detail,
      tone: 'ink',
      occurredAt,
      logEntryId: entryId,
      isDraft: Boolean(dto.isDraft),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });
    const response = {
      entryId,
      entryType: 'note',
      isDraft: Boolean(dto.isDraft),
      serverConfirmedAt: now,
      deviceRecordedAt: occurredAtIso,
      ...(timelineItem && !dto.isDraft ? { timelineItem } : {}),
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => {
      const notes = Array.isArray(ea.notes) ? [...(ea.notes as unknown[])] : [];
      const entry = {
        id: entryId,
        entryType: 'note',
        body: dto.body,
        title: dto.title ?? null,
        isDraft: Boolean(dto.isDraft),
        deviceRecordedAt: occurredAtIso,
        recordedByEmployeeId: employeeId,
        recordedAt: occurredAtIso,
      };
      const idx = notes.findIndex((n) => (n as { id?: string }).id === entryId);
      if (idx >= 0) notes[idx] = entry;
      else notes.push(entry);
      return {
        ...ea,
        notes,
        idempotency: {
          ...((ea.idempotency as Record<string, unknown>) ?? {}),
          [dto.idempotencyKey]: response,
        },
      };
    });

    return { data: response };
  }

  async createLogHandover(employeeId: string, jobId: string, dto: EmployeeAppLogHandoverDto) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    /**
     * Handover is a visit singleton. POST is always upsert: reuse of the same
     * `idempotencyKey` / `clientEntryId` applies the latest body, priority,
     * outstandingAction, isDraft, and deviceRecordedAt (does not replay the first save).
     * True network retries with identical content are safe (idempotent overwrite).
     */
    const existingEa = await this.readEmployeeAppMeta(jobId);
    const existingHandover =
      typeof existingEa.handoverNote === 'object' && existingEa.handoverNote
        ? (existingEa.handoverNote as Record<string, unknown>)
        : null;
    const entryId =
      dto.clientEntryId?.trim() ||
      (existingHandover?.id != null ? String(existingHandover.id) : '') ||
      randomUUID();
    const now = new Date().toISOString();
    const occurredAt = parseOccurredAt(dto.deviceRecordedAt, new Date(now));
    const occurredAtIso = occurredAt.toISOString();
    // Rich handover detail for the timeline / admin Log tab: priority + full
    // note + outstanding action (not truncated like a generic timeline summary).
    const handoverParts: string[] = [];
    if (dto.priority === 'high') handoverParts.push('⚠ High priority');
    const handoverBody = dto.body?.trim();
    if (handoverBody) handoverParts.push(handoverBody);
    const outstandingAction = dto.outstandingAction?.trim();
    if (outstandingAction) handoverParts.push(`Outstanding action: ${outstandingAction}`);
    const detail = handoverParts.length
      ? handoverParts.join('\n')
      : summarizeTimelineDetail(dto.body);
    const timelineItem = await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      eventType: 'handover',
      sourceType: 'handover',
      sourceId: HANDOVER_TIMELINE_SOURCE_ID,
      title: 'Handover',
      detail,
      tone: handoverTimelineTone(dto.priority),
      occurredAt,
      logEntryId: entryId,
      isDraft: Boolean(dto.isDraft),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });
    const response = {
      entryId,
      entryType: 'handover',
      isDraft: Boolean(dto.isDraft),
      serverConfirmedAt: now,
      deviceRecordedAt: occurredAtIso,
      ...(timelineItem && !dto.isDraft ? { timelineItem } : {}),
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => ({
      ...ea,
      handoverNote: {
        id: entryId,
        body: dto.body,
        priority: dto.priority ?? 'normal',
        outstandingAction: dto.outstandingAction ?? null,
        isDraft: Boolean(dto.isDraft),
        deviceRecordedAt: occurredAtIso,
        recordedByEmployeeId: employeeId,
        recordedAt: occurredAtIso,
      },
      lastHandover: {
        message: dto.body,
        body: dto.body,
        requiresAck: true,
        badgeLabel: dto.priority === 'high' ? 'High priority' : 'Temporary note',
        acknowledged: false,
        priority: dto.priority ?? 'normal',
        outstandingAction: dto.outstandingAction ?? null,
        deviceRecordedAt: occurredAtIso,
      },
      handoverAcknowledged: false,
      handoverAcknowledgedAt: null,
      idempotency: {
        ...((ea.idempotency as Record<string, unknown>) ?? {}),
        [dto.idempotencyKey]: response,
      },
    }));

    return { data: response };
  }

  async createLogConcern(employeeId: string, jobId: string, dto: EmployeeAppLogConcernDto) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    const entryId = dto.clientEntryId ?? randomUUID();
    const now = new Date().toISOString();
    const officeNotified = !dto.isDraft;
    const response = {
      entryId,
      entryType: 'concern',
      isDraft: Boolean(dto.isDraft),
      serverConfirmedAt: now,
      officeNotified,
      auditRecordId: newAuditRecordId(),
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => {
      const concerns = Array.isArray(ea.concerns) ? [...(ea.concerns as unknown[])] : [];
      concerns.push({
        id: entryId,
        ...dto,
        recordedByEmployeeId: employeeId,
        recordedAt: now,
        officeNotified,
      });
      return {
        ...ea,
        concerns,
        idempotency: {
          ...((ea.idempotency as Record<string, unknown>) ?? {}),
          [dto.idempotencyKey]: response,
        },
      };
    });

    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      eventType: 'concern',
      sourceType: 'concern',
      sourceId: entryId,
      title: (dto.concernType ?? 'Concern').toString().trim() || 'Concern',
      detail: summarizeTimelineDetail(dto.body),
      tone: concernTimelineTone(dto.severity),
      occurredAt: parseOccurredAt(dto.deviceRecordedAt, new Date(now)),
      logEntryId: entryId,
      isDraft: Boolean(dto.isDraft),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    return { data: response };
  }

  async createIncident(employeeId: string, jobId: string, dto: EmployeeAppIncidentDto) {
    await this.assertOperationsUnlocked(employeeId, jobId);
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    const incidentId = dto.clientEntryId ?? randomUUID();
    const now = new Date().toISOString();
    const auditRecordId = newAuditRecordId();
    const officeNotified = !dto.isDraft;
    const response = {
      incidentId,
      entryType: 'incident',
      isDraft: Boolean(dto.isDraft),
      serverConfirmedAt: now,
      auditRecordId,
      officeNotified,
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => {
      const incidents = Array.isArray(ea.incidents) ? [...(ea.incidents as unknown[])] : [];
      incidents.push({
        id: incidentId,
        ...dto,
        attachments: [],
        recordedByEmployeeId: employeeId,
        recordedAt: now,
        auditRecordId,
        officeNotified,
      });
      return {
        ...ea,
        incidents,
        idempotency: {
          ...((ea.idempotency as Record<string, unknown>) ?? {}),
          [dto.idempotencyKey]: response,
        },
      };
    });

    await this.visitTimeline.upsertEvent({
      scheduledJobId: jobId,
      scheduledVisitId: ctx.primaryVisit.id,
      eventType: 'incident',
      sourceType: 'incident',
      sourceId: incidentId,
      title: (dto.incidentType ?? 'Incident').toString().trim() || 'Incident',
      detail: summarizeTimelineDetail(
        [dto.body, dto.severity ? `Severity: ${dto.severity}` : null].filter(Boolean).join(' · '),
      ),
      tone: 'danger',
      occurredAt: parseOccurredAt(dto.deviceRecordedAt, new Date(now)),
      logEntryId: incidentId,
      isDraft: Boolean(dto.isDraft),
      createdByEmployeeId: employeeId,
      writeIdempotencyKey: dto.idempotencyKey,
    });

    return { data: response };
  }

  async addIncidentAttachment(
    employeeId: string,
    jobId: string,
    incidentId: string,
    file: Express.Multer.File | undefined,
    idempotencyKey: string,
    clientAttachmentId?: string,
    capturedAt?: string,
  ) {
    await this.loadJobForEmployee(employeeId, jobId);
    if (!file) validationError('file is required');
    if (!idempotencyKey) validationError('idempotencyKey is required');

    const replay = await this.findIdempotentReplay(jobId, idempotencyKey);
    if (replay) return { data: replay };

    const ea = await this.readEmployeeAppMeta(jobId);
    const incidents = Array.isArray(ea.incidents) ? (ea.incidents as Array<Record<string, unknown>>) : [];
    const incident = incidents.find((i) => String(i.id) === incidentId);
    if (!incident) throw new NotFoundException('Incident not found');

    const attachmentId = clientAttachmentId ?? randomUUID();
    const dir = path.join(process.cwd(), 'uploads', 'employee-app-incidents', jobId);
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `${attachmentId}${ext}`;
    const abs = path.join(dir, filename);
    await fs.writeFile(abs, file.buffer);
    const url = `/uploads/employee-app-incidents/${jobId}/${filename}`;
    const now = new Date().toISOString();
    const response = {
      attachmentId,
      url,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      serverConfirmedAt: now,
      capturedAt: capturedAt ?? null,
    };

    await this.mergeEmployeeAppMeta(jobId, (current) => {
      const list = Array.isArray(current.incidents)
        ? [...(current.incidents as Array<Record<string, unknown>>)]
        : [];
      const idx = list.findIndex((i) => String(i.id) === incidentId);
      if (idx >= 0) {
        const attachments = Array.isArray(list[idx].attachments)
          ? [...(list[idx].attachments as unknown[])]
          : [];
        attachments.push({ ...response, recordedByEmployeeId: employeeId });
        list[idx] = { ...list[idx], attachments };
      }
      return {
        ...current,
        incidents: list,
        idempotency: {
          ...((current.idempotency as Record<string, unknown>) ?? {}),
          [idempotencyKey]: response,
        },
      };
    });

    return { data: response };
  }

  async recordIdentity(employeeId: string, jobId: string, dto: EmployeeAppIdentityDto) {
    await this.loadJobForEmployee(employeeId, jobId);
    if (!['confirmed', 'mismatch'].includes(dto.result)) {
      validationError('result must be confirmed or mismatch');
    }
    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    const now = new Date().toISOString();
    const auditRecordId = newAuditRecordId();
    const identityConfirmed = dto.result === 'confirmed';
    const identityMismatch = dto.result === 'mismatch';
    const response = {
      identityConfirmed,
      identityMismatch,
      recordedAt: now,
      auditRecordId,
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => ({
      ...ea,
      identityConfirmed,
      identityMismatch,
      identity: {
        result: dto.result,
        method: dto.method ?? null,
        notes: dto.notes ?? null,
        deviceRecordedAt: dto.deviceRecordedAt,
        recordedByEmployeeId: employeeId,
        recordedAt: now,
        auditRecordId,
        officeAlerted: identityMismatch,
      },
      idempotency: {
        ...((ea.idempotency as Record<string, unknown>) ?? {}),
        [dto.idempotencyKey]: response,
      },
    }));

    return { data: response };
  }

  async acknowledgeHandover(
    employeeId: string,
    jobId: string,
    dto: EmployeeAppHandoverAcknowledgeDto,
  ) {
    await this.loadJobForEmployee(employeeId, jobId);
    const replay = await this.findIdempotentReplay(jobId, dto.idempotencyKey);
    if (replay) return { data: replay };

    const auditRecordId = newAuditRecordId();
    const response = {
      acknowledged: true,
      acknowledgedAt: dto.acknowledgedAt,
      auditRecordId,
    };

    await this.mergeEmployeeAppMeta(jobId, (ea) => ({
      ...ea,
      handoverAcknowledged: true,
      handoverAcknowledgedAt: dto.acknowledgedAt,
      handoverAcknowledgedByEmployeeId: employeeId,
      lastHandover:
        typeof ea.lastHandover === 'object' && ea.lastHandover
          ? {
              ...(ea.lastHandover as Record<string, unknown>),
              acknowledged: true,
              acknowledgedAt: dto.acknowledgedAt,
            }
          : ea.lastHandover,
      idempotency: {
        ...((ea.idempotency as Record<string, unknown>) ?? {}),
        [dto.idempotencyKey]: response,
      },
    }));

    return { data: response };
  }

  /**
   * Metadata for the mobile “Record visit outcome” screen — mirrors schedule-jobs
   * Complete dialog outcomes carers are allowed to set.
   */
  async getCompletionOptions(employeeId: string, jobId: string) {
    const ctx = await this.loadJobForEmployee(employeeId, jobId);
    const visit = ctx.primaryVisit;
    const job = ctx.job;

    const closed =
      job.status === ScheduledJobStatus.COMPLETED ||
      job.status === ScheduledJobStatus.CANCELLED ||
      job.status === ScheduledJobStatus.CALLED_OFF ||
      visit.status === ScheduledVisitStatus.COMPLETED ||
      visit.status === ScheduledVisitStatus.CANCELLED ||
      visit.status === ScheduledVisitStatus.CALLED_OFF;

    const plannedEnd =
      visit.scheduledEndDateTime ??
      job.scheduledEndDateTime ??
      (job.estimatedDurationMinutes
        ? new Date(
            visit.scheduledStartDateTime.getTime() + job.estimatedDurationMinutes * 60_000,
          )
        : null);

    const defaultStatus = isEmployeeAppCompletionStatus(visit.status)
      ? visit.status
      : ScheduledVisitStatus.COMPLETED;

    const [taskRaw, medProgress, obsCount, bodyMapHandover, prnCount] = await Promise.all([
      this.housekeeping.getVisitJobTasks('', jobId).catch(() => ({
        data: {
          tasks: [] as Array<Record<string, unknown>>,
          medicationRoundCode: null as string | null,
          roundLabel: null as string | null,
        },
      })),
      this.resolveMedicationProgress(ctx),
      this.countVisitObservations(
        job.serviceUserId,
        visit.actualStartDateTime ?? visit.scheduledStartDateTime,
      ),
      this.bodyMap.handoverPreview(job.serviceUserId).catch(() => null),
      this.prisma.serviceUserMedication.count({
        where: {
          serviceUserId: job.serviceUserId,
          deletedAt: null,
          isActive: true,
          status: MedicationRecordStatus.ACTIVE,
          medicationKind: MedicationKind.PRN,
        },
      }),
    ]);

    const taskRows = (taskRaw.data.tasks as Array<Record<string, unknown>>) ?? [];
    const tasks = taskRows.map((task) => {
      const isCompleted = isVisitTaskAddressed({
        isCompleted: Boolean(task.isCompleted),
        recordedValue: task.recordedValue != null ? String(task.recordedValue) : null,
        notes: task.notes != null ? String(task.notes) : null,
      });
      return {
        assignmentId: (task.assignmentId as string | null) ?? null,
        taskCatalogueTaskId: String(task.taskCatalogueTaskId ?? ''),
        name: String(task.name ?? ''),
        isExtra: Boolean(task.isExtra),
        isCompleted,
      };
    });
    const tasksDone = tasks.filter((t) => t.isCompleted).length;
    const remainingTasks = Math.max(0, tasks.length - tasksDone);
    const allTasksComplete = tasks.length === 0 || remainingTasks === 0;
    const incompleteRequired = tasks
      .filter((t) => !t.isCompleted)
      .map((t) => ({
        assignmentId: t.assignmentId,
        taskCatalogueTaskId: t.taskCatalogueTaskId,
        name: t.name,
      }));

    const medsDue = medProgress.dueCount;
    const medsGiven = medProgress.givenCount;
    const medsRemaining = Math.max(0, medsDue - medsGiven);
    const hasScheduledMeds = medsDue > 0;
    const hasPrnMeds = prnCount > 0;
    // hasAny reflects actual due/PRN meds — not the overloaded visit-plan round label.
    const hasMedications = hasScheduledMeds || hasPrnMeds;
    const hasTasks = tasks.length > 0;
    const hasObservations = obsCount > 0;
    const bodyMapActive = bodyMapHandover?.activeCount ?? 0;
    const bodyMapHighRisk = bodyMapHandover?.highRiskCount ?? 0;
    const hasBodyMap = bodyMapActive > 0;

    const checklist = {
      tasks: {
        hasAny: hasTasks,
        total: tasks.length,
        done: tasksDone,
        remaining: Math.max(0, tasks.length - tasksDone),
        requiredTotal: tasks.length,
        requiredDone: tasksDone,
        requiredRemaining: remainingTasks,
        optionalTotal: 0,
        incompleteRequired,
        allRequiredComplete: allTasksComplete,
      },
      medications: {
        hasAny: hasMedications,
        medicationRequiredOnVisit: Boolean(visit.medicationRequired),
        roundCode: ctx.medicationRoundCode ?? taskRaw.data.medicationRoundCode ?? null,
        roundLabel: taskRaw.data.roundLabel ?? null,
        scheduledDue: medsDue,
        scheduledGiven: medsGiven,
        scheduledRemaining: medsRemaining,
        prnAvailable: prnCount,
        allScheduledGiven: medsDue === 0 || medsGiven >= medsDue,
      },
      observations: {
        hasAny: hasObservations,
        recordedCount: obsCount,
      },
      bodyMap: {
        hasAny: hasBodyMap,
        activeCount: bodyMapActive,
        highRiskCount: bodyMapHighRisk,
      },
      summary: {
        hasTasks,
        hasMedications,
        hasObservations,
        hasBodyMap,
        pendingRequiredTasks: remainingTasks,
        pendingScheduledMeds: medsRemaining,
        readyForComplete: allTasksComplete && (medsDue === 0 || medsGiven >= medsDue),
      },
      tabs: [
        {
          id: 'tasks',
          label: 'Tasks',
          hasContent: hasTasks,
          incomplete: remainingTasks > 0,
          countLabel: hasTasks ? `${tasksDone}/${tasks.length}` : null,
        },
        {
          id: 'mar',
          label: 'MAR',
          hasContent: hasMedications,
          incomplete: medsRemaining > 0,
          countLabel: hasScheduledMeds
            ? `${medsGiven}/${medsDue}`
            : hasPrnMeds
              ? `${prnCount} PRN`
              : null,
        },
        {
          id: 'obs',
          label: 'Obs',
          hasContent: hasObservations,
          incomplete: false,
          countLabel: hasObservations ? String(obsCount) : null,
        },
        {
          id: 'body-map',
          label: 'Body map',
          hasContent: hasBodyMap,
          incomplete: bodyMapHighRisk > 0,
          countLabel: hasBodyMap ? String(bodyMapActive) : null,
        },
      ],
    };

    return {
      data: {
        jobId: job.id,
        visitId: visit.id,
        canComplete: !closed,
        closedReason: closed ? `Visit is already ${visit.status}` : null,
        currentStatus: visit.status,
        jobStatus: job.status,
        defaultStatus,
        outcomes: EMPLOYEE_APP_COMPLETION_OUTCOMES,
        timingExceptionReasons: employeeAppTimingExceptionReasons(),
        planned: {
          startIso: visit.scheduledStartDateTime.toISOString(),
          endIso: plannedEnd?.toISOString() ?? null,
          startLabel: formatHmUtc(visit.scheduledStartDateTime),
          endLabel: plannedEnd ? formatHmUtc(plannedEnd) : null,
        },
        actual: {
          startIso: visit.actualStartDateTime?.toISOString() ?? null,
          endIso: visit.actualEndDateTime?.toISOString() ?? null,
          startLabel: visit.actualStartDateTime
            ? formatHmUtc(visit.actualStartDateTime)
            : null,
          endLabel: visit.actualEndDateTime
            ? formatHmUtc(visit.actualEndDateTime)
            : null,
        },
        checklist,
        hints: {
          useCheckInFirst: !visit.actualStartDateTime && visit.status === ScheduledVisitStatus.PLANNED,
          requiresActualTimesFor: ['COMPLETED', 'PARTIALLY_COMPLETED'],
          cancelCallOffViaOffice: true,
          completeIncompleteTasksVia: hasTasks
            ? 'PATCH /employee-app/visits/{jobId}/tasks'
            : null,
          completeMedicationsVia: hasMedications
            ? 'GET /employee-app/visits/{jobId}/medication'
            : null,
        },
      },
    };
  }

  private async loadJobForEmployee(employeeId: string, jobId: string): Promise<{
    job: VisitJobRow;
    primaryVisit: VisitJobRow['visits'][number];
    medicationRoundCode: string | null;
    employeeAppMeta: Record<string, unknown>;
    checkIn: Record<string, unknown> | null;
    identityConfirmed: boolean;
    allocationId: string | null;
    timeZone: string;
  }> {
    const [job, timeZone] = await Promise.all([
      this.prisma.scheduledJob.findFirst({
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
            nhsNumber: true,
            address: {
              select: {
                addressLine1: true,
                addressLine2: true,
                town: true,
                county: true,
                postcode: true,
                latitude: true,
                longitude: true,
                accessInstructions: true,
                keySafeNumber: true,
                accessMethod: true,
                keySafeLocation: true,
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
            visitPlanSlot: { select: { slotCode: true, medicationRoundCode: true, nightDuty: true } },
          },
        },
        allocations: {
          where: { deletedAt: null, isActive: true },
          select: {
            id: true,
            status: true,
            employeeId: true,
            isLeadCarer: true,
            actualStartDateTime: true,
            actualEndDateTime: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            durationMinutes: true,
            employee: {
              select: {
                id: true,
                personalDetail: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    }),
      this.orgSettings.getOperationalTimezone(),
    ]);

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
      timeZone,
    };
  }

  private async buildShell(
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    progress: Awaited<ReturnType<typeof this.resolveProgress>>,
    medProgress?: { dueCount: number; givenCount: number },
    employeeId?: string,
    geofenceSettings?: { allowedRadiusMeters: number },
  ) {
    const su = ctx.job.serviceUser;
    const visit = ctx.primaryVisit;
    const fullName = displayName(su.firstName, su.lastName);
    const myAllocation = employeeId
      ? ctx.job.allocations.find((a) => a.employeeId === employeeId)
      : null;
    const multiCarerVisit = isMultiCarerVisit(ctx.job.requiredCarers, ctx.job.allocations);
    const resolved = resolveAllocationWindow(
      myAllocation
        ? {
            scheduledStartDateTime: myAllocation.scheduledStartDateTime ?? null,
            scheduledEndDateTime: myAllocation.scheduledEndDateTime ?? null,
            durationMinutes: myAllocation.durationMinutes ?? null,
          }
        : null,
      {
        scheduledStartDateTime: visit.scheduledStartDateTime,
        scheduledEndDateTime: visit.scheduledEndDateTime,
        estimatedDurationMinutes: ctx.job.estimatedDurationMinutes,
      },
    );
    const scheduledStart = formatHmUtc(resolved.start);
    const scheduledEnd = formatHmUtc(resolved.end);
    const checkedInAt =
      (multiCarerVisit
        ? myAllocation?.actualStartDateTime
        : null) ??
      visit.actualStartDateTime ??
      (ctx.checkIn?.checkedInAt ? new Date(String(ctx.checkIn.checkedInAt)) : null);
    const isCheckedIn = multiCarerVisit
      ? Boolean(myAllocation?.actualStartDateTime) ||
        Boolean(
          employeeId &&
            typeof ctx.employeeAppMeta.checkIns === 'object' &&
            ctx.employeeAppMeta.checkIns &&
            (ctx.employeeAppMeta.checkIns as Record<string, unknown>)[employeeId],
        )
      : visit.status === ScheduledVisitStatus.STARTED ||
        Boolean(visit.actualStartDateTime);

    const address =
      su.address && !su.address.deletedAt
        ? {
            line1: su.address.addressLine1 ?? null,
            line2: su.address.addressLine2 ?? null,
            town: su.address.town ?? null,
            county: su.address.county ?? null,
            postcode: su.address.postcode ?? null,
            latitude: formatCoord4(
              su.address.latitude != null ? Number(su.address.latitude) : null,
            ),
            longitude: formatCoord4(
              su.address.longitude != null ? Number(su.address.longitude) : null,
            ),
          }
        : null;
    const serviceUserLatitude =
      su.address && !su.address.deletedAt && su.address.latitude != null
        ? roundCoord4(Number(su.address.latitude))
        : null;
    const serviceUserLongitude =
      su.address && !su.address.deletedAt && su.address.longitude != null
        ? roundCoord4(Number(su.address.longitude))
        : null;
    const jobLatitude =
      ctx.job.latitude != null ? roundCoord4(Number(ctx.job.latitude)) : null;
    const jobLongitude =
      ctx.job.longitude != null ? roundCoord4(Number(ctx.job.longitude)) : null;
    /** Prefer job pin when set; otherwise service-user address (same rule as geofence). */
    const destinationLatitude = jobLatitude ?? serviceUserLatitude;
    const destinationLongitude = jobLongitude ?? serviceUserLongitude;
    const allowedRadiusMeters =
      geofenceSettings?.allowedRadiusMeters ?? EMPLOYEE_APP_ALLOWED_RADIUS_METERS;
    const nightDuty = resolveStoredNightDuty({
      slotNightDuty: visit.visitPlanSlot?.nightDuty,
      jobMetadata: ctx.job.metadata,
    });
    const visitRefById = await loadVisitRefsByScheduledVisitIds(this.prisma, [visit.id]);
    const visitRef =
      visitRefById.get(visit.id) ??
      (await this.visitReconciliations.issueVisitRef(visit.id));

    return {
      jobId: ctx.job.id,
      visitId: visit.id,
      visitRef: visitRef ?? null,
      clientId: su.id,
      organisationTimezone: ctx.timeZone,
      client: {
        name: fullName,
        initials: initialsFromName(su.firstName, su.lastName),
        dateOfBirth: su.dateOfBirth ? formatDob(su.dateOfBirth) : null,
        dateOfBirthIso: su.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        nhsNumber: su.nhsNumber ?? null,
        latitude: formatCoord4(serviceUserLatitude),
        longitude: formatCoord4(serviceUserLongitude),
        address,
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
      nightDuty,
      nightDutyLabel: nightDutyAppLabel(nightDuty),
      isOvernight:
        jobMetadataIsOvernight(ctx.job.metadata) ||
        (visit.scheduledEndDateTime != null &&
          visit.scheduledStartDateTime.toISOString().slice(0, 10) !==
            visit.scheduledEndDateTime.toISOString().slice(0, 10)),
      status: mapUiStatus(ctx.job.status, visit.status),
      identityConfirmed: ctx.identityConfirmed,
      identityBadge: ctx.identityConfirmed ? { label: 'ID', tone: 'success' as Tone } : null,
      isCheckedIn,
      checkedInAt: checkedInAt?.toISOString() ?? null,
      checkedInLabel: checkedInAt ? `In ${formatHmUtc(checkedInAt)}` : null,
      progress: this.buildProgress(progress, medProgress),
      location: buildShellLocation({
        latitude: destinationLatitude,
        longitude: destinationLongitude,
        allowedRadiusMeters,
      }),
      ...this.buildCoCarerShellFields(
        ctx.job.allocations,
        ctx.job.requiredCarers,
        employeeId,
        ctx.employeeAppMeta,
        visit.status,
      ),
      requiredCarers: ctx.job.requiredCarers,
      myRole: employeeId
        ? resolveCarerRole(employeeId, ctx.job.requiredCarers, ctx.job.allocations)
        : null,
    };
  }

  private buildCoCarerShellFields(
    allocations: VisitJobRow['allocations'],
    requiredCarers: number,
    employeeId?: string,
    employeeAppMeta?: Record<string, unknown>,
    visitStatus?: string,
  ) {
    const activeCoCarers = allocations.filter((a) => ACTIVE_ALLOCATION.includes(a.status));
    const multiCarer = activeCoCarers.length >= 2 || requiredCarers >= 2;
    const leadId = resolveLeadEmployeeId(requiredCarers, allocations);
    const presenceMap = readCoCarerPresenceMap(employeeAppMeta);

    const coCarers = activeCoCarers.map((a) => {
      const name = displayName(
        a.employee.personalDetail?.firstName,
        a.employee.personalDetail?.lastName,
      );
      const checkedInAt = allocationIso(a.actualStartDateTime);
      const checkedOutAt = allocationIso(a.actualEndDateTime);
      const presence: CoCarerPresenceRecord | undefined = presenceMap[a.employeeId];
      const base = {
        employeeId: a.employeeId,
        name,
        isYou: employeeId ? a.employeeId === employeeId : false,
      };
      if (!multiCarer) return base;

      const isLead = leadId != null && a.employeeId === leadId;
      return {
        ...base,
        isLeadCarer: isLead,
        role: isLead ? ('lead' as const) : ('support' as const),
        isCheckedIn: Boolean(checkedInAt),
        checkedInAt,
        checkedOutAt,
        // Partner presence (mark arrived/left) — independent of ECM clock-in.
        present: presence ? presence.present : null,
        arrivedAt: presence?.arrivedAt ?? null,
        leftAt: presence?.leftAt ?? null,
      };
    });
    const leadAllocation =
      multiCarer && leadId
        ? activeCoCarers.find((a) => a.employeeId === leadId) ?? activeCoCarers[0] ?? null
        : null;
    const leadCarer = leadAllocation
      ? {
          employeeId: leadAllocation.employeeId,
          name: displayName(
            leadAllocation.employee.personalDetail?.firstName,
            leadAllocation.employee.personalDetail?.lastName,
          ),
          isYou: employeeId ? leadAllocation.employeeId === employeeId : false,
        }
      : null;

    const supportClockedOutBeforeLeadComplete =
      visitStatus != null
        ? buildSupportClockedOutBeforeLeadComplete({
            requiredCarers,
            allocations,
            visitStatus,
            viewingEmployeeId: employeeId,
          })
        : null;

    return {
      coCarers,
      leadCarer,
      ...(supportClockedOutBeforeLeadComplete
        ? { supportClockedOutBeforeLeadComplete }
        : {}),
    };
  }

  private async loadGeofenceSettings() {
    return { allowedRadiusMeters: EMPLOYEE_APP_ALLOWED_RADIUS_METERS };
  }

  private async loadCheckInMethodFlags() {
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      select: {
        domCheckInGpsEnabled: true,
        domCheckInManualEnabled: true,
        domCheckInNfcEnabled: true,
        domCheckInQrEnabled: true,
      },
    });
    return {
      domCheckInGpsEnabled: settings?.domCheckInGpsEnabled,
      domCheckInManualEnabled: settings?.domCheckInManualEnabled,
      domCheckInNfcEnabled: settings?.domCheckInNfcEnabled,
      domCheckInQrEnabled: settings?.domCheckInQrEnabled,
    };
  }

  private async assertCheckInMethodEnabled(
    method?: string,
    jobId?: string,
    employeeId?: string,
  ) {
    const enabled = resolveEnabledCheckInMethods(await this.loadCheckInMethodFlags());
    if (isCheckInMethodEnabled(method, enabled)) return;
    if (normalizeCheckInMethod(method) === 'MANUAL' && jobId && employeeId) {
      const grant = await this.checkInMethodGrants.findActiveAuthorised(jobId, employeeId);
      if (grant) return;
    }
    validationError(
      'This check-in method is not enabled for your organisation.',
    );
  }

  private assertManualCheckInReason(dto: EmployeeAppVisitCheckInDto) {
    if (normalizeCheckInMethod(dto.method) !== 'MANUAL') return;
    const code = dto.manualOverrideReasonCode?.trim();
    if (!code) {
      validationError('A reason is required for manual check-in.');
    }
    if (code.toUpperCase() === 'OTHER' && !dto.manualOverrideNotes?.trim()) {
      validationError('Notes are required when the manual reason is Other.');
    }
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
    const roundCode = resolveJobMedicationRoundCode(ctx.job.visits);
    const since =
      ctx.primaryVisit.actualStartDateTime ?? ctx.primaryVisit.scheduledStartDateTime;

    const [assignments, completions, obsCount] = await Promise.all([
      roundCode
        ? this.prisma.serviceUserVisitTaskAssignment.findMany({
            where: {
              serviceUserId: ctx.job.serviceUserId,
              medicationRoundCode: roundCode,
              deletedAt: null,
              isActive: true,
            },
            select: {
              id: true,
              daysOfWeek: true,
              scheduleFrequency: true,
              repeatEvery: true,
              repeatUnit: true,
              timeCritical: true,
              timeToleranceMinutes: true,
              monthlyDayMode: true,
              monthlyDaysOfMonth: true,
              monthlyPatternOrdinal: true,
              monthlyPatternWeekday: true,
            },
          })
        : Promise.resolve(
            [] as Array<{
              id: string
              daysOfWeek: number[]
              scheduleFrequency: import('@prisma/client').VisitPlanScheduleFrequency
              repeatEvery: number
              repeatUnit: import('@prisma/client').VisitPlanRepeatUnit
              timeCritical: boolean
              timeToleranceMinutes: number
              monthlyDayMode: import('@prisma/client').VisitPlanMonthlyDayMode
              monthlyDaysOfMonth: number[]
              monthlyPatternOrdinal: import('@prisma/client').VisitPlanMonthlyOrdinal | null
              monthlyPatternWeekday: number | null
            }>,
          ),
      this.prisma.scheduledVisitTaskCompletion.findMany({
        where: { scheduledJobId: ctx.job.id },
        select: {
          assignmentId: true,
          isCompleted: true,
          recordedValue: true,
          notes: true,
        },
      }),
      this.countVisitObservations(ctx.job.serviceUserId, since),
    ]);

    const visitDay = new Date(
      Date.UTC(
        ctx.primaryVisit.scheduledStartDateTime.getUTCFullYear(),
        ctx.primaryVisit.scheduledStartDateTime.getUTCMonth(),
        ctx.primaryVisit.scheduledStartDateTime.getUTCDate(),
      ),
    );
    const plannedAssignmentIds = assignments
      .filter((a) => {
        if (completions.some((c) => c.assignmentId === a.id)) return true;
        return visitTaskMatchesDay(pickScheduleFromAssignment(a), visitDay, visitDay);
      })
      .map((a) => a.id);

    // Same formula as Home (`buildVisitTaskProgressByJobId`) — completion rows only.
    const progress = computeVisitTaskProgress({
      plannedAssignmentIds,
      completions,
    });

    return {
      tasksDone: progress.completed,
      tasksTotal: progress.total,
      obsCount,
    };
  }

  /**
   * When an Obs-linked visit task is completed with a reading, mirror it into observations
   * so Tasks + Obs tabs stay consistent.
   */
  private async syncObservationFromCompletedTask(input: {
    employeeId: string;
    jobId: string;
    serviceUserId: string;
    visitId: string;
    taskName: string;
    groupCode?: string | null;
    flagsJson?: unknown;
    recordedValue?: string | null;
    notes?: string | null;
  }) {
    await syncObservationFromCompletedVisitTask(this.prisma, {
      serviceUserId: input.serviceUserId,
      jobId: input.jobId,
      visitId: input.visitId,
      taskName: input.taskName,
      groupCode: input.groupCode,
      flagsJson: input.flagsJson,
      recordedValue: input.recordedValue,
      notes: input.notes,
      recordedByEmployeeId: input.employeeId,
    });
  }

  /**
   * When every scheduled (non-PRN) dose for the visit round has been recorded,
   * mark eMAR-linked planned tasks (e.g. "Medication prompt") complete so Home
   * and Details share the same tasksDone count.
   */
  private async syncEmarLinkedTasksIfRoundComplete(input: {
    employeeId: string;
    jobId: string;
    serviceUserId: string;
    medicationRoundCode: string | null;
    visitStart: Date;
    timeZone: string;
  }) {
    if (!input.medicationRoundCode) return;

    const visitDate = dayKeyInTimeZone(input.visitStart, input.timeZone);
    const { start, end } = operationalDayBounds(visitDate, input.timeZone);
    const round = await this.prisma.medicationAdministrationRound.findFirst({
      where: { code: input.medicationRoundCode, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!round) return;

    const meds = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId: input.serviceUserId,
        deletedAt: null,
        isActive: true,
        status: MedicationRecordStatus.ACTIVE,
        medicationKind: { not: MedicationKind.PRN },
        schedules: {
          some: {
            deletedAt: null,
            isActive: true,
            round: { code: input.medicationRoundCode },
          },
        },
      },
      select: { id: true },
    });
    const dueCount = meds.length;
    if (dueCount === 0) return;

    const givenCount = await this.prisma.medicationAdministrationEvent.count({
      where: {
        serviceUserId: input.serviceUserId,
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
    if (givenCount < dueCount) return;

    const assignments = await this.prisma.serviceUserVisitTaskAssignment.findMany({
      where: {
        serviceUserId: input.serviceUserId,
        medicationRoundCode: input.medicationRoundCode,
        deletedAt: null,
        isActive: true,
      },
      include: {
        task: {
          select: {
            id: true,
            name: true,
            category: { select: { group: { select: { code: true } } } },
          },
        },
      },
    });

    const emarAssignments = assignments.filter((a) => {
      const link = resolveTaskModuleLink(
        a.task.name,
        a.task.category.group.code,
        true,
      );
      return link?.id === 'emar';
    });
    if (emarAssignments.length === 0) return;

    const now = new Date();
    for (const match of emarAssignments) {
      const existing = await this.prisma.scheduledVisitTaskCompletion.findFirst({
        where: { scheduledJobId: input.jobId, assignmentId: match.id },
      });
      if (existing?.isCompleted) continue;

      const keptNotes = stripVisitTaskOutcomeNotes(existing?.notes) ?? null;
      if (existing) {
        await this.prisma.scheduledVisitTaskCompletion.update({
          where: { id: existing.id },
          data: {
            isCompleted: true,
            recordedValue: existing.recordedValue ?? 'COMPLETED',
            notes: keptNotes,
            completedAt: now,
            completedById: input.employeeId,
          },
        });
        continue;
      }

      await this.prisma.scheduledVisitTaskCompletion.create({
        data: {
          scheduledJobId: input.jobId,
          assignmentId: match.id,
          taskCatalogueTaskId: match.task.id,
          medicationRoundCode: input.medicationRoundCode,
          isAdHoc: false,
          isCompleted: true,
          recordedValue: 'COMPLETED',
          notes: null,
          completedAt: now,
          completedById: input.employeeId,
        },
      });
    }
  }

  /** When an observation is recorded, complete the matching planned visit task if any. */
  private async syncVisitTaskFromObservation(input: {
    employeeId: string;
    jobId: string;
    serviceUserId: string;
    medicationRoundCode: string | null;
    observationTypeCode: string;
    valueLabel?: string | null;
    notes?: string | null;
  }) {
    if (!input.medicationRoundCode) return;
    const assignments = await this.prisma.serviceUserVisitTaskAssignment.findMany({
      where: {
        serviceUserId: input.serviceUserId,
        medicationRoundCode: input.medicationRoundCode,
        deletedAt: null,
        isActive: true,
      },
      include: {
        task: {
          select: {
            id: true,
            name: true,
            flagsJson: true,
            category: { select: { group: { select: { code: true } } } },
          },
        },
      },
    });

    const match = assignments.find((a) => {
      const link = resolveTaskObsLink({
        name: a.task.name,
        groupCode: a.task.category.group.code,
        flagsJson: a.task.flagsJson,
      });
      return link?.observationTypeCode === input.observationTypeCode.toUpperCase();
    });
    if (!match) return;

    const existing = await this.prisma.scheduledVisitTaskCompletion.findFirst({
      where: { scheduledJobId: input.jobId, assignmentId: match.id },
    });
    if (existing?.isCompleted) return;

    const now = new Date();
    if (existing) {
      await this.prisma.scheduledVisitTaskCompletion.update({
        where: { id: existing.id },
        data: {
          isCompleted: true,
          recordedValue: input.valueLabel?.trim() || existing.recordedValue,
          notes: input.notes?.trim() || existing.notes,
          completedAt: now,
          completedById: input.employeeId,
        },
      });
      return;
    }

    await this.prisma.scheduledVisitTaskCompletion.create({
      data: {
        scheduledJobId: input.jobId,
        assignmentId: match.id,
        taskCatalogueTaskId: match.task.id,
        medicationRoundCode: input.medicationRoundCode,
        isAdHoc: false,
        isCompleted: true,
        recordedValue: input.valueLabel?.trim() || null,
        notes: input.notes?.trim() || null,
        completedAt: now,
        completedById: input.employeeId,
      },
    });
  }

  private async resolveMedicationProgress(ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>) {
    const visitDate = dayKeyInTimeZone(
      ctx.primaryVisit.scheduledStartDateTime,
      ctx.timeZone,
    );
    const { start, end } = operationalDayBounds(visitDate, ctx.timeZone);
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
    const [allergies, openRisks, flash, carePlans, ia, progress, medProgress, bodyMapHandover, medSupport, sosAlerts] =
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
                InitialAssessmentRiskType.LONE_WORKER,
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
        this.prisma.medicationSupportProfile.findFirst({
          where: { serviceUserId: suId, deletedAt: null, isActive: true },
          select: { storageLocation: true },
        }),
        this.sos.listForJob(ctx.job.id),
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
          subtitle: description,
          iconType: iconForCarePlan(plan.carePathwayForm.name),
          iconKey: iconForCarePlan(plan.carePathwayForm.name),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .slice(0, 4);

    const keySafe = employeeAppKeySafePayload(ctx.job.serviceUser.address);

    const medicationLocation =
      medSupport?.storageLocation != null && medSupport.storageLocation.trim()
        ? medSupport.storageLocation.trim()
        : null;

    const lastHandoverMeta =
      typeof ctx.employeeAppMeta.lastHandover === 'object' && ctx.employeeAppMeta.lastHandover
        ? (ctx.employeeAppMeta.lastHandover as Record<string, unknown>)
        : null;

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
        items: extraFlags.map((t) => t.label),
        chipItems: riskTags,
      },
      keySafe,
      medicationLocation,
      lastHandover: lastHandoverMeta
        ? {
            message: String(lastHandoverMeta.message ?? lastHandoverMeta.body ?? ''),
            requiresAck: lastHandoverMeta.requiresAck !== false,
            badgeLabel: String(lastHandoverMeta.badgeLabel ?? 'Temporary note'),
            acknowledged: Boolean(lastHandoverMeta.acknowledged),
          }
        : flash
          ? {
              message: flash.message,
              requiresAck: true,
              badgeLabel: 'Temporary note',
              acknowledged: false,
            }
          : null,
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
        risks: [],
        loneWorkerNote: 'Lone-worker & SOS',
      },
      communication: {
        title: 'Communication & sensory',
        items: communicationNotes,
      },
      carePlanEssentials,
      sosAlerts,
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
    const visitDate = dayKeyInTimeZone(
      ctx.primaryVisit.scheduledStartDateTime,
      ctx.timeZone,
    );
    const { start, end } = operationalDayBounds(visitDate, ctx.timeZone);
    const roundCode = ctx.medicationRoundCode;
    const allergies = await this.loadAllergies(ctx.job.serviceUserId);
    const allergyLower = allergies.map((a) => a.toLowerCase());

    const round = roundCode
      ? await this.prisma.medicationAdministrationRound.findFirst({
          where: { code: roundCode, deletedAt: null, isActive: true },
          select: { id: true, name: true, code: true, time: true },
        })
      : null;
    const visitRound = resolveVisitMedicationRoundFromDb(round);

    const [scheduledMeds, prnMeds, activePacks] = await Promise.all([
      this.prisma.serviceUserMedication.findMany({
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
          reasonForMedication: true,
          howAssisted: true,
          isControlledMedication: true,
          medicationPackId: true,
          route: { select: { name: true } },
          schedules: {
            where: { deletedAt: null, isActive: true, ...(round ? { roundId: round.id } : {}) },
            select: { dueTime: true, round: { select: { name: true } } },
            take: 1,
          },
          medicationPack: { select: { adminRules: true } },
        },
      }),
      this.prisma.serviceUserMedication.findMany({
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
          reasonForMedication: true,
          howAssisted: true,
          isControlledMedication: true,
          route: { select: { name: true } },
        },
      }),
      this.prisma.medicationPack.findMany({
        where: {
          serviceUserId: ctx.job.serviceUserId,
          deletedAt: null,
          status: MedicationPackStatus.ACTIVE,
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          packType: true,
          status: true,
          roundLabel: true,
          compartments: {
            where: { deletedAt: null, isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { dueTime: 'asc' }],
            select: {
              id: true,
              label: true,
              dueTime: true,
              windowStart: true,
              windowEnd: true,
              witnessRequired: true,
            },
          },
          members: {
            where: { deletedAt: null, status: 'ACTIVE' },
            select: {
              id: true,
              serviceUserMedicationId: true,
              serviceUserMedication: {
                select: {
                  id: true,
                  medicationName: true,
                  dose: true,
                  strength: true,
                  instructions: true,
                  reasonForMedication: true,
                  howAssisted: true,
                  isControlledMedication: true,
                  route: { select: { name: true } },
                  medicationPack: { select: { adminRules: true } },
                  startDate: true,
                  endDate: true,
                  schedules: {
                    where: { deletedAt: null, isActive: true },
                    select: { id: true, dueTime: true, round: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const packMedicationIds = collectActivePackMedicationIds(activePacks);
    const standaloneScheduledMeds = scheduledMeds.filter((m) => !packMedicationIds.has(m.id));

    const medIds = [
      ...new Set([
        ...standaloneScheduledMeds.map((m) => m.id),
        ...prnMeds.map((m) => m.id),
        ...packMedicationIds,
      ]),
    ];
    const [events, bodyMapSites] =
      medIds.length > 0
        ? await Promise.all([
            this.prisma.medicationAdministrationEvent.findMany({
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
                statusCode: true,
                reason: true,
                notes: true,
                supportLevel: true,
                timeGiven: true,
                outcomeLabel: true,
                witnessPresent: true,
                witnessName: true,
                witnessRelationCode: true,
                witnessRelationDetail: true,
                witnessNotes: true,
                actualDateTime: true,
                prnReason: true,
                prnOutcome: true,
                isPrn: true,
                visitId: true,
              },
            }),
            this.prisma.bodyMapMedicationSite.findMany({
              where: {
                serviceUserMedicationId: { in: medIds },
                bodyMapRecord: {
                  serviceUserId: ctx.job.serviceUserId,
                  isArchived: false,
                  status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] },
                },
              },
              orderBy: { updatedAt: 'desc' },
              select: {
                serviceUserMedicationId: true,
                bodyMapRecord: {
                    select: {
                    id: true,
                    subType: true,
                    observationDetails: true,
                    markers: {
                      where: { isVisible: true },
                      orderBy: { markerNumber: 'asc' },
                      take: 1,
                      select: {
                        bodyView: true,
                        bodyPart: true,
                        side: true,
                        specificLocation: true,
                        xCoordinate: true,
                        yCoordinate: true,
                      },
                    },
                  },
                },
              },
            }),
          ])
        : [[], []];

    const bodyMapSiteByMedId = indexMarBodyMapSites(bodyMapSites);

    const eventByMed = new Map<string, (typeof events)[number]>();
    for (const e of events) {
      if (!eventByMed.has(e.serviceUserMedicationId)) eventByMed.set(e.serviceUserMedicationId, e);
    }

    // PRN is "as needed" — it can be given in each visit independently. Its
    // "recorded" status must be scoped to THIS visit, otherwise a PRN given in
    // an earlier same-day visit would wrongly show as already given here.
    // (Scheduled meds keep the day-scoped `eventByMed` above — unchanged.)
    const prnEventThisVisit = new Map<string, (typeof events)[number]>();
    for (const e of events) {
      if (
        e.isPrn &&
        e.visitId === ctx.primaryVisit.id &&
        !prnEventThisVisit.has(e.serviceUserMedicationId)
      ) {
        prnEventThisVisit.set(e.serviceUserMedicationId, e);
      }
    }

    const mapMed = (m: (typeof scheduledMeds)[number] | (typeof prnMeds)[number], isPrn: boolean) => {
      const dose = [m.dose, m.strength].filter(Boolean).join(' ') || null;
      const route = m.route?.name ?? null;
      const timing = isPrn
        ? 'PRN'
        : 'schedules' in m && m.schedules[0]?.round?.name
          ? m.schedules[0].round.name
          : null;
      const detailParts = [dose, route, timing].filter(Boolean);
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

      // PRN → only this visit's administration counts; scheduled → day-scoped.
      const evt = isPrn ? prnEventThisVisit.get(m.id) : eventByMed.get(m.id);
      const echo = evt ? buildMarAdminEchoFields(evt, ctx.timeZone) : emptyMarAdminEchoFields();
      const dueTime =
        'schedules' in m && m.schedules[0]?.dueTime ? String(m.schedules[0].dueTime) : null;
      const scheduledDoseId = isPrn ? `${m.id}:prn` : `${m.id}:${dueTime ?? 'dose'}`;
      const relatedAllergy = allergyHit
        ? allergyLower.find((a) => m.medicationName.toLowerCase().includes(a)) ?? null
        : null;

      return {
        id: m.id,
        scheduledDoseId,
        name: m.medicationName,
        strength: m.strength ?? null,
        dose: m.dose ?? null,
        route,
        form: null as string | null,
        detailLine: detailParts.join(' · '),
        detail: detailParts.join(' · '),
        isPrn,
        controlled: Boolean(m.isControlledMedication),
        timeCritical: Boolean(adminRules.timeCritical),
        allergyWarning: Boolean(allergyHit),
        allergyWarningMessage: relatedAllergy ? `Related allergy: ${relatedAllergy}` : null,
        relatedAllergy,
        dueStatus: isPrn ? (echo.done ? 'recorded' : 'prn') : echo.done ? 'recorded' : 'due',
        countsTowardScheduledProgress: !isPrn,
        reasonForMedication: m.reasonForMedication ?? null,
        instructions: m.instructions ?? null,
        howAssisted: plannedHowAssistedLabel(m.howAssisted),
        bodyMapSite: bodyMapSiteByMedId.get(m.id) ?? null,
        scheduledLabel: dueTime,
        tags,
        ...echo,
      };
    };

    const sections: Array<{
      id: string;
      title: string;
      label: string;
      medicines: ReturnType<typeof mapMed>[];
      items: ReturnType<typeof mapMed>[];
    }> = [];

    if (standaloneScheduledMeds.length > 0) {
      const medicines = standaloneScheduledMeds.map((m) => mapMed(m, false));
      const title = round ? `SCHEDULED · ${round.name.toUpperCase()}` : 'SCHEDULED';
      sections.push({
        id: 'scheduled',
        title,
        label: title,
        medicines,
        items: medicines,
      });
    }

    if (prnMeds.length > 0) {
      const medicines = prnMeds.map((m) => mapMed(m, true));
      sections.push({
        id: 'prn',
        title: 'PRN · AS REQUIRED',
        label: 'PRN · AS REQUIRED',
        medicines,
        items: medicines,
      });
    }

    const blisterPacks = buildVisitBlisterPacks({
      packs: activePacks,
      visitRound,
      allergyLower,
      eventByMed,
      bodyMapSiteByMedId,
      timeZone: ctx.timeZone,
      visitAt: ctx.primaryVisit.scheduledStartDateTime,
    });

    return { sections, blisterPacks };
  }

  private async countVisitObservations(serviceUserId: string, since: Date) {
    return this.prisma.serviceUserObservation.count({
      where: { serviceUserId, deletedAt: null, recordedAt: { gte: since } },
    });
  }

  private resolveHandoverNote(ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>) {
    const meta = this.parseMetadata(ctx.job.metadata);
    const employeeApp =
      typeof meta.employeeApp === 'object' && meta.employeeApp
        ? (meta.employeeApp as Record<string, unknown>)
        : {};
    const handover =
      typeof employeeApp.handoverNote === 'object' && employeeApp.handoverNote
        ? (employeeApp.handoverNote as Record<string, unknown>)
        : null;
    const extra =
      typeof meta.extraCareNotes === 'string' ? meta.extraCareNotes.trim() : '';
    const visitNotes = ctx.primaryVisit.notes?.trim() ?? '';
    const value =
      (handover?.body != null ? String(handover.body).trim() : '') ||
      extra ||
      visitNotes ||
      null;
    const deviceRecordedAt =
      handover?.deviceRecordedAt != null
        ? String(handover.deviceRecordedAt)
        : handover?.recordedAt != null
          ? String(handover.recordedAt)
          : null;
    return {
      title: 'VISIT NOTE / HANDOVER',
      value,
      body: value,
      priority: handover?.priority != null ? String(handover.priority) : null,
      outstandingAction:
        handover?.outstandingAction != null ? String(handover.outstandingAction) : null,
      deviceRecordedAt,
      recordedAt: deviceRecordedAt,
      acknowledged: Boolean(employeeApp.handoverAcknowledged),
      acknowledgedAt:
        employeeApp.handoverAcknowledgedAt != null
          ? String(employeeApp.handoverAcknowledgedAt)
          : null,
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

  private async readEmployeeAppMeta(jobId: string): Promise<Record<string, unknown>> {
    const job = await this.prisma.scheduledJob.findUnique({
      where: { id: jobId },
      select: { metadata: true },
    });
    const meta = this.parseMetadata(job?.metadata);
    if (meta.employeeApp && typeof meta.employeeApp === 'object' && !Array.isArray(meta.employeeApp)) {
      return { ...(meta.employeeApp as Record<string, unknown>) };
    }
    return {};
  }

  private async mergeEmployeeAppMeta(
    jobId: string,
    mutator: (employeeApp: Record<string, unknown>) => Record<string, unknown>,
  ) {
    const job = await this.prisma.scheduledJob.findUnique({
      where: { id: jobId },
      select: { metadata: true },
    });
    const previousMeta = this.parseMetadata(job?.metadata);
    const previousEa =
      typeof previousMeta.employeeApp === 'object' && previousMeta.employeeApp
        ? (previousMeta.employeeApp as Record<string, unknown>)
        : {};
    const employeeApp = mutator({ ...previousEa });
    await this.prisma.scheduledJob.update({
      where: { id: jobId },
      data: {
        metadata: { ...previousMeta, employeeApp } as Prisma.InputJsonValue,
      },
    });
  }

  private async findIdempotentReplay(
    jobId: string,
    idempotencyKey: string | null | undefined,
  ): Promise<Record<string, unknown> | null> {
    if (!idempotencyKey) return null;
    const ea = await this.readEmployeeAppMeta(jobId);
    const map =
      ea.idempotency && typeof ea.idempotency === 'object' && !Array.isArray(ea.idempotency)
        ? (ea.idempotency as Record<string, unknown>)
        : {};
    const hit = map[idempotencyKey];
    if (hit && typeof hit === 'object' && !Array.isArray(hit)) {
      return hit as Record<string, unknown>;
    }
    return null;
  }

  private async assertFullDeliveryGates(
    ctx: Awaited<ReturnType<typeof this.loadJobForEmployee>>,
    dto: EmployeeAppVisitCompleteDto,
  ) {
    const [progress, medProgress] = await Promise.all([
      this.resolveProgress(ctx),
      this.resolveMedicationProgress(ctx),
    ]);

    if (progress.tasksTotal > 0 && progress.tasksDone < progress.tasksTotal) {
      contractError(
        'REQUIRED_TASKS_INCOMPLETE',
        `Required tasks incomplete (${progress.tasksDone}/${progress.tasksTotal})`,
      );
    }

    if (medProgress.dueCount > 0 && medProgress.givenCount < medProgress.dueCount) {
      contractError(
        'OUTSTANDING_MEDICATION',
        `Outstanding medication (${medProgress.givenCount}/${medProgress.dueCount})`,
      );
    }

    void dto;

    const ea = this.parseMetadata(ctx.job.metadata).employeeApp as
      | Record<string, unknown>
      | undefined;
    const handover =
      ea && typeof ea.handoverNote === 'object' && ea.handoverNote
        ? (ea.handoverNote as Record<string, unknown>)
        : null;
    if (
      handover &&
      String(handover.priority) === 'high' &&
      !Boolean(ea?.handoverAcknowledged) &&
      !String(handover.body ?? '').trim()
    ) {
      contractError('HANDOVER_REQUIRED', 'High-priority handover note is required');
    }
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

    const radius = EMPLOYEE_APP_ALLOWED_RADIUS_METERS;
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

function formatDob(d: Date) {
  return formatUkDateLabel(d);
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
    case InitialAssessmentRiskType.LONE_WORKER:
      return 'Lone worker risk';
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
