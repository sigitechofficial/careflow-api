import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  EcmExceptionKind,
  IncidentActionPriority,
  BodyMapBodyView,
  BodyMapLinkedModule,
  BodyMapRecordStatus,
  BodyMapRecordType,
  BodyMapRiskLevel,
  BodyMapSide,
  IncidentActionStatus,
  IncidentAttachmentCategory,
  IncidentExternalInvestigationType,
  IncidentInjurySeverity,
  IncidentInvestigationScope,
  IncidentPersonKind,
  IncidentPrivacyLevel,
  IncidentSeverity,
  IncidentStatus,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { BodyMapService } from '../body-map/body-map.service';
import { promises as fsp } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { CARER_INCIDENT_PHOTO_TYPES, incidentAttachmentRoot } from './incident-attachment.config';
import {
  dateOnlyKey,
  formatDayKey,
  setupAuditValues,
} from './incident-investigation.util';
import {
  externalBodyName,
  mapExternalBody,
  OPEN_EXTERNAL_BODY_STATUSES,
} from './incident-external-body.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { andWhereFragment, OrgScopeService } from '../common/org-scope/org-scope.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import {
  AddIncidentClarificationDto,
  CorrectIncidentDto,
} from './dto/incident-correction.dto';
import {
  CLARIFICATION_FIELD_LABELS,
  CORRECTION_FIELD_LABELS,
  PERSON_KIND_LABELS,
  WHO_INFORMED_KEY_LABELS,
  categoryDetailsLabel,
  diffCorrectableState,
  yesNoUnknownLabel,
  type CorrectableFieldKey,
  type CorrectableIncidentState,
} from './incident-correction.util';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto';
import { IncidentVisitOptionsQueryDto } from './dto/incident-visit-options-query.dto';
import {
  AssignIncidentOwnerDto,
  ChangeIncidentSeverityDto,
  ChangeIncidentStatusDto,
} from './dto/incident-workflow.dto';
import {
  PauseIncidentInvestigationDto,
  UpsertIncidentInvestigationDto,
  UpsertIncidentReviewDto,
} from './dto/incident-review.dto';
import {
  CompleteIncidentActionDto,
  CreateIncidentActionDto,
  UpdateIncidentActionDto,
  RemoveIncidentActionDto,
} from './dto/incident-action.dto';
import { UpsertIncidentOutcomeDto } from './dto/incident-outcome.dto';
import { SuspendIncidentCarerDto } from './dto/suspend-incident-carer.dto';
import { EmployeesService } from '../employees/employees.service';
import { LearningAssignmentsService } from '../learning/learning-assignments.service';
import { UsersService } from '../users/users.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { loadVisitRefsByScheduledJobIds } from '../scheduling/visit-ref-lookup.util';
import {
  NO_HOSPITAL_OUTCOME_CATEGORIES,
  normaliseIncidentCategoryDetails,
} from './incident-category-details.util';
import {
  canNeedNewRecord,
  effectiveActionStatus,
  needsCompletedRecord,
  isActionOverdue,
  missingMeasureFields,
} from './incident-action.util';
import {
  sanitizeChangesMadeDetails,
  sanitizeLinkedItems,
} from './incident-factor-details.util';
import { buildIncidentReviewFlagNotification } from './incident-review-flag-notification.util';
import {
  applyCandourToSharing,
  sanitizeOutcomeSharing,
  type OutcomeSharingEntry,
} from './incident-outcome.util';
import { IncidentCandourService } from './incident-candour.service';
import { InvestigationCoreService } from './investigation-core.service';
import {
  incidentServiceUserIds,
  versionCompletesCarePlanMeasure,
} from './incident-care-plan-measure.util';
import {
  fineSummary,
  staffActionLabel,
  staffActionProblems,
} from './incident-staff-action.util';
import type {
  CreateIncidentStaffActionDto,
  UpdateIncidentStaffActionDto,
} from './dto/incident-staff-action.dto';
import {
  INCIDENT_MEASURE_TYPE_LABELS,
  type IncidentMeasureType,
} from './incident-review.constants';
import {
  formatNotificationDateTime,
  loadNotificationDisplay,
} from '../common/utils/notification-display.util';
import { assertIncidentEditable } from './incident-access.util';
import { describeReviewChanges, immediateRiskError } from './incident-review.util';
import { operationalTodayIso } from '../common/utils/operational-day.util';
import {
  IMMEDIATE_ACTION_LABELS,
  INCIDENT_LOCATION_LABELS,
  INCIDENT_PRIVACY_RANK,
  INCIDENT_SEVERITY_LABELS,
  type ImmediateActionCode,
  INCIDENT_STATUS_LABELS,
  OPEN_INCIDENT_STATUSES,
  canTransitionIncidentStatus,
  isReopenTransition,
  isSendBackTransition,
  formatIncidentReference,
  incidentOccurredAtRange,
} from './incident-workflow.util';

const SUPER_ADMIN_ROLE = 'Super Admin';

/** Carer-app `incidentType` labels (API_CONTRACTS.md, API-18) → register category / subtype keys. */
const CARER_APP_INCIDENT_TYPES: Record<string, { category: string; subtype?: string }> = {
  'fall/slip': { category: 'ACCIDENT', subtype: 'FALL' },
  injury: { category: 'ACCIDENT' },
  'med error': { category: 'MEDICATION' },
  'near miss': { category: 'NEAR_MISS' },
  choking: { category: 'ACCIDENT', subtype: 'CHOKING' },
  aggression: { category: 'BEHAVIOUR' },
  safeguarding: { category: 'SAFEGUARDING' },
  'pressure damage': { category: 'SKIN_WOUND', subtype: 'PRESSURE_ULCER' },
  'missing person': { category: 'OTHER', subtype: 'MISSING_PERSON' },
  property: { category: 'OTHER', subtype: 'PROPERTY_LOSS_DAMAGE' },
  death: { category: 'DEATH' },
  other: { category: 'OTHER' },
};
const REFERENCE_MAX_RETRIES = 5;

type IncidentWithRefs = Prisma.IncidentGetPayload<{
  include: { category: true; subtype: true };
}>;

/** Everyone involved, primary person first, without duplicates. */
function involvedPeople(dto: {
  primaryServiceUserId?: string | null;
  primaryEmployeeId?: string | null;
  serviceUserIds?: string[];
  employeeIds?: string[];
}) {
  const uniq = (ids: (string | null | undefined)[]) =>
    [...new Set(ids.filter((id): id is string => Boolean(id)))];
  return {
    serviceUserIds: uniq([dto.primaryServiceUserId, ...(dto.serviceUserIds ?? [])]),
    employeeIds: uniq([dto.primaryEmployeeId, ...(dto.employeeIds ?? [])]),
  };
}

/** True when no kinds were sent (older clients) or the kind is among those affected. */
function affectedAllows(
  kinds: IncidentPersonKind[] | undefined,
  kind: IncidentPersonKind,
): boolean {
  return !kinds?.length || kinds.includes(kind);
}

/** A carer-app incident as passed from the employee-app visit service. */
export type CarerAppIncidentParams = {
  userId: string;
  employeeId: string;
  /** The visit, or null when the carer reports outside a visit (Me tab). */
  scheduledJobId: string | null;
  /** Category id, key (e.g. `ACCIDENT`) or carer-app label (e.g. `Fall/slip`). */
  categoryRef?: string | null;
  /** Subtype id or key within the resolved category. */
  subtypeRef?: string | null;
  /** The carer-app `incidentType` label (API-18), used when no category ref resolves. */
  incidentTypeLabel?: string | null;
  occurredAt: Date;
  severity: IncidentSeverity;
  primaryServiceUserId?: string | null;
  primaryEmployeeId?: string | null;
  affectedPersonKinds?: IncidentPersonKind[];
  primaryPersonName?: string | null;
  description: string;
  contextBefore?: string | null;
  contextAfter?: string | null;
  immediateActions?: string | null;
  injuryOccurred?: boolean;
  specificArea?: string | null;
  /** Free-text witnesses captured in the carer app; stored as written (witnessDetails). */
  witnesses?: string | null;
  /** Optional injury type label for injuries derived from body-map marks. */
  injuryType?: string | null;
  injuryDetails?: string | null;
  peopleInvolved?: string | null;
  whoInformedKeys?: string[];
  carerSafeguardingConcern?: boolean | null;
  followUpRequired?: boolean;
  emergencyServicesDetails?: string | null;
  familyInformed?: boolean;
  carerNotes?: string | null;
  /**
   * Body-map marks captured on the carer-app incident. When a primary service
   * user is present, each mark is mirrored as a real BodyMapRecord (type
   * INJURY) linked to the incident, plus an IncidentInjury row — so the mark
   * renders in the admin incident "Injuries" section (same shape as an
   * admin-added injury).
   */
  bodyMap?: {
    marks?: Array<{
      view?: string | null;
      recordView?: string | null;
      canvasView?: string | null;
      x: number;
      y: number;
      part?: string | null;
    }>;
  } | null;
  /** The visit's client: gives the branch (same rule as the office form). */
  visitServiceUserId?: string | null;
  /** Where did it happen? (office keys) — OTHER needs locationDetail. */
  locationKey?: string | null;
  locationDetail?: string | null;
  /** "What was done?" codes. */
  immediateActionCodes?: string[];
  /** Hospital outcome; null / missing = not known. */
  ambulanceAttended?: boolean | null;
  takenToAe?: boolean | null;
  admittedToHospital?: boolean | null;
  /** Category-specific answers; checked leniently (a carer may answer "not sure"). */
  categoryDetails?: Record<string, unknown> | null;
  /** Other carers on the visit who were involved (validated by the caller). */
  involvedEmployeeIds?: string[];
  /** Structured injuries (newer app builds); replaces the body-map-marks fallback. */
  injuries?: CarerAppInjuryInput[] | null;
  /** Reports outside a visit: the app's entry id and this save's write key. */
  appClientEntryId?: string | null;
  appWriteKey?: string | null;
  /** Branch when no client is involved (the carer's own branch). */
  fallbackLocationId?: string | null;
};

export type CarerAppInjuryInput = {
  personKind: 'SERVICE_USER' | 'EMPLOYEE' | 'OTHER';
  personEmployeeId?: string | null;
  personName?: string | null;
  injuryType: string;
  injurySeverity: 'MINOR' | 'MODERATE' | 'SERIOUS';
  bodyRegion?: string | null;
  notes?: string | null;
  mark?: {
    view?: string | null;
    recordView?: string | null;
    canvasView?: string | null;
    x: number;
    y: number;
    part?: string | null;
  } | null;
};

/** Timeline kind for each audited incident record type (anything else is a review flag). */
const HISTORY_KIND_BY_RECORD_TYPE: Record<string, string> = {
  IncidentInjury: 'INJURY',
  IncidentWitness: 'WITNESS',
  IncidentReviewChange: 'REVIEW',
  IncidentInvestigationChange: 'INVESTIGATION',
  IncidentCarerSuspensionChange: 'SUSPENSION',
  IncidentStaffActionChange: 'STAFF_ACTION',
  IncidentCandourChange: 'CANDOUR',
  IncidentExternalBodyChange: 'EXTERNAL',
  IncidentActionChange: 'ACTION',
};

/**
 * Service users on a carer-app incident: the affected one, plus — outside a visit — the client the
 * carer chose under "Client involved" (a visit report is already linked to its client by the visit).
 */
function carerAppInvolvedServiceUserIds(params: {
  primaryServiceUserId?: string | null;
  scheduledJobId: string | null;
  visitServiceUserId?: string | null;
}): string[] {
  const chosenClient = params.scheduledJobId ? null : (params.visitServiceUserId ?? null);
  return [
    ...new Set([params.primaryServiceUserId, chosenClient].filter((v): v is string => !!v)),
  ];
}

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly orgScope: OrgScopeService,
    private readonly bodyMap: BodyMapService,
    private readonly employees: EmployeesService,
    private readonly learningAssignments: LearningAssignmentsService,
    private readonly users: UsersService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly candour: IncidentCandourService,
    private readonly investigations: InvestigationCoreService,
  ) {}

  // ---------------------------------------------------------------------------
  // Privacy / access control
  // ---------------------------------------------------------------------------

  /** Highest privacy tier this user may view (0 normal, 1 restricted, 2 highly conf). */
  private maxViewablePrivacyRank(user: RequestUser): number {
    if (user.roles?.includes(SUPER_ADMIN_ROLE)) return 2;
    const perms = user.permissions ?? [];
    if (perms.includes('incidents.view_highly_confidential')) return 2;
    if (perms.includes('incidents.view_confidential')) return 1;
    return 0;
  }

  private allowedPrivacyLevels(user: RequestUser): IncidentPrivacyLevel[] {
    const rank = this.maxViewablePrivacyRank(user);
    return (
      Object.keys(INCIDENT_PRIVACY_RANK) as IncidentPrivacyLevel[]
    ).filter((level) => INCIDENT_PRIVACY_RANK[level] <= rank);
  }

  /** Where fragment that hides incidents above the caller's privacy clearance. */
  private privacyWhere(user: RequestUser): Prisma.IncidentWhereInput {
    return { privacyLevel: { in: this.allowedPrivacyLevels(user) } };
  }

  private canViewIncident(
    user: RequestUser,
    incident: { privacyLevel: IncidentPrivacyLevel },
  ): boolean {
    return (
      INCIDENT_PRIVACY_RANK[incident.privacyLevel] <=
      this.maxViewablePrivacyRank(user)
    );
  }

  // ---------------------------------------------------------------------------
  // Categories (configurable, DB-driven)
  // ---------------------------------------------------------------------------

  /**
   * Validates the category-specific answers on the office raise path (required answers
   * enforced), plus cross-field rules the util can't check on its own.
   */
  private async resolveOfficeCategoryDetails(dto: CreateIncidentDto): Promise<{
    details: Record<string, unknown> | null;
    categoryKey: string | null;
  }> {
    const [category, subtype] = await Promise.all([
      this.prisma.incidentCategory.findUnique({
        where: { id: dto.categoryId },
        select: { key: true },
      }),
      dto.subtypeId
        ? this.prisma.incidentSubtype.findUnique({
            where: { id: dto.subtypeId },
            select: { key: true },
          })
        : null,
    ]);
    if (!category) return { details: null, categoryKey: null };
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const { details, errors } = normaliseIncidentCategoryDetails(
      category.key,
      subtype?.key,
      dto.categoryDetails,
      { strict: true, today: dayKeyInTimeZone(new Date(), timeZone) },
    );
    if (
      category.key === 'CARE_DELIVERY' &&
      !dto.scheduledJobId &&
      !details?.noMatchingVisitReason
    ) {
      errors.push('Link the visit, or say why no visit matches');
    }
    const alleged = details?.allegedPerson as
      | { kind?: string; employeeId?: string }
      | undefined;
    if (alleged?.kind === 'STAFF' && alleged.employeeId) {
      const exists = await this.prisma.employee.findFirst({
        where: { id: alleged.employeeId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) errors.push('Alleged staff member does not exist');
    }
    if (errors.length) throw new BadRequestException(errors);
    return { details, categoryKey: category.key };
  }

  /**
   * Visits an office-recorded incident can be linked to: the incident date ± 1 day
   * (organisation timezone), for the service user — or, when there is none, the
   * staff member's allocated visits. Includes carers and the readable visit ref.
   */
  async listVisitOptions(
    user: RequestUser,
    query: IncidentVisitOptionsQueryDto,
  ) {
    if (!query.serviceUserId && !query.employeeId) {
      throw new BadRequestException('Provide serviceUserId or employeeId');
    }
    const scope = this.orgScope.fromRequestUser(user);
    if (query.serviceUserId) {
      await this.orgScope.assertServiceUserInScope(scope, query.serviceUserId);
    } else if (query.employeeId) {
      await this.orgScope.assertEmployeeInScope(scope, query.employeeId);
    }

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const from = operationalDayBounds(
      addDaysToOperationalIso(query.date, -1),
      timeZone,
    ).start;
    // An incident can't happen (or be discovered) during a visit that hasn't started yet.
    const now = new Date();
    const dayAfterEnd = operationalDayBounds(
      addDaysToOperationalIso(query.date, 1),
      timeZone,
    ).end;
    const to = dayAfterEnd < now ? dayAfterEnd : now;
    const liveAllocation = {
      status: {
        in: [
          AllocationStatus.ALLOCATED,
          AllocationStatus.CONFIRMED,
          AllocationStatus.PENDING_CONFIRMATION,
        ],
      },
    };

    const visits = await this.prisma.scheduledVisit.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        scheduledStartDateTime: { gte: from, lte: to },
        scheduledJob: { deletedAt: null },
        ...(query.serviceUserId
          ? { serviceUserId: query.serviceUserId }
          : {
              scheduledJob: {
                deletedAt: null,
                allocations: {
                  some: { employeeId: query.employeeId, ...liveAllocation },
                },
              },
            }),
      },
      select: {
        id: true,
        scheduledJobId: true,
        visitName: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        actualStartDateTime: true,
        actualEndDateTime: true,
        status: true,
        visitRef: true,
        serviceUser: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledStartDateTime: 'asc' },
      take: 50,
    });

    const jobIds = [...new Set(visits.map((v) => v.scheduledJobId))];
    const [allocations, refByJobId, sosExceptions] = await Promise.all([
      jobIds.length
        ? this.prisma.jobAllocation.findMany({
            where: { scheduledJobId: { in: jobIds }, ...liveAllocation },
            select: { scheduledJobId: true, employeeId: true },
          })
        : Promise.resolve(
            [] as { scheduledJobId: string; employeeId: string }[],
          ),
      loadVisitRefsByScheduledJobIds(this.prisma, jobIds),
      // Carer SOS raised on the visit (ECM) — reused instead of asking "was this an SOS?".
      jobIds.length
        ? this.prisma.ecmException.findMany({
            where: {
              scheduledJobId: { in: jobIds },
              kind: EcmExceptionKind.CARER_SOS,
            },
            select: { scheduledJobId: true },
          })
        : Promise.resolve([] as { scheduledJobId: string }[]),
    ]);
    const sosJobIds = new Set(sosExceptions.map((e) => e.scheduledJobId));
    const employeeIds = [...new Set(allocations.map((a) => a.employeeId))];
    const people = employeeIds.length
      ? await this.prisma.employeePersonalDetail.findMany({
          where: { employeeId: { in: employeeIds } },
          select: { employeeId: true, firstName: true, lastName: true },
        })
      : [];
    const nameByEmployee = new Map(
      people.map((p) => [
        p.employeeId,
        [p.firstName, p.lastName].filter(Boolean).join(' ').trim(),
      ]),
    );

    return {
      data: visits.map((v) => ({
        scheduledJobId: v.scheduledJobId,
        scheduledVisitId: v.id,
        visitName: v.visitName,
        date: dayKeyInTimeZone(v.scheduledStartDateTime, timeZone),
        startsAt: v.scheduledStartDateTime.toISOString(),
        endsAt: v.scheduledEndDateTime?.toISOString() ?? null,
        actualStartsAt: v.actualStartDateTime?.toISOString() ?? null,
        actualEndsAt: v.actualEndDateTime?.toISOString() ?? null,
        sosRaised: sosJobIds.has(v.scheduledJobId),
        status: v.status,
        visitRef: v.visitRef ?? refByJobId.get(v.scheduledJobId) ?? null,
        serviceUserName: [v.serviceUser.firstName, v.serviceUser.lastName]
          .filter(Boolean)
          .join(' '),
        carers: allocations
          .filter((a) => a.scheduledJobId === v.scheduledJobId)
          .map((a) => ({
            employeeId: a.employeeId,
            name: nameByEmployee.get(a.employeeId) || 'Unknown',
          })),
      })),
    };
  }

  async listCategories() {
    const categories = await this.prisma.incidentCategory.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        subtypes: {
          where: { deletedAt: null, isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, key: true, label: true, sortOrder: true },
        },
      },
    });
    return {
      data: categories.map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        description: c.description,
        sortOrder: c.sortOrder,
        subtypes: c.subtypes,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Reference number generation (race-safe, per-year sequence)
  // ---------------------------------------------------------------------------

  private async allocateReference(
    tx: Prisma.TransactionClient,
    year: number,
  ): Promise<string> {
    // Atomic upsert-and-increment: Postgres serialises concurrent writers on the
    // conflicting row, so each caller receives a unique, monotonic sequence value.
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
      INSERT INTO "incidents"."IncidentNumberSequence" ("year", "lastValue", "updatedAt")
      VALUES (${year}, 1, now())
      ON CONFLICT ("year")
      DO UPDATE SET "lastValue" = "IncidentNumberSequence"."lastValue" + 1, "updatedAt" = now()
      RETURNING "lastValue"
    `);
    const value = rows[0]?.lastValue ?? 1;
    return formatIncidentReference(year, value);
  }

  // ---------------------------------------------------------------------------
  // Create (frontline reporting)
  // ---------------------------------------------------------------------------

  async create(
    user: RequestUser,
    dto: CreateIncidentDto,
    meta?: RequestAuditMeta,
  ) {
    const occurredAt = new Date(dto.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt is not a valid date');
    }
    if (occurredAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException(
        'Incident date/time cannot be in the future',
      );
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('Describe what happened');
    }
    if (dto.locationKey === 'OTHER' && !dto.locationDetail?.trim()) {
      throw new BadRequestException('Describe where it happened');
    }
    const actionCodes = dto.immediateActionCodes ?? [];
    if (actionCodes.includes('OTHER') && !dto.immediateActions?.trim()) {
      throw new BadRequestException(
        'Describe the actions taken when "Other" is selected',
      );
    }
    if (actionCodes.includes('NO_ACTION_NEEDED') && actionCodes.length > 1) {
      throw new BadRequestException(
        '"No action needed" cannot be combined with other actions',
      );
    }
    const informed = dto.whoInformedKeys ?? [];
    if (informed.includes('no_one_yet') && informed.length > 1) {
      throw new BadRequestException(
        '"No one informed yet" cannot be combined with other people',
      );
    }

    await this.validateReferences(dto);
    const { details: categoryDetails, categoryKey } =
      await this.resolveOfficeCategoryDetails(dto);

    const scope = this.orgScope.fromRequestUser(user);
    if (dto.locationId) {
      this.orgScope.assertLocationAccess(scope, dto.locationId);
    }
    const involved = involvedPeople(dto);
    for (const serviceUserId of involved.serviceUserIds) {
      await this.orgScope.assertServiceUserInScope(scope, serviceUserId);
    }
    for (const employeeId of involved.employeeIds) {
      await this.orgScope.assertEmployeeInScope(scope, employeeId);
    }

    const severity = dto.severity ?? IncidentSeverity.LOW;
    // An allegation against a colleague must not be readable by every carer in the branch.
    const allegedStaff =
      (categoryDetails?.allegedPerson as { kind?: string } | undefined)
        ?.kind === 'STAFF';
    const privacyLevel = allegedStaff
      ? IncidentPrivacyLevel.RESTRICTED
      : (dto.privacyLevel ?? IncidentPrivacyLevel.NORMAL);
    // Hospital outcome only applies when someone was affected (null = not known), and never
    // to a death (the death is the outcome) or a data breach.
    const outcomeApplies =
      (dto.affectedPersonKinds ?? []).length > 0 &&
      !NO_HOSPITAL_OUTCOME_CATEGORIES.has(categoryKey ?? '');
    const outcome = (v: boolean | null | undefined) =>
      outcomeApplies ? (v ?? null) : null;
    const year = new Date().getUTCFullYear();

    let created: IncidentWithRefs | null = null;
    for (let attempt = 0; attempt < REFERENCE_MAX_RETRIES; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const referenceNumber = await this.allocateReference(tx, year);
          const incident = await tx.incident.create({
            data: {
              referenceNumber,
              categoryId: dto.categoryId,
              subtypeId: dto.subtypeId ?? null,
              status: IncidentStatus.REPORTED,
              severity,
              privacyLevel,
              shareWithHandover: dto.shareWithHandover ?? false,
              occurredAt,
              locationId: dto.locationId ?? null,
              specificArea: dto.specificArea?.trim() || null,
              locationKey: dto.locationKey ?? null,
              locationDetail:
                dto.locationKey === 'OTHER' ? dto.locationDetail?.trim() || null : null,
              reportedById: user.id,
              // The reporter is always the carer; the office user is only the recorder.
              reporterEmployeeId: dto.reporterEmployeeId,
              scheduledJobId: dto.scheduledJobId ?? null,
              categoryDetails: categoryDetails
                ? (categoryDetails as Prisma.InputJsonObject)
                : Prisma.DbNull,
              ambulanceAttended: outcome(dto.ambulanceAttended),
              takenToAe: outcome(dto.takenToAe),
              admittedToHospital: outcome(dto.admittedToHospital),
              // The primary person is the one affected; others listed are only involved
              // (e.g. a second carer). Older clients without kinds keep "first listed".
              primaryServiceUserId:
                dto.primaryServiceUserId ??
                (affectedAllows(dto.affectedPersonKinds, IncidentPersonKind.SERVICE_USER)
                  ? (involved.serviceUserIds[0] ?? null)
                  : null),
              primaryEmployeeId:
                dto.primaryEmployeeId ??
                (affectedAllows(dto.affectedPersonKinds, IncidentPersonKind.EMPLOYEE)
                  ? (involved.employeeIds[0] ?? null)
                  : null),
              involvedServiceUserIds: involved.serviceUserIds,
              involvedEmployeeIds: involved.employeeIds,
              affectedPersonKinds: dto.affectedPersonKinds ?? [],
              primaryPersonKind:
                dto.primaryPersonKind ?? dto.affectedPersonKinds?.[0] ?? null,
              primaryPersonName: dto.primaryPersonName?.trim() || null,
              description: dto.description.trim(),
              contextBefore: dto.contextBefore?.trim() || null,
              contextAfter: dto.contextAfter?.trim() || null,
              immediateActions: dto.immediateActions?.trim() || null,
              immediateActionCodes: dto.immediateActionCodes ?? [],
              whoInformedKeys: dto.whoInformedKeys ?? [],
              injuryOccurred: dto.injuryOccurred ?? false,
              createdById: user.id,
            },
            include: { category: true, subtype: true },
          });

          await tx.incidentStatusHistory.create({
            data: {
              incidentId: incident.id,
              toStatus: IncidentStatus.REPORTED,
              changedById: user.id,
            },
          });
          await tx.incidentSeverityHistory.create({
            data: {
              incidentId: incident.id,
              toSeverity: severity,
              changedById: user.id,
            },
          });

          await this.audit.logAudit({
            tx,
            userId: user.id,
            module: AuditModule.INCIDENT,
            action: AuditAction.INCIDENT_CREATED,
            recordType: 'Incident',
            recordId: incident.id,
            description: `Incident ${incident.referenceNumber} reported`,
            newValues: auditSnapshot(incident),
            ipAddress: meta?.ipAddress,
            userAgent: meta?.userAgent,
          });

          return incident;
        });
        break;
      } catch (err) {
        if (
          this.isUniqueViolation(err) &&
          attempt < REFERENCE_MAX_RETRIES - 1
        ) {
          continue; // reference collided under concurrency — retry with a fresh number
        }
        throw err;
      }
    }

    if (!created) {
      throw new BadRequestException(
        'Could not allocate an incident reference — please retry',
      );
    }

    // Notifications must never block the frontline report from succeeding.
    void this.notifyManagersOfNewIncident(created, user.id).catch((e) =>
      this.logger.warn(
        `Incident notification failed for ${created?.referenceNumber}: ${e}`,
      ),
    );

    return { message: 'Incident reported', data: this.mapIncident(created) };
  }

  /**
   * Create a real Incident row from a carer-app submission. Mirrors create() but is
   * driven by the trusted employee-app visit context: it skips the office org-scope
   * permission checks and links the incident to the visit (scheduledJobId). Returns
   * the created incident so the caller can surface its reference number.
   */
  async createFromCarerApp(params: CarerAppIncidentParams): Promise<IncidentWithRefs> {
    // Never lose a carer report over an unrecognised category: resolve id / key / app label,
    // falling back to "Other".
    const { categoryId, subtypeId, categoryKey, subtypeKey } = await this.resolveCarerAppCategory(
      params.categoryRef,
      params.subtypeRef,
      params.incidentTypeLabel,
    );
    const description =
      params.description.trim() || params.incidentTypeLabel?.trim() || 'Reported from the carer app';
    const reg = await this.carerAppRegisterFields(params, categoryKey, subtypeKey);

    const year = new Date().getUTCFullYear();
    let created: IncidentWithRefs | null = null;
    for (let attempt = 0; attempt < REFERENCE_MAX_RETRIES; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const referenceNumber = await this.allocateReference(tx, year);
          const incident = await tx.incident.create({
            data: {
              referenceNumber,
              categoryId,
              subtypeId,
              status: IncidentStatus.REPORTED,
              severity: params.severity,
              privacyLevel: reg.privacyLevel,
              shareWithHandover: false,
              occurredAt: reg.occurredAt,
              scheduledJobId: params.scheduledJobId,
              locationId: reg.locationId,
              locationKey: reg.locationKey,
              locationDetail: reg.locationDetail,
              categoryDetails: reg.categoryDetails,
              ambulanceAttended: reg.ambulanceAttended,
              takenToAe: reg.takenToAe,
              admittedToHospital: reg.admittedToHospital,
              immediateActionCodes: reg.immediateActionCodes,
              appClientEntryId: params.appClientEntryId ?? null,
              appLastWriteKey: params.appWriteKey ?? null,
              specificArea: params.specificArea?.trim() || null,
              // The carer is an employee-app account, not a platform User, so we do
              // not set reportedById/createdById (User FK). reporterEmployeeId links
              // the actual reporter.
              reportedById: null,
              reporterEmployeeId: params.employeeId,
              primaryServiceUserId: params.primaryServiceUserId ?? null,
              primaryEmployeeId: params.primaryEmployeeId ?? null,
              involvedServiceUserIds: carerAppInvolvedServiceUserIds(params),
              involvedEmployeeIds: reg.involvedEmployeeIds,
              affectedPersonKinds: params.affectedPersonKinds ?? [],
              primaryPersonKind: params.affectedPersonKinds?.[0] ?? null,
              primaryPersonName: params.primaryPersonName?.trim() || null,
              description,
              contextBefore: params.contextBefore?.trim() || null,
              contextAfter: params.contextAfter?.trim() || null,
              immediateActions: params.immediateActions?.trim() || null,
              injuryOccurred: reg.injuryOccurred,
              injuryDetails: params.injuryDetails?.trim() || null,
              peopleInvolved: params.peopleInvolved?.trim() || null,
              // Kept as the carer wrote it. Splitting free text into witness rows made
              // "No witnesses" a witness and cut sentences in half; the office records
              // structured witnesses from this text instead.
              witnessDetails: params.witnesses?.trim() || null,
              whoInformedKeys: params.whoInformedKeys ?? [],
              carerSafeguardingConcern: params.carerSafeguardingConcern ?? null,
              followUpRequired: params.followUpRequired ?? false,
              emergencyServicesDetails: params.emergencyServicesDetails?.trim() || null,
              familyInformed: params.familyInformed ?? false,
              carerNotes: params.carerNotes?.trim() || null,
              createdById: null,
            },
            include: { category: true, subtype: true },
          });

          await tx.incidentStatusHistory.create({
            data: {
              incidentId: incident.id,
              toStatus: IncidentStatus.REPORTED,
              changedById: null,
            },
          });
          await tx.incidentSeverityHistory.create({
            data: {
              incidentId: incident.id,
              toSeverity: params.severity,
              changedById: null,
            },
          });

          // Carer has no platform User row, so the audit entry is recorded without a
          // linked userId (AuditLog.userId is nullable); reporterEmployeeId on the
          // incident preserves who reported it.
          await this.audit.logAudit({
            tx,
            userId: undefined,
            module: AuditModule.INCIDENT,
            action: AuditAction.INCIDENT_CREATED,
            recordType: 'Incident',
            recordId: incident.id,
            description: `Incident ${incident.referenceNumber} reported from carer app`,
            newValues: auditSnapshot(incident),
          });

          return incident;
        });
        break;
      } catch (err) {
        if (
          this.isUniqueViolation(err) &&
          attempt < REFERENCE_MAX_RETRIES - 1
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!created) {
      throw new BadRequestException(
        'Could not allocate an incident reference — please retry',
      );
    }

    // The carer is not a platform User, so the notification has no User creator (FK).
    void this.notifyManagersOfNewIncident(created, null).catch((e) =>
      this.logger.warn(
        `Incident notification failed for ${created?.referenceNumber}: ${e}`,
      ),
    );

    // Injuries show in the admin "Injuries" section (and pins on the service user's body map).
    // Non-fatal: the incident is already created, so a failure here must not fail the carer submit.
    const injuriesDone = params.injuries?.length
      ? this.createCarerAppInjuries(created.id, params.injuries, reg.serviceUserId)
      : this.mirrorCarerAppInjuries(created.id, params);
    await injuriesDone.catch((e) =>
      this.logger.warn(
        `Failed to mirror carer-app injuries for ${created?.referenceNumber}: ${e}`,
      ),
    );

    return created;
  }

  /**
   * A carer edits their own report from the app. Allowed only until the office starts the
   * review — after that the record belongs to the review and the carer calls the office.
   */
  async updateFromCarerApp(
    incidentId: string,
    params: CarerAppIncidentParams,
  ): Promise<IncidentWithRefs> {
    const existing = await this.prisma.incident.findFirst({
      where: { id: incidentId, deletedAt: null },
      include: { category: true, subtype: true },
    });
    if (!existing) throw new NotFoundException('Incident not found');
    if (existing.reporterEmployeeId !== params.employeeId) {
      throw new ForbiddenException('Only the carer who reported this incident can change it');
    }
    if (existing.status !== IncidentStatus.REPORTED) {
      throw new ConflictException(
        'The office has started reviewing this incident, so it can no longer be changed from the app. Call the office to add information.',
      );
    }
    const { categoryId, subtypeId, categoryKey, subtypeKey } = await this.resolveCarerAppCategory(
      params.categoryRef,
      params.subtypeRef,
      params.incidentTypeLabel,
    );
    const reg = await this.carerAppRegisterFields(params, categoryKey, subtypeKey);
    const description =
      params.description.trim() || params.incidentTypeLabel?.trim() || existing.description;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.incident.update({
        where: { id: incidentId },
        data: {
          categoryId,
          subtypeId,
          severity: params.severity,
          // Privacy is never lowered by an edit.
          privacyLevel:
            existing.privacyLevel === IncidentPrivacyLevel.NORMAL
              ? reg.privacyLevel
              : existing.privacyLevel,
          occurredAt: reg.occurredAt,
          locationId: reg.locationId,
          locationKey: reg.locationKey,
          locationDetail: reg.locationDetail,
          specificArea: params.specificArea?.trim() || null,
          categoryDetails: reg.categoryDetails,
          ambulanceAttended: reg.ambulanceAttended,
          takenToAe: reg.takenToAe,
          admittedToHospital: reg.admittedToHospital,
          immediateActionCodes: reg.immediateActionCodes,
          primaryServiceUserId: params.primaryServiceUserId ?? null,
          primaryEmployeeId: params.primaryEmployeeId ?? null,
          involvedServiceUserIds: carerAppInvolvedServiceUserIds(params),
          involvedEmployeeIds: reg.involvedEmployeeIds,
          affectedPersonKinds: params.affectedPersonKinds ?? [],
          primaryPersonKind: params.affectedPersonKinds?.[0] ?? null,
          primaryPersonName: params.primaryPersonName?.trim() || null,
          description,
          contextBefore: params.contextBefore?.trim() || null,
          contextAfter: params.contextAfter?.trim() || null,
          immediateActions: params.immediateActions?.trim() || null,
          injuryOccurred: reg.injuryOccurred,
          injuryDetails: params.injuryDetails?.trim() || null,
          peopleInvolved: params.peopleInvolved?.trim() || null,
          witnessDetails: params.witnesses?.trim() || null,
          whoInformedKeys: params.whoInformedKeys ?? [],
          carerSafeguardingConcern: params.carerSafeguardingConcern ?? null,
          followUpRequired: params.followUpRequired ?? false,
          emergencyServicesDetails: params.emergencyServicesDetails?.trim() || null,
          familyInformed: params.familyInformed ?? false,
          carerNotes: params.carerNotes?.trim() || null,
          ...(params.appWriteKey ? { appLastWriteKey: params.appWriteKey } : {}),
        },
        include: { category: true, subtype: true },
      });
      if (row.severity !== existing.severity) {
        await tx.incidentSeverityHistory.create({
          data: {
            incidentId,
            fromSeverity: existing.severity,
            toSeverity: row.severity,
            changedById: null,
            reason: 'Changed by the carer in the app before review',
          },
        });
      }
      await this.audit.logAudit({
        tx,
        userId: undefined,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'Incident',
        recordId: incidentId,
        description: `Incident ${row.referenceNumber} changed by the carer in the app (before review)`,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(row),
      });
      return row;
    });

    // Newer app builds send the full injury list: keep unchanged ones, replace the rest.
    if (params.injuries) {
      await this.replaceCarerAppInjuries(incidentId, params.injuries, reg.serviceUserId).catch((e) =>
        this.logger.warn(`Failed to update carer-app injuries for ${updated.referenceNumber}: ${e}`),
      );
    }
    return updated;
  }

  /** Register fields shared by carer-app create and edit — the same rules as the office form. */
  private async carerAppRegisterFields(
    params: CarerAppIncidentParams,
    categoryKey: string,
    subtypeKey: string | null,
  ) {
    const now = new Date();
    // A device clock ahead of the server must not lose the report: a future time becomes now.
    const occurredAt = params.occurredAt.getTime() > now.getTime() ? now : params.occurredAt;
    const serviceUserId = params.visitServiceUserId ?? params.primaryServiceUserId ?? null;
    const su = serviceUserId
      ? await this.prisma.serviceUser.findFirst({
          where: { id: serviceUserId },
          select: { locationId: true },
        })
      : null;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    // Lenient: a carer may leave out what they don't know; the office completes it.
    const { details } = normaliseIncidentCategoryDetails(
      categoryKey,
      subtypeKey,
      params.categoryDetails ?? null,
      { strict: false, today: dayKeyInTimeZone(now, timeZone) },
    );
    const allegedKind = (details?.allegedPerson as { kind?: string } | undefined)?.kind;
    // A suspected colleague — or the carer isn't sure who — must not be readable by every carer.
    const restricted =
      categoryKey === 'SAFEGUARDING' && (allegedKind === 'STAFF' || allegedKind === 'UNKNOWN');
    const kinds = params.affectedPersonKinds ?? [];
    const outcomeApplies = kinds.length > 0 && !NO_HOSPITAL_OUTCOME_CATEGORIES.has(categoryKey);
    const outcome = (v?: boolean | null) => (outcomeApplies ? (v ?? null) : null);
    let codes = [...new Set(params.immediateActionCodes ?? [])];
    if (codes.includes('NO_ACTION_NEEDED') && codes.length > 1) {
      codes = codes.filter((c) => c !== 'NO_ACTION_NEEDED');
    }
    const locationKey = params.locationKey ?? null;
    return {
      serviceUserId,
      occurredAt,
      locationId: su?.locationId ?? params.fallbackLocationId ?? null,
      locationKey,
      locationDetail: locationKey === 'OTHER' ? params.locationDetail?.trim() || null : null,
      categoryDetails: details
        ? (details as Prisma.InputJsonObject)
        : (Prisma.DbNull as typeof Prisma.DbNull),
      privacyLevel: restricted ? IncidentPrivacyLevel.RESTRICTED : IncidentPrivacyLevel.NORMAL,
      ambulanceAttended: outcome(params.ambulanceAttended),
      takenToAe: outcome(params.takenToAe),
      admittedToHospital: outcome(params.admittedToHospital),
      immediateActionCodes: codes,
      involvedEmployeeIds: [
        ...new Set(
          [params.primaryEmployeeId, ...(params.involvedEmployeeIds ?? [])].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ],
      injuryOccurred:
        Boolean(params.injuryOccurred) || (params.injuries?.length ?? 0) > 0,
    };
  }

  /** Structured injuries from the app — the same rows the office "Add injury" dialog creates. */
  private async createCarerAppInjuries(
    incidentId: string,
    injuries: CarerAppInjuryInput[],
    serviceUserId: string | null,
  ): Promise<void> {
    for (const inj of injuries) {
      try {
        const severity = inj.injurySeverity as IncidentInjurySeverity;
        const personKind = inj.personKind as IncidentPersonKind;
        const injuryType = inj.injuryType.trim() || 'Injury';
        let bodyRegion = inj.bodyRegion?.trim() || null;
        let side: BodyMapSide | null = null;
        let bodyMapRecordId: string | null = null;
        // Body-map pins are for service users only (staff never get a body map).
        if (personKind === IncidentPersonKind.SERVICE_USER && serviceUserId && inj.mark) {
          const pin = await this.pinCarerAppInjury(incidentId, serviceUserId, inj.mark, {
            injuryType,
            description: inj.notes?.trim() || injuryType,
            severity,
          });
          if (pin) {
            bodyMapRecordId = pin.recordId;
            bodyRegion = bodyRegion ?? pin.bodyPart;
            side = pin.side;
          }
        }
        await this.prisma.incidentInjury.create({
          data: {
            incidentId,
            personKind,
            personServiceUserId:
              personKind === IncidentPersonKind.SERVICE_USER ? serviceUserId : null,
            personEmployeeId:
              personKind === IncidentPersonKind.EMPLOYEE ? (inj.personEmployeeId ?? null) : null,
            personName:
              personKind === IncidentPersonKind.OTHER ? inj.personName?.trim() || null : null,
            injurySeverity: severity,
            injuryType,
            bodyRegion,
            side,
            notes: inj.notes?.trim() || null,
            bodyMapRecordId,
            // createdById stays null: null marks a carer-app injury (office ones carry the user).
          },
        });
      } catch (e) {
        this.logger.warn(`Failed to save one carer-app injury: ${e}`);
      }
    }
  }

  /**
   * Carer edit: injuries recorded from the app (createdById null) are compared with the new list.
   * Unchanged ones stay; removed ones are soft-deleted and their body-map pin is unlinked and
   * closed (kept for history); new ones are added. Office-added injuries are never touched.
   */
  private async replaceCarerAppInjuries(
    incidentId: string,
    injuries: CarerAppInjuryInput[],
    serviceUserId: string | null,
  ): Promise<void> {
    const current = await this.prisma.incidentInjury.findMany({
      where: { incidentId, deletedAt: null, createdById: null },
    });

    const sig = (v: {
      personKind: string;
      person: string | null | undefined;
      injuryType: string;
      injurySeverity: string;
      notes: string | null | undefined;
      region: string | null | undefined;
    }) =>
      JSON.stringify([
        v.personKind,
        v.person ?? '',
        v.injuryType.trim(),
        v.injurySeverity,
        (v.notes ?? '').trim(),
        (v.region ?? '').trim().toLowerCase(),
      ]);
    const currentSigs = current.map((c) =>
      sig({
        personKind: c.personKind,
        person: c.personEmployeeId ?? c.personName,
        injuryType: c.injuryType,
        injurySeverity: c.injurySeverity,
        notes: c.notes,
        region: c.bodyRegion,
      }),
    );
    const remaining = [...currentSigs];
    const toAdd: CarerAppInjuryInput[] = [];
    for (const inj of injuries) {
      const s2 = sig({
        personKind: inj.personKind,
        person: inj.personKind === 'EMPLOYEE' ? inj.personEmployeeId : inj.personKind === 'OTHER' ? inj.personName?.trim() : null,
        injuryType: inj.injuryType,
        injurySeverity: inj.injurySeverity,
        notes: inj.notes,
        region:
          inj.bodyRegion?.trim() ||
          (inj.personKind === 'SERVICE_USER' ? inj.mark?.part?.trim() || (inj.mark ? 'Marked site' : null) : null),
      });
      const idx = remaining.indexOf(s2);
      if (idx >= 0) remaining[idx] = '';
      else toAdd.push(inj);
    }
    for (let i = 0; i < current.length; i++) {
      if (remaining[i] === '') continue;
      const old = current[i];
      await this.prisma.incidentInjury.update({
        where: { id: old.id },
        data: { deletedAt: new Date() },
      });
      if (old.bodyMapRecordId) {
        await this.prisma.bodyMapLink.deleteMany({
          where: {
            bodyMapRecordId: old.bodyMapRecordId,
            linkedModule: BodyMapLinkedModule.INCIDENT,
            linkedRecordId: incidentId,
          },
        });
        await this.prisma.bodyMapRecord.update({
          where: { id: old.bodyMapRecordId },
          data: { status: BodyMapRecordStatus.CLOSED },
        });
      }
    }
    if (toAdd.length) await this.createCarerAppInjuries(incidentId, toAdd, serviceUserId);
  }

  /** Pin one carer-app injury on the service user's body map and link it to the incident. */
  private async pinCarerAppInjury(
    incidentId: string,
    serviceUserId: string,
    mark: NonNullable<CarerAppInjuryInput['mark']>,
    info: { injuryType: string; description: string; severity: IncidentInjurySeverity },
  ): Promise<{ recordId: string; bodyPart: string; side: BodyMapSide | null } | null> {
    const x = Number(mark.x);
    const y = Number(mark.y);
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    const bodyPart = (mark.part ?? '').trim() || 'Marked site';
    const side = this.resolveSideFromPart(bodyPart);
    const record = await this.bodyMap.createRecord(undefined, {
      serviceUserId,
      recordType: BodyMapRecordType.INJURY,
      subType: info.injuryType,
      description: info.description,
      riskLevel: this.mapInjurySeverityToRisk(info.severity),
      bodyView: this.resolveBodyView(mark.view, mark.recordView),
      side: side ?? undefined,
      bodyPart,
      specificLocation: bodyPart,
      xCoordinate: x,
      yCoordinate: y,
      safeguardingTriggered: false,
      observationDetails: {
        recordView: mark.recordView ?? undefined,
        canvasView: mark.canvasView ?? undefined,
        source: 'incident',
        incidentId,
      },
    });
    await this.prisma.bodyMapLink.create({
      data: {
        bodyMapRecordId: record.id,
        linkedModule: BodyMapLinkedModule.INCIDENT,
        linkedRecordId: incidentId,
        label: 'Incident injury',
      },
    });
    return { recordId: record.id, bodyPart, side };
  }

  /**
   * Create an IncidentAttachment row from a carer-app incident photo. The source
   * file (already saved by the employee-app) is copied into the incident
   * attachment store so the authenticated admin download endpoint can serve it.
   */
  async addCarerAppAttachment(
    incidentId: string,
    input: {
      sourceAbsolutePath: string;
      originalName: string;
      mimeType: string;
      fileSize: number;
      caption?: string | null;
    },
  ): Promise<void> {
    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId },
      select: { id: true },
    });
    if (!incident) return;

    const root = incidentAttachmentRoot();
    await fsp.mkdir(root, { recursive: true });
    const ext = CARER_INCIDENT_PHOTO_TYPES[input.mimeType] ?? (extname(input.originalName) || '.jpg');
    const fileName = `${randomUUID()}${ext}`;
    await fsp.copyFile(input.sourceAbsolutePath, join(root, fileName));

    await this.prisma.incidentAttachment.create({
      data: {
        incidentId,
        category: IncidentAttachmentCategory.INCIDENT_PHOTO,
        fileName,
        originalName: input.originalName.slice(0, 255),
        fileUrl: `incidents/attachments/${fileName}`,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        caption: input.caption?.trim() || null,
      },
    });
  }

  /** Map a carer-app body-map view/recordView string to the BodyMapBodyView enum. */
  private resolveBodyView(view?: string | null, recordView?: string | null): BodyMapBodyView {
    const v = `${recordView ?? ''} ${view ?? ''}`.toLowerCase();
    if (v.includes('back')) return BodyMapBodyView.BACK;
    if (v.includes('face') || v.includes('head')) return BodyMapBodyView.FACE;
    if (v.includes('hand')) return BodyMapBodyView.HAND;
    if (v.includes('foot')) return BodyMapBodyView.FOOT;
    if (v.includes('left')) return BodyMapBodyView.LEFT;
    if (v.includes('right')) return BodyMapBodyView.RIGHT;
    return BodyMapBodyView.FRONT;
  }

  /** Derive a body side from a body-part label (e.g. "Right upper arm" → RIGHT). */
  private resolveSideFromPart(part?: string | null): BodyMapSide | null {
    const p = (part ?? '').toLowerCase();
    if (p.startsWith('left')) return BodyMapSide.LEFT;
    if (p.startsWith('right')) return BodyMapSide.RIGHT;
    if (p.startsWith('centre') || p.startsWith('center')) return BodyMapSide.CENTRE;
    return null;
  }

  private mapIncidentSeverityToInjury(severity: IncidentSeverity): IncidentInjurySeverity {
    switch (severity) {
      // FATAL is never derived: a death is an incident outcome, not an injury severity.
      case IncidentSeverity.CRITICAL:
      case IncidentSeverity.HIGH:
        return IncidentInjurySeverity.SERIOUS;
      case IncidentSeverity.MEDIUM:
        return IncidentInjurySeverity.MODERATE;
      default:
        return IncidentInjurySeverity.MINOR;
    }
  }

  private mapInjurySeverityToRisk(severity: IncidentInjurySeverity): BodyMapRiskLevel {
    switch (severity) {
      case IncidentInjurySeverity.FATAL:
        return BodyMapRiskLevel.URGENT;
      case IncidentInjurySeverity.SERIOUS:
        return BodyMapRiskLevel.HIGH;
      case IncidentInjurySeverity.MODERATE:
        return BodyMapRiskLevel.MEDIUM;
      default:
        return BodyMapRiskLevel.LOW;
    }
  }

  /**
   * For each body-map mark on a carer-app incident with a primary service user,
   * create a BodyMapRecord (type INJURY) + BodyMapLink (INCIDENT) + IncidentInjury
   * row — mirroring the admin "Add injury with body map" flow so the mark renders
   * in the incident "Injuries" section and the service user's body-map module.
   */
  private async mirrorCarerAppInjuries(
    incidentId: string,
    params: {
      primaryServiceUserId?: string | null;
      severity: IncidentSeverity;
      injuryType?: string | null;
      description: string;
      bodyMap?: {
        marks?: Array<{
          view?: string | null;
          recordView?: string | null;
          canvasView?: string | null;
          x: number;
          y: number;
          part?: string | null;
        }>;
      } | null;
    },
  ): Promise<void> {
    const serviceUserId = params.primaryServiceUserId;
    const marks = params.bodyMap?.marks ?? [];
    if (!serviceUserId || marks.length === 0) return;

    const injurySeverity = this.mapIncidentSeverityToInjury(params.severity);
    const riskLevel = this.mapInjurySeverityToRisk(injurySeverity);
    const injuryType = params.injuryType?.trim() || 'Injury';

    for (const mark of marks) {
      const x = Number(mark.x);
      const y = Number(mark.y);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      const bodyPart = (mark.part ?? '').trim() || 'Marked site';
      const side = this.resolveSideFromPart(bodyPart);
      try {
        const record = await this.bodyMap.createRecord(undefined, {
          serviceUserId,
          recordType: BodyMapRecordType.INJURY,
          subType: injuryType,
          description: params.description?.trim() || injuryType,
          riskLevel,
          bodyView: this.resolveBodyView(mark.view, mark.recordView),
          side: side ?? undefined,
          bodyPart,
          specificLocation: bodyPart,
          xCoordinate: x,
          yCoordinate: y,
          safeguardingTriggered: false,
          observationDetails: {
            recordView: mark.recordView ?? undefined,
            canvasView: mark.canvasView ?? undefined,
            source: 'incident',
            incidentId,
          },
        });
        await this.prisma.bodyMapLink.create({
          data: {
            bodyMapRecordId: record.id,
            linkedModule: BodyMapLinkedModule.INCIDENT,
            linkedRecordId: incidentId,
            label: 'Incident injury',
          },
        });
        await this.prisma.incidentInjury.create({
          data: {
            incidentId,
            personKind: IncidentPersonKind.SERVICE_USER,
            personServiceUserId: serviceUserId,
            injurySeverity,
            injuryType,
            bodyRegion: bodyPart,
            side: side ?? null,
            notes: null,
            bodyMapRecordId: record.id,
          },
        });
      } catch (e) {
        this.logger.warn(`Failed to mirror one carer-app injury mark: ${e}`);
      }
    }
  }

  private async validateReferences(dto: CreateIncidentDto): Promise<void> {
    const category = await this.prisma.incidentCategory.findFirst({
      where: { id: dto.categoryId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category)
      throw new BadRequestException('Invalid or inactive incident category');

    if (dto.subtypeId) {
      const subtype = await this.prisma.incidentSubtype.findFirst({
        where: {
          id: dto.subtypeId,
          categoryId: dto.categoryId,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (!subtype)
        throw new BadRequestException(
          'Subtype does not belong to the selected category',
        );
    }

    const involved = involvedPeople(dto);
    if (involved.serviceUserIds.length) {
      const found = await this.prisma.serviceUser.count({
        where: { id: { in: involved.serviceUserIds }, deletedAt: null },
      });
      if (found !== involved.serviceUserIds.length)
        throw new BadRequestException('Linked service user does not exist');
    }

    for (const employeeId of [
      ...involved.employeeIds,
      dto.reporterEmployeeId,
    ].filter(Boolean) as string[]) {
      const emp = await this.prisma.employee.findFirst({
        where: { id: employeeId, deletedAt: null },
        select: { id: true },
      });
      if (!emp) throw new BadRequestException('Linked employee does not exist');
    }

    if (dto.scheduledJobId) {
      const job = await this.prisma.scheduledJob.findFirst({
        where: { id: dto.scheduledJobId, deletedAt: null },
        select: { serviceUserId: true },
      });
      if (!job) throw new BadRequestException('Linked visit does not exist');
      if (
        involved.serviceUserIds.length &&
        !involved.serviceUserIds.includes(job.serviceUserId)
      ) {
        throw new BadRequestException(
          'The linked visit belongs to a different service user',
        );
      }
    }

    if (dto.locationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: dto.locationId, deletedAt: null },
        select: { id: true },
      });
      if (!loc) throw new BadRequestException('Linked location does not exist');
    }
  }

  // ---------------------------------------------------------------------------
  // List / read
  // ---------------------------------------------------------------------------

  async list(user: RequestUser, query: ListIncidentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const scope = this.orgScope.fromRequestUser(user);

    if (scope.locationIds?.length === 0) {
      return {
        data: {
          items: [],
          page,
          limit,
          total: 0,
          totalPages: 1,
        },
      };
    }

    const locationIds = this.orgScope.resolveListLocationIds(
      scope,
      query.locationId,
      undefined,
    );
    if (locationIds && locationIds.length === 0) {
      return {
        data: {
          items: [],
          page,
          limit,
          total: 0,
          totalPages: 1,
        },
      };
    }

    if (query.serviceUserId) {
      await this.orgScope.assertServiceUserInScope(scope, query.serviceUserId);
    }
    if (query.employeeId) {
      await this.orgScope.assertEmployeeInScope(scope, query.employeeId);
    }
    if (query.reporterEmployeeId) {
      await this.orgScope.assertEmployeeInScope(scope, query.reporterEmployeeId);
    }

    const where: Prisma.IncidentWhereInput = {
      deletedAt: null,
      ...this.privacyWhere(user),
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.reporterEmployeeId ? { reporterEmployeeId: query.reporterEmployeeId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.subtypeId ? { subtypeId: query.subtypeId } : {}),
      ...(query.serviceUserId
        ? { involvedServiceUserIds: { has: query.serviceUserId } }
        : {}),
      ...(query.employeeId
        ? { involvedEmployeeIds: { has: query.employeeId } }
        : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    };
    // A privacy filter narrows what the user may see; it must never replace that rule.
    if (query.privacyLevel) {
      andWhereFragment(where, { privacyLevel: query.privacyLevel });
    }
    // AND these in so they narrow `status` / `severity` rather than replacing them.
    if (query.openOnly) {
      andWhereFragment(where, { status: { in: OPEN_INCIDENT_STATUSES } });
    }
    if (query.severities?.length) {
      andWhereFragment(where, { severity: { in: query.severities } });
    }
    // Duty of Candour overdue (organisation setting; empty when the setting is off).
    const candourOverdueIds = new Set(await this.candour.overdueIncidentIds());
    if (query.candour === 'overdue') {
      andWhereFragment(where, { id: { in: [...candourOverdueIds] } });
    }

    if (locationIds?.length) {
      const serviceUsers = await this.prisma.serviceUser.findMany({
        where: { deletedAt: null, locationId: { in: locationIds } },
        select: { id: true },
      });
      const suIds = serviceUsers.map((s) => s.id);
      andWhereFragment(where, {
        OR: [
          { locationId: { in: locationIds } },
          ...(suIds.length
            ? [
                { primaryServiceUserId: { in: suIds } },
                { involvedServiceUserIds: { hasSome: suIds } },
              ]
            : []),
        ],
      });
    } else {
      andWhereFragment(where, await this.orgScope.incidentScopeWhere(scope));
    }

    const timeZone = await this.orgSettings.getOperationalTimezone();
    // Day-only values are whole days in the organisation timezone (e.g. Europe/London incl. BST).
    const dateRange = incidentOccurredAtRange(query.dateFrom, query.dateTo, timeZone);
    if (dateRange) where[query.dateField ?? 'occurredAt'] = dateRange;
    if (query.closedFrom) {
      where.closedAt = incidentOccurredAtRange(query.closedFrom, undefined, timeZone);
    }
    if (query.hasOverdueActions) {
      // Same definition as the dashboard count: open incidents with overdue, unfinished measures.
      andWhereFragment(where, { status: { in: OPEN_INCIDENT_STATUSES } });
      where.actions = {
        some: {
          deletedAt: null,
          dueDate: { lt: new Date() },
          status: { notIn: [IncidentActionStatus.COMPLETED, IncidentActionStatus.CANCELLED] },
        },
      };
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { specificArea: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.incident.count({ where }),
      this.prisma.incident.findMany({
        where,
        include: { category: true, subtype: true },
        orderBy:
          query.dateField === 'reportedAt'
            ? [{ reportedAt: 'desc' }, { occurredAt: 'desc' }]
            : [{ occurredAt: 'desc' }, { reportedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: {
        items: (
          await this.withPlaceAndPersonNames(
            await this.withVisitRef(
              await this.withReportedBy(rows.map((r) => this.mapIncident(r))),
            ),
          )
        ).map((item) => ({ ...item, candourOverdue: candourOverdueIds.has(item.id) })),
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** Open incidents (in this user's view) with Duty of Candour overdue. */
  private async countCandourOverdue(base: Prisma.IncidentWhereInput): Promise<number> {
    const ids = await this.candour.overdueIncidentIds();
    if (!ids.length) return 0;
    return this.prisma.incident.count({ where: { AND: [base, { id: { in: ids } }] } });
  }

  async getById(user: RequestUser, id: string) {
    await this.orgScope.assertIncidentInScope(this.orgScope.fromRequestUser(user), id);

    const incident = await this.prisma.incident.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        subtype: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        severityHistory: { orderBy: { createdAt: 'asc' } },
        review: true,
        investigation: true,
        outcome: true,
        actions: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        carerSuspensions: {
          where: { deletedAt: null },
          orderBy: { suspendedAt: 'asc' },
        },
        staffActions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        externalBodies: {
          where: { deletedAt: null },
          orderBy: { referredOn: 'asc' },
        },
        courseRecommendations: {
          where: { deletedAt: null },
          orderBy: { recommendedAt: 'asc' },
        },
        injuries: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        witnesses: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        relatedCareRecords: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        corrections: { orderBy: { createdAt: 'asc' } },
        clarifications: { orderBy: { createdAt: 'asc' } },
        reviewCycles: { orderBy: { cycleNumber: 'asc' } },
        investigationPauses: { orderBy: { pausedAt: 'asc' } },
        _count: {
          select: {
            attachments: { where: { deletedAt: null } },
            relatedFrom: true,
            relatedTo: true,
          },
        },
      },
    });
    // 404 (not 403) for incidents above clearance so their existence is not revealed.
    if (!incident || !this.canViewIncident(user, incident)) {
      throw new NotFoundException('Incident not found');
    }
    const [withPeople] = await this.withReportedBy([
      this.mapIncident(incident),
    ]);
    return {
      data: {
        ...withPeople,
        ...(await this.resolveAffectedRefs(incident)),
        visitRef: incident.scheduledJobId
          ? ((await loadVisitRefsByScheduledJobIds(this.prisma, [incident.scheduledJobId])).get(
              incident.scheduledJobId,
            ) ?? null)
          : null,
        ...(await this.mapCorrectionsAndClarifications(incident)),
        reviewSeverity: await this.reviewSeverityDecision(
          incident.severityHistory,
          incident.lastReopenedAt,
        ),
        reviewCycles: await this.mapReviewCycles(incident.reviewCycles),
        severityChanges: await this.severityChain(incident.severityHistory),
        history: await this.enrichTimelineWithActors([
          ...this.buildTimeline(incident, withPeople.reportedBy.name),
          ...(await this.injuryAndWitnessEvents(id)),
        ].sort((a, b) => a.at.localeCompare(b.at))),
        review: incident.review ? await this.withReviewerNames(incident.review) : null,
        investigation: incident.investigation
          ? await this.investigations.mapInvestigation(incident.investigation, incident.investigationPauses)
          : null,
        outcome: incident.outcome
          ? { ...incident.outcome, learningSharedOn: dateOnlyKey(incident.outcome.learningSharedOn) }
          : null,
        actions: incident.actions.map((a) => this.mapAction(a)),
        carerSuspensions: await (async () => {
          const today = dayKeyInTimeZone(
            new Date(),
            await this.orgSettings.getOperationalTimezone(),
          );
          return incident.carerSuspensions.map((s) => this.mapCarerSuspension(s, today));
        })(),
        externalBodies: incident.externalBodies.map((b) => mapExternalBody(b)),
        staffActions: incident.staffActions.map((a) => this.mapStaffAction(a)),
        candour: await this.candour.forIncident(incident.id),
        courseRecommendations: await this.mapCourseRecommendations(
          incident.courseRecommendations,
        ),
        injuries: incident.injuries,
        witnesses: incident.witnesses,
        relatedCareRecords: incident.relatedCareRecords,
        attachmentCount: incident._count.attachments,
        relatedIncidentCount: incident._count.relatedFrom + incident._count.relatedTo,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Workflow transitions
  // ---------------------------------------------------------------------------

  async changeStatus(
    user: RequestUser,
    id: string,
    dto: ChangeIncidentStatusDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForManage(user, id);
    // Reported → Under Review is "Start review" (sets the owner and reviewStartedAt).
    if (
      incident.status === IncidentStatus.REPORTED &&
      dto.status === IncidentStatus.UNDER_REVIEW
    ) {
      return this.startReview(user, id, meta);
    }
    if (!canTransitionIncidentStatus(incident.status, dto.status)) {
      throw new BadRequestException(
        `Cannot move incident from ${INCIDENT_STATUS_LABELS[incident.status]} to ${INCIDENT_STATUS_LABELS[dto.status]}`,
      );
    }
    const reopen = isReopenTransition(incident.status, dto.status);
    const sendBack = isSendBackTransition(incident.status, dto.status);

    if (reopen && !this.can(user, 'incidents.reopen')) {
      throw new ForbiddenException(
        'You do not have permission to reopen incidents',
      );
    }
    if ((reopen || sendBack) && !dto.reason?.trim()) {
      throw new BadRequestException(
        reopen
          ? 'A reason is required to reopen an incident'
          : 'A reason is required to send an incident back for investigation',
      );
    }

    // Leaving the investigation (to actions or ready to close) needs it completed first:
    // findings come before corrective measures or closure.
    if (incident.status === IncidentStatus.UNDER_INVESTIGATION && !reopen && !sendBack) {
      const investigation = await this.prisma.incidentInvestigation.findUnique({
        where: { incidentId: id },
        select: { investigationStatus: true },
      });
      if (investigation?.investigationStatus !== 'COMPLETED') {
        throw new BadRequestException(
          investigation?.investigationStatus === 'PAUSED'
            ? 'The investigation is paused. Resume and complete it before moving on'
            : 'Complete the investigation before moving on',
        );
      }
    }

    // Closing requires the dedicated permission, mandatory-action rules AND a
    // recorded closure outcome.
    if (dto.status === IncidentStatus.CLOSED) {
      if (!this.can(user, 'incidents.close')) {
        throw new ForbiddenException(
          'You do not have permission to close incidents',
        );
      }
      // No carer may stay suspended by accident: each open suspension needs a decision.
      const undecided = await this.prisma.incidentCarerSuspension.count({
        where: {
          incidentId: id,
          deletedAt: null,
          status: { in: ['SCHEDULED', 'ACTIVE'] },
          continuedAt: null,
        },
      });
      if (undecided > 0) {
        throw new BadRequestException(
          `Decide each open carer suspension (lift or continue) before closing — ${undecided} still open`,
        );
      }
      await this.assertClosable(id, incident.severity, dto, user);
      await this.assertExternalBodiesClosable(id, dto, user);
      await this.assertCandourClosable(id, dto, user);
      const outcome = await this.prisma.incidentOutcome.findUnique({
        where: { incidentId: id },
        select: { finalOutcome: true, outcomeSharing: true },
      });
      if (!outcome?.finalOutcome?.trim()) {
        throw new BadRequestException(
          'Record the closure outcome (final outcome) before closing this incident',
        );
      }
      // Rows can change after the outcome was saved (e.g. a Duty of Candour results letter replaced
      // by "no further enquiries"), so check them again at close.
      const sharingErrors = sanitizeOutcomeSharing(
        outcome.outcomeSharing,
        dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone()),
      ).errors;
      if (sharingErrors.length) {
        throw new BadRequestException(
          `Update "Outcome shared with" before closing: add ${sharingErrors.join(', ')}`,
        );
      }
    }

    const isClosing = dto.status === IncidentStatus.CLOSED;
    const isLeavingClosed =
      incident.status === IncidentStatus.CLOSED &&
      dto.status !== IncidentStatus.CLOSED;
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: {
          status: dto.status,
          updatedById: user.id,
          ...(isClosing ? { closedAt: new Date(), closedById: user.id } : {}),
          ...(isLeavingClosed ? { closedAt: null, closedById: null } : {}),
          // Reopening is an event on the incident, not a separate status.
          ...(reopen
            ? { reopenCount: { increment: 1 }, lastReopenedAt: new Date() }
            : {}),
        },
        include: { category: true, subtype: true },
      });
      await tx.incidentStatusHistory.create({
        data: {
          incidentId: id,
          fromStatus: incident.status,
          toStatus: dto.status,
          changedById: user.id,
          reason: dto.reason?.trim() || null,
        },
      });
      if (reopen) {
        // A reopened incident gets a new review cycle: the finished review is archived as it was
        // (never changed again) and the Review tab starts the next one.
        const finished = await tx.incidentReview.findUnique({ where: { incidentId: id } });
        if (finished) {
          await tx.incidentReviewCycle.create({
            data: {
              incidentId: id,
              cycleNumber: finished.cycleNumber,
              confirmedSeverity: finished.confirmedSeverity,
              investigationRequired: finished.investigationRequired,
              safeguardingConcern: finished.safeguardingConcern,
              possibleAbuseOrNeglect: finished.possibleAbuseOrNeglect,
              furtherMedicalAttention: finished.furtherMedicalAttention,
              externalNotificationRequired: finished.externalNotificationRequired,
              escalationRequired: finished.escalationRequired,
              immediateRisk: finished.immediateRisk,
              protectiveAction: finished.protectiveAction,
              managementNotes: finished.managementNotes,
              decision: finished.decision,
              decisionReason: finished.decisionReason,
              decidedAt: finished.decidedAt,
              reviewedById: finished.reviewedById,
              reviewedAt: finished.reviewedAt,
              lastUpdatedById: finished.updatedById,
              lastUpdatedAt: finished.updatedAt,
              archivedById: user.id,
              reopenReason: dto.reason?.trim() || null,
            },
          });
          await tx.incidentReview.delete({ where: { incidentId: id } });
        }
      }
      if (reopen || sendBack) {
        // Keep the previous findings but require the new investigation to be completed again.
        await tx.incidentInvestigation.updateMany({
          where: { incidentId: id, completedAt: { not: null } },
          data: { completedAt: null, investigationStatus: 'IN_PROGRESS' },
        });
      }
      if (dto.status === IncidentStatus.UNDER_INVESTIGATION) {
        // The investigation starts when the incident goes under investigation (its start date),
        // not when someone first saves the Investigate tab.
        await tx.incidentInvestigation.upsert({
          where: { incidentId: id },
          create: {
            incidentId: id,
            contributingFactors: [],
            recordsReviewed: [],
            createdById: user.id,
            updatedById: user.id,
          },
          update: {},
        });
      }
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: reopen
          ? AuditAction.INCIDENT_REOPENED
          : dto.status === IncidentStatus.CLOSED
            ? AuditAction.INCIDENT_CLOSED
            : AuditAction.INCIDENT_STATUS_CHANGED,
        recordType: 'Incident',
        recordId: id,
        description: reopen
          ? `Reopened: ${incident.status} → ${dto.status}`
          : sendBack
            ? `Sent back for investigation: ${incident.status} → ${dto.status}`
            : `Status ${incident.status} → ${dto.status}`,
        oldValues: { status: incident.status },
        newValues: { status: dto.status, reason: dto.reason ?? null },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return next;
    });

    return {
      message: 'Incident status updated',
      data: this.mapIncident(updated),
    };
  }

  /**
   * Reported → Under Review: a manager picks the incident up. They become the owner (unless
   * one is already set) and the time is kept for first-response reporting.
   */
  async startReview(user: RequestUser, id: string, meta?: RequestAuditMeta) {
    const incident = await this.loadForManage(user, id);
    if (incident.status !== IncidentStatus.REPORTED) {
      throw new BadRequestException('The review has already been started');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: {
          status: IncidentStatus.UNDER_REVIEW,
          reviewStartedAt: new Date(),
          ownerId: incident.ownerId ?? user.id,
          updatedById: user.id,
        },
        include: { category: true, subtype: true },
      });
      await tx.incidentStatusHistory.create({
        data: {
          incidentId: id,
          fromStatus: incident.status,
          toStatus: IncidentStatus.UNDER_REVIEW,
          changedById: user.id,
          reason: 'Review started',
        },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_STATUS_CHANGED,
        recordType: 'Incident',
        recordId: id,
        description: `Review started: ${incident.status} → ${IncidentStatus.UNDER_REVIEW}`,
        oldValues: { status: incident.status, ownerId: incident.ownerId },
        newValues: {
          status: IncidentStatus.UNDER_REVIEW,
          ownerId: next.ownerId,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return next;
    });
    return { message: 'Review started', data: this.mapIncident(updated) };
  }

  async changeSeverity(
    user: RequestUser,
    id: string,
    dto: ChangeIncidentSeverityDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForEdit(user, id);
    if (incident.severity === dto.severity) {
      return { message: 'No change', data: this.mapIncident(incident) };
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: { severity: dto.severity, updatedById: user.id },
        include: { category: true, subtype: true },
      });
      await tx.incidentSeverityHistory.create({
        data: {
          incidentId: id,
          fromSeverity: incident.severity,
          toSeverity: dto.severity,
          changedById: user.id,
          reason: dto.reason?.trim() || null,
        },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_SEVERITY_CHANGED,
        recordType: 'Incident',
        recordId: id,
        description: `Severity ${incident.severity} → ${dto.severity}`,
        oldValues: { severity: incident.severity },
        newValues: { severity: dto.severity, reason: dto.reason ?? null },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return next;
    });
    return {
      message: 'Incident severity updated',
      data: this.mapIncident(updated),
    };
  }

  async assignOwner(
    user: RequestUser,
    id: string,
    dto: AssignIncidentOwnerDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForEdit(user, id);
    const owner = await this.prisma.user.findFirst({
      where: { id: dto.ownerId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!owner)
      throw new BadRequestException('Owner is not a valid active user');

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: { ownerId: dto.ownerId, updatedById: user.id },
        include: { category: true, subtype: true },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_OWNER_CHANGED,
        recordType: 'Incident',
        recordId: id,
        oldValues: { ownerId: incident.ownerId },
        newValues: { ownerId: dto.ownerId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return next;
    });
    return {
      message: 'Incident owner assigned',
      data: this.mapIncident(updated),
    };
  }

  // ---------------------------------------------------------------------------
  // Corrections to raised details & clarification notes
  // ---------------------------------------------------------------------------

  /**
   * Correct raised details (manager, with a reason). Only fields that really change are recorded,
   * each with its old and new value. Closed incidents must be reopened first. The reporter's own
   * account can't be sent here (the DTO rejects it) — add a clarification note instead.
   */
  async correctIncident(
    user: RequestUser,
    id: string,
    dto: CorrectIncidentDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForEdit(user, id);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for the correction');
    const scope = this.orgScope.fromRequestUser(user);
    const errors: string[] = [];
    const before = this.correctableState(incident);

    // When it happened
    let occurredAt = incident.occurredAt;
    if (dto.occurredAt !== undefined) {
      occurredAt = new Date(dto.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) errors.push('When it happened is not a valid date');
      else if (occurredAt.getTime() > Date.now() + 60_000)
        errors.push('When it happened cannot be in the future');
    }

    // Category / type
    const categoryChanged = dto.categoryId !== undefined && dto.categoryId !== incident.categoryId;
    const categoryId = dto.categoryId ?? incident.categoryId;
    const subtypeId =
      dto.subtypeId !== undefined ? dto.subtypeId : categoryChanged ? null : incident.subtypeId;
    const category = categoryChanged
      ? await this.prisma.incidentCategory.findFirst({
          where: { id: categoryId, deletedAt: null, isActive: true },
          select: { id: true, key: true },
        })
      : incident.category;
    if (!category) throw new BadRequestException('Category not found');
    const subtype =
      subtypeId && (categoryChanged || subtypeId !== incident.subtypeId)
        ? await this.prisma.incidentSubtype.findFirst({
            where: { id: subtypeId, categoryId, deletedAt: null, isActive: true },
            select: { key: true },
          })
        : subtypeId
          ? incident.subtype
          : null;
    if (subtypeId && !subtype) errors.push('Type does not belong to the selected category');

    // People
    const kinds = dto.affectedPersonKinds ?? incident.affectedPersonKinds;
    const peopleTouched =
      dto.affectedPersonKinds !== undefined ||
      dto.primaryServiceUserId !== undefined ||
      dto.primaryEmployeeId !== undefined ||
      dto.primaryPersonName !== undefined;
    const primaryServiceUserId = kinds.includes(IncidentPersonKind.SERVICE_USER)
      ? dto.primaryServiceUserId !== undefined
        ? dto.primaryServiceUserId
        : incident.primaryServiceUserId
      : null;
    const primaryEmployeeId = kinds.includes(IncidentPersonKind.EMPLOYEE)
      ? dto.primaryEmployeeId !== undefined
        ? dto.primaryEmployeeId
        : incident.primaryEmployeeId
      : null;
    const hasOtherKind = kinds.some(
      (k) => k !== IncidentPersonKind.SERVICE_USER && k !== IncidentPersonKind.EMPLOYEE,
    );
    const primaryPersonName = hasOtherKind
      ? (dto.primaryPersonName !== undefined
          ? dto.primaryPersonName
          : incident.primaryPersonName
        )?.trim() || null
      : null;
    if (peopleTouched) {
      if (kinds.includes(IncidentPersonKind.SERVICE_USER) && !primaryServiceUserId)
        errors.push('Select the service user affected');
      if (kinds.includes(IncidentPersonKind.EMPLOYEE) && !primaryEmployeeId)
        errors.push('Select the staff member affected');
      if (hasOtherKind && !primaryPersonName) errors.push('Enter the name of the person affected');
    }
    const uniq = (ids: (string | null | undefined)[]) =>
      [...new Set(ids.filter((x): x is string => Boolean(x)))];
    // The affected person is always first; the rest are "also involved".
    const otherSus = (dto.serviceUserIds ?? incident.involvedServiceUserIds).filter(
      (x) => dto.serviceUserIds !== undefined || x !== incident.primaryServiceUserId,
    );
    const otherEmps = (dto.employeeIds ?? incident.involvedEmployeeIds).filter(
      (x) => dto.employeeIds !== undefined || x !== incident.primaryEmployeeId,
    );
    const involvedServiceUserIds = uniq([primaryServiceUserId, ...otherSus]);
    const involvedEmployeeIds = uniq([primaryEmployeeId, ...otherEmps]);
    const newSus = involvedServiceUserIds.filter((x) => !incident.involvedServiceUserIds.includes(x));
    const newEmps = involvedEmployeeIds.filter((x) => !incident.involvedEmployeeIds.includes(x));
    if (newSus.length) {
      const found = await this.prisma.serviceUser.count({
        where: { id: { in: newSus }, deletedAt: null },
      });
      if (found !== newSus.length) errors.push('A selected service user does not exist');
      for (const suId of newSus) await this.orgScope.assertServiceUserInScope(scope, suId);
    }
    if (newEmps.length) {
      const found = await this.prisma.employee.count({
        where: { id: { in: newEmps }, deletedAt: null },
      });
      if (found !== newEmps.length) errors.push('A selected staff member does not exist');
      for (const empId of newEmps) await this.orgScope.assertEmployeeInScope(scope, empId);
    }

    // Branch
    const locationId = dto.locationId !== undefined ? dto.locationId : incident.locationId;
    if (locationId && locationId !== incident.locationId) {
      this.orgScope.assertLocationAccess(scope, locationId);
    }

    // Where it happened (OTHER needs a description)
    const locationKey = dto.locationKey !== undefined ? dto.locationKey : incident.locationKey;
    const locationDetail =
      locationKey === 'OTHER'
        ? (dto.locationDetail !== undefined ? dto.locationDetail : incident.locationDetail)?.trim() ||
          null
        : null;
    if (locationKey === 'OTHER' && !locationDetail) errors.push('Describe where it happened');

    // Visit — must belong to one of the service users involved
    const scheduledJobId =
      dto.scheduledJobId !== undefined ? dto.scheduledJobId : incident.scheduledJobId;
    const visitTouched =
      scheduledJobId !== incident.scheduledJobId || dto.serviceUserIds !== undefined || peopleTouched;
    if (scheduledJobId && visitTouched) {
      const job = await this.prisma.scheduledJob.findFirst({
        where: { id: scheduledJobId, deletedAt: null },
        select: { serviceUserId: true },
      });
      if (!job) errors.push('Linked visit does not exist');
      else if (involvedServiceUserIds.length && !involvedServiceUserIds.includes(job.serviceUserId))
        errors.push('The linked visit belongs to a different service user');
    }

    // Category details — re-checked whenever the category, type, details or visit change
    let categoryDetails = (incident.categoryDetails ?? null) as Record<string, unknown> | null;
    const detailsTouched =
      categoryChanged ||
      subtypeId !== incident.subtypeId ||
      dto.categoryDetails !== undefined ||
      scheduledJobId !== incident.scheduledJobId;
    if (detailsTouched) {
      const raw =
        dto.categoryDetails !== undefined
          ? dto.categoryDetails
          : categoryChanged
            ? null // a new category needs its own answers
            : incident.categoryDetails;
      const timeZone = await this.orgSettings.getOperationalTimezone();
      const result = normaliseIncidentCategoryDetails(category.key, subtype?.key, raw, {
        strict: true,
        today: dayKeyInTimeZone(new Date(), timeZone),
      });
      errors.push(...result.errors);
      categoryDetails = result.details;
      if (category.key === 'CARE_DELIVERY' && !scheduledJobId && !categoryDetails?.noMatchingVisitReason)
        errors.push('Link the visit, or say why no visit matches');
      const alleged = categoryDetails?.allegedPerson as { kind?: string; employeeId?: string } | undefined;
      if (alleged?.kind === 'STAFF' && alleged.employeeId) {
        const exists = await this.prisma.employee.findFirst({
          where: { id: alleged.employeeId, deletedAt: null },
          select: { id: true },
        });
        if (!exists) errors.push('Alleged staff member does not exist');
      }
    }

    // Hospital outcome — only when someone was affected, never for a death / data breach
    const outcomeApplies = kinds.length > 0 && !NO_HOSPITAL_OUTCOME_CATEGORIES.has(category.key);
    const outcome = (v: boolean | null | undefined, current: boolean | null) =>
      outcomeApplies ? (v !== undefined ? v : current) : null;

    // Immediate response (structured parts only; the free text is the reporter's account)
    const immediateActionCodes = dto.immediateActionCodes ?? incident.immediateActionCodes;
    if (dto.immediateActionCodes !== undefined) {
      if (immediateActionCodes.includes('NO_ACTION_NEEDED') && immediateActionCodes.length > 1)
        errors.push('"No action needed" cannot be combined with other actions');
      if (
        immediateActionCodes.includes('OTHER') &&
        !incident.immediateActionCodes.includes('OTHER') &&
        !incident.immediateActions?.trim()
      )
        errors.push('"Other" needs a description, which only the original report can give');
    }
    const whoInformedKeys = dto.whoInformedKeys ?? incident.whoInformedKeys;
    if (whoInformedKeys.includes('no_one_yet') && whoInformedKeys.length > 1)
      errors.push('"No one informed yet" cannot be combined with other people');

    if (errors.length) throw new BadRequestException(errors);

    // An allegation against a colleague must not be readable by every carer in the branch.
    const allegedStaff =
      (categoryDetails?.allegedPerson as { kind?: string } | undefined)?.kind === 'STAFF';
    const privacyLevel =
      allegedStaff && incident.privacyLevel === IncidentPrivacyLevel.NORMAL
        ? IncidentPrivacyLevel.RESTRICTED
        : incident.privacyLevel;

    const after: CorrectableIncidentState = {
      occurredAt: occurredAt.toISOString(),
      categoryId,
      subtypeId: subtypeId ?? null,
      affectedPersonKinds: kinds,
      primaryServiceUserId,
      primaryEmployeeId,
      primaryPersonName,
      involvedServiceUserIds,
      involvedEmployeeIds,
      locationId,
      locationKey,
      locationDetail,
      scheduledJobId,
      categoryDetails,
      ambulanceAttended: outcome(dto.ambulanceAttended, incident.ambulanceAttended),
      takenToAe: outcome(dto.takenToAe, incident.takenToAe),
      admittedToHospital: outcome(dto.admittedToHospital, incident.admittedToHospital),
      immediateActionCodes,
      whoInformedKeys,
      severity: dto.severity ?? incident.severity,
      privacyLevel,
    };
    const changes = diffCorrectableState(before, after);
    if (changes.length === 0) throw new BadRequestException('Nothing was changed');

    const label = await this.correctionLabeller([before, after]);
    const batchId = randomUUID();
    const severityChanged = after.severity !== incident.severity;

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: {
          occurredAt,
          categoryId,
          subtypeId: after.subtypeId,
          affectedPersonKinds: kinds,
          primaryPersonKind: kinds[0] ?? null,
          primaryServiceUserId,
          primaryEmployeeId,
          primaryPersonName,
          involvedServiceUserIds,
          involvedEmployeeIds,
          locationId,
          locationKey,
          locationDetail,
          scheduledJobId,
          categoryDetails: categoryDetails
            ? (categoryDetails as Prisma.InputJsonObject)
            : Prisma.DbNull,
          ambulanceAttended: after.ambulanceAttended,
          takenToAe: after.takenToAe,
          admittedToHospital: after.admittedToHospital,
          immediateActionCodes,
          whoInformedKeys,
          severity: after.severity as IncidentSeverity,
          privacyLevel,
          updatedById: user.id,
        },
        include: { category: true, subtype: true },
      });
      const json = (v: unknown) =>
        v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
      await tx.incidentCorrection.createMany({
        data: changes.map((c) => ({
          incidentId: id,
          batchId,
          fieldKey: c.fieldKey,
          fromValue: json(c.from),
          toValue: json(c.to),
          fromLabel: label(c.fieldKey, c.from),
          toLabel: label(c.fieldKey, c.to),
          reason,
          correctedById: user.id,
        })),
      });
      if (severityChanged) {
        await tx.incidentSeverityHistory.create({
          data: {
            incidentId: id,
            fromSeverity: incident.severity,
            toSeverity: after.severity as IncidentSeverity,
            changedById: user.id,
            reason: `Correction: ${reason}`,
          },
        });
      }
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_CORRECTED,
        recordType: 'Incident',
        recordId: id,
        description: `Corrected ${changes.map((c) => CORRECTION_FIELD_LABELS[c.fieldKey]).join(', ')}: ${reason}`,
        oldValues: Object.fromEntries(changes.map((c) => [c.fieldKey, c.from])) as Prisma.InputJsonObject,
        newValues: Object.fromEntries(changes.map((c) => [c.fieldKey, c.to])) as Prisma.InputJsonObject,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return next;
    });

    return {
      message: `Corrected ${changes.length} field${changes.length === 1 ? '' : 's'}`,
      data: this.mapIncident(updated),
    };
  }

  /**
   * Append a clarification to the reporter's own account (never edited or deleted).
   * Allowed on closed incidents too — it adds information without changing the record.
   */
  async addClarification(
    user: RequestUser,
    id: string,
    dto: AddIncidentClarificationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForManage(user, id);
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('Write the clarification');
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.incidentClarificationNote.create({
        data: { incidentId: id, field: dto.field, note, createdById: user.id },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_CLARIFICATION_ADDED,
        recordType: 'Incident',
        recordId: id,
        description: `Clarification added to ${CLARIFICATION_FIELD_LABELS[dto.field]}`,
        newValues: { field: dto.field, note },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return row;
    });
    return { message: 'Clarification added', data: created };
  }

  /**
   * Injury / witness changes and review flags (safeguarding / escalation raised) for the timeline,
   * read from the audit log (which keeps the reason for edits and removals). Removed rows are
   * included so their history stays visible.
   */
  private async injuryAndWitnessEvents(incidentId: string) {
    const [injuries, witnesses, attachments] = await Promise.all([
      this.prisma.incidentInjury.findMany({ where: { incidentId }, select: { id: true } }),
      this.prisma.incidentWitness.findMany({ where: { incidentId }, select: { id: true } }),
      this.prisma.incidentAttachment.findMany({
        where: { incidentId },
        select: {
          id: true,
          originalName: true,
          category: true,
          uploadedById: true,
          createdAt: true,
          deletedAt: true,
        },
      }),
    ]);
    const ids = [...injuries, ...witnesses].map((r) => r.id);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          ...(ids.length
            ? [{ recordType: { in: ['IncidentInjury', 'IncidentWitness'] }, recordId: { in: ids } }]
            : []),
          {
            recordType: {
              in: [
                'IncidentReviewFlag',
                'IncidentReviewChange',
                'IncidentInvestigationChange',
                'IncidentCarerSuspensionChange',
                'IncidentStaffActionChange',
                'IncidentCandourChange',
                'IncidentExternalBodyChange',
                'IncidentActionChange',
              ],
            },
            recordId: incidentId,
          },
          ...(attachments.length
            ? [
                {
                  recordType: 'IncidentAttachment',
                  recordId: { in: attachments.map((a) => a.id) },
                  description: { startsWith: 'Attachment removed' },
                },
              ]
            : []),
        ],
      },
      select: { recordType: true, recordId: true, description: true, userId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    // Documents / photos: from the rows themselves (carer-app photos have no audit entry).
    const removedBy = new Map(
      logs.filter((l) => l.recordType === 'IncidentAttachment').map((l) => [l.recordId, l.userId]),
    );
    const documentEvents = attachments.flatMap((a) => {
      const what = a.category === 'INCIDENT_PHOTO' ? 'Photo' : 'Document';
      const added = {
        at: a.createdAt.toISOString(),
        kind: 'DOCUMENT',
        detail: `${what} added: ${a.originalName}${a.uploadedById ? '' : ' (carer app)'}`,
        byId: a.uploadedById,
      };
      return a.deletedAt
        ? [
            added,
            {
              at: a.deletedAt.toISOString(),
              kind: 'DOCUMENT',
              detail: `${what} removed: ${a.originalName}`,
              byId: removedBy.get(a.id) ?? null,
            },
          ]
        : [added];
    });
    return [
      ...documentEvents,
      ...logs.filter((l) => l.recordType !== 'IncidentAttachment').map((l) => ({
      at: l.createdAt.toISOString(),
      kind: (l.recordType && HISTORY_KIND_BY_RECORD_TYPE[l.recordType]) || 'REVIEW_FLAG',
      detail: l.description ?? (l.recordType === 'IncidentInjury' ? 'Injury changed' : 'Witness changed'),
      byId: l.userId,
      })),
    ];
  }

  /**
   * Every severity step from what was reported to now (confirmations left out), with where it
   * came from and why — so the Review tab can show Medium → High → Critical → High.
   */
  private async severityChain(history: Prisma.IncidentSeverityHistoryGetPayload<object>[]) {
    const steps = history.filter((h) => !h.fromSeverity || h.fromSeverity !== h.toSeverity);
    const ids = [...new Set(steps.map((h) => h.changedById).filter((x): x is string => Boolean(x)))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const name = (uid: string | null) => {
      const u = users.find((x) => x.id === uid);
      return u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email : null;
    };
    return steps.map((h) => {
      const reason = h.reason ?? '';
      const source = !h.fromSeverity
        ? 'REPORTED'
        : reason.startsWith('Changed at review: ')
          ? 'REVIEW'
          : reason.startsWith('Correction: ')
            ? 'CORRECTION'
            : 'OTHER';
      return {
        fromSeverity: h.fromSeverity,
        toSeverity: h.toSeverity,
        source,
        reason: reason.replace(/^(Changed at review|Correction): /, '') || null,
        byName: name(h.changedById),
        at: h.createdAt.toISOString(),
      };
    });
  }

  /** Archived review cycles (earlier reviews of a reopened incident), with names. */
  private async mapReviewCycles(cycles: Prisma.IncidentReviewCycleGetPayload<object>[]) {
    const ids = [
      ...new Set(
        cycles
          .flatMap((c) => [c.reviewedById, c.lastUpdatedById, c.archivedById])
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const name = (uid: string | null) => {
      const u = users.find((x) => x.id === uid);
      return u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email : null;
    };
    return cycles.map((c) => ({
      ...c,
      reviewedByName: name(c.reviewedById),
      lastUpdatedByName: name(c.lastUpdatedById),
      archivedByName: name(c.archivedById),
    }));
  }

  /** The review with who first reviewed it and who last updated it. */
  private async withReviewerNames(review: Prisma.IncidentReviewGetPayload<object>) {
    const ids = [review.reviewedById, review.updatedById].filter((x): x is string => Boolean(x));
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const name = (uid: string | null) => {
      const u = users.find((x) => x.id === uid);
      return u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email : null;
    };
    return {
      ...review,
      reviewedByName: name(review.reviewedById),
      updatedByName: name(review.updatedById),
    };
  }

  /**
   * The severity decision made at review (confirmed, or changed with a reason), from the severity
   * history — shown on the Review tab.
   */
  private async reviewSeverityDecision(
    history: Prisma.IncidentSeverityHistoryGetPayload<object>[],
    currentCycleSince: Date | null = null,
  ) {
    // Only the current review cycle (after the last reopen) counts as "decided at review".
    const row = [...history]
      .reverse()
      .filter((h) => !currentCycleSince || h.createdAt >= currentCycleSince)
      .find((h) => h.reason === 'Confirmed at review' || h.reason?.startsWith('Changed at review: '));
    if (!row) return null;
    const by = row.changedById
      ? await this.prisma.user.findUnique({
          where: { id: row.changedById },
          select: { firstName: true, lastName: true, email: true },
        })
      : null;
    const changed = row.fromSeverity !== row.toSeverity;
    return {
      fromSeverity: row.fromSeverity,
      toSeverity: row.toSeverity,
      changed,
      reason: changed ? row.reason!.replace(/^Changed at review: /, '') : null,
      byName: by ? [by.firstName, by.lastName].filter(Boolean).join(' ').trim() || by.email : null,
      at: row.createdAt.toISOString(),
    };
  }

  /** Correction history and clarification notes for the detail view, with who made them. */
  private async mapCorrectionsAndClarifications(incident: {
    corrections: Prisma.IncidentCorrectionGetPayload<object>[];
    clarifications: Prisma.IncidentClarificationNoteGetPayload<object>[];
  }) {
    const ids = [
      ...new Set(
        [
          ...incident.corrections.map((c) => c.correctedById),
          ...incident.clarifications.map((n) => n.createdById),
        ].filter((x): x is string => Boolean(x)),
      ),
    ];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const nameById = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
    return {
      corrections: incident.corrections.map((c) => ({
        id: c.id,
        batchId: c.batchId,
        fieldKey: c.fieldKey,
        fieldLabel: CORRECTION_FIELD_LABELS[c.fieldKey as CorrectableFieldKey] ?? c.fieldKey,
        fromLabel: c.fromLabel,
        toLabel: c.toLabel,
        reason: c.reason,
        correctedByName: c.correctedById ? (nameById.get(c.correctedById) ?? null) : null,
        createdAt: c.createdAt.toISOString(),
      })),
      clarifications: incident.clarifications.map((n) => ({
        id: n.id,
        field: n.field,
        note: n.note,
        createdByName: n.createdById ? (nameById.get(n.createdById) ?? null) : null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  private correctableState(incident: IncidentWithRefs): CorrectableIncidentState {
    return {
      occurredAt: incident.occurredAt.toISOString(),
      categoryId: incident.categoryId,
      subtypeId: incident.subtypeId,
      affectedPersonKinds: incident.affectedPersonKinds,
      primaryServiceUserId: incident.primaryServiceUserId,
      primaryEmployeeId: incident.primaryEmployeeId,
      primaryPersonName: incident.primaryPersonName,
      involvedServiceUserIds: incident.involvedServiceUserIds,
      involvedEmployeeIds: incident.involvedEmployeeIds,
      locationId: incident.locationId,
      locationKey: incident.locationKey,
      locationDetail: incident.locationDetail,
      scheduledJobId: incident.scheduledJobId,
      categoryDetails: (incident.categoryDetails ?? null) as Record<string, unknown> | null,
      ambulanceAttended: incident.ambulanceAttended,
      takenToAe: incident.takenToAe,
      admittedToHospital: incident.admittedToHospital,
      immediateActionCodes: incident.immediateActionCodes,
      whoInformedKeys: incident.whoInformedKeys,
      severity: incident.severity,
      privacyLevel: incident.privacyLevel,
    };
  }

  /** Readable values for the correction history, resolved once for every id involved. */
  private async correctionLabeller(states: CorrectableIncidentState[]) {
    const all = <K extends keyof CorrectableIncidentState>(...keys: K[]) =>
      [
        ...new Set(
          states.flatMap((s) => keys.flatMap((k) => [s[k]].flat() as unknown[])).filter(
            (v): v is string => typeof v === 'string' && v.length > 0,
          ),
        ),
      ];
    const [categories, subtypes, sus, emps, locations, visitRefs, display] = await Promise.all([
      this.prisma.incidentCategory.findMany({
        where: { id: { in: all('categoryId') } },
        select: { id: true, label: true },
      }),
      this.prisma.incidentSubtype.findMany({
        where: { id: { in: all('subtypeId') } },
        select: { id: true, label: true },
      }),
      this.prisma.serviceUser.findMany({
        where: { id: { in: all('primaryServiceUserId', 'involvedServiceUserIds') } },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.employee.findMany({
        where: { id: { in: all('primaryEmployeeId', 'involvedEmployeeIds') } },
        select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.location.findMany({
        where: { id: { in: all('locationId') } },
        select: { id: true, name: true },
      }),
      loadVisitRefsByScheduledJobIds(this.prisma, all('scheduledJobId')),
      loadNotificationDisplay(this.prisma),
    ]);
    const name = (first?: string | null, last?: string | null) =>
      [first, last].filter(Boolean).join(' ').trim();
    const names = new Map<string, string>([
      ...categories.map((c) => [c.id, c.label] as [string, string]),
      ...subtypes.map((s) => [s.id, s.label] as [string, string]),
      ...sus.map((s) => [s.id, name(s.firstName, s.lastName) || 'Service user'] as [string, string]),
      ...emps.map(
        (e) =>
          [e.id, name(e.personalDetail?.firstName, e.personalDetail?.lastName) || 'Staff member'] as [
            string,
            string,
          ],
      ),
      ...locations.map((l) => [l.id, l.name] as [string, string]),
    ]);
    const list = (v: unknown, fn: (x: string) => string) =>
      Array.isArray(v) && v.length ? v.map((x) => fn(String(x))).join(', ') : '—';
    return (field: CorrectableFieldKey, value: unknown): string => {
      if (value === null || value === undefined || value === '') {
        return ['ambulanceAttended', 'takenToAe', 'admittedToHospital'].includes(field)
          ? 'Not known'
          : '—';
      }
      switch (field) {
        case 'occurredAt':
          return formatNotificationDateTime(new Date(String(value)), display);
        case 'affectedPersonKinds':
          return list(value, (k) => PERSON_KIND_LABELS[k] ?? k);
        case 'involvedServiceUserIds':
        case 'involvedEmployeeIds':
          return list(value, (x) => names.get(x) ?? 'Unknown');
        case 'scheduledJobId':
          return visitRefs.get(String(value)) ?? 'Visit';
        case 'categoryDetails':
          return categoryDetailsLabel(value);
        case 'ambulanceAttended':
        case 'takenToAe':
        case 'admittedToHospital':
          return yesNoUnknownLabel(value);
        case 'immediateActionCodes':
          return list(value, (c) => IMMEDIATE_ACTION_LABELS[c as ImmediateActionCode] ?? c);
        case 'whoInformedKeys':
          return list(value, (k) => WHO_INFORMED_KEY_LABELS[k] ?? k);
        case 'severity':
          return INCIDENT_SEVERITY_LABELS[value as IncidentSeverity] ?? String(value);
        case 'privacyLevel':
          return String(value).charAt(0) + String(value).slice(1).toLowerCase().replace(/_/g, ' ');
        case 'primaryPersonName':
        case 'locationDetail':
          return String(value);
        case 'locationKey':
          return INCIDENT_LOCATION_LABELS[value as keyof typeof INCIDENT_LOCATION_LABELS] ?? String(value);
        default:
          return names.get(String(value)) ?? String(value);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Manager review & investigation (upserted, one per incident)
  // ---------------------------------------------------------------------------

  async upsertReview(
    user: RequestUser,
    id: string,
    dto: UpsertIncidentReviewDto,
    meta?: RequestAuditMeta,
  ) {
    const current = await this.loadForEdit(user, id);
    const existing = await this.prisma.incidentReview.findUnique({
      where: { incidentId: id },
    });
    // Severity decision: required once; confirming keeps it, changing it needs a reason.
    // After that the review can still change it (with a reason); re-sending the same value is a no-op.
    const firstDecision = !existing?.confirmedSeverity;
    const decided = firstDecision
      ? dto.confirmedSeverity
      : dto.confirmedSeverity && dto.confirmedSeverity !== current.severity
        ? dto.confirmedSeverity
        : undefined;
    if (firstDecision && !decided) {
      throw new BadRequestException('Confirm or change the severity');
    }
    const severityChanges = Boolean(decided && decided !== current.severity);
    const severityReason = dto.severityReason?.trim() || null;
    if (severityChanges && !severityReason) {
      throw new BadRequestException('Give a reason for changing the severity');
    }
    // The review decision moves the workflow on; it can only be made while the review is open.
    const decisionReason = dto.decisionReason?.trim() || null;
    const reviewOpen =
      current.status === IncidentStatus.REPORTED ||
      current.status === IncidentStatus.UNDER_REVIEW ||
      current.status === IncidentStatus.REOPENED;
    if (dto.decision) {
      if (!reviewOpen) {
        throw new BadRequestException(
          `The review decision has already been made (the incident is ${INCIDENT_STATUS_LABELS[current.status]})`,
        );
      }
      if (dto.decision === 'NO_INVESTIGATION' && !decisionReason) {
        throw new BadRequestException('Give a reason why no investigation is needed');
      }
    }
    // Once the decision is made the review is a record: any change to it needs a reason and is
    // shown on the timeline. Before that it is a draft and can be saved freely.
    const immediateRisk = dto.immediateRisk ?? null;
    const answers = {
      safeguardingConcern: dto.safeguardingConcern ?? null,
      // No longer asked / hidden for now: keep what was saved unless a value is sent.
      possibleAbuseOrNeglect:
        dto.possibleAbuseOrNeglect !== undefined
          ? dto.possibleAbuseOrNeglect
          : (existing?.possibleAbuseOrNeglect ?? null),
      furtherMedicalAttention: dto.furtherMedicalAttention ?? null,
      externalNotificationRequired:
        dto.externalNotificationRequired !== undefined
          ? dto.externalNotificationRequired
          : (existing?.externalNotificationRequired ?? null),
      escalationRequired: dto.escalationRequired ?? null,
      immediateRisk,
      // The protective action only belongs with a "Yes".
      protectiveAction: immediateRisk === true ? dto.protectiveAction?.trim() || null : null,
      managementNotes: dto.managementNotes?.trim() || null,
    };
    const riskError = immediateRiskError(answers.immediateRisk, answers.protectiveAction);
    if (riskError) throw new BadRequestException(riskError);
    const reviewChanges =
      existing && !reviewOpen ? describeReviewChanges(existing, answers) : [];
    // Changes while the review is still a draft are shown too (no reason needed then).
    const draftChanges = existing && reviewOpen ? describeReviewChanges(existing, answers) : [];
    const changeReason = dto.changeReason?.trim() || null;
    if (reviewChanges.length && !changeReason) {
      throw new BadRequestException('Give a reason for the change');
    }
    // Saving a review on a Reported incident starts the review (safety net for "Start review").
    if (current.status === IncidentStatus.REPORTED) {
      await this.startReview(user, id, meta);
    }
    if (decided) {
      await this.prisma.$transaction(async (tx) => {
        if (severityChanges) {
          await tx.incident.update({
            where: { id },
            data: { severity: decided, updatedById: user.id },
          });
        }
        // from = to records a confirmation (shown as "Severity confirmed at review").
        await tx.incidentSeverityHistory.create({
          data: {
            incidentId: id,
            fromSeverity: current.severity,
            toSeverity: decided,
            changedById: user.id,
            reason: severityChanges ? `Changed at review: ${severityReason}` : 'Confirmed at review',
          },
        });
        await this.audit.logAudit({
          tx,
          userId: user.id,
          module: AuditModule.INCIDENT,
          action: AuditAction.INCIDENT_SEVERITY_CHANGED,
          recordType: 'Incident',
          recordId: id,
          description: severityChanges
            ? `Severity changed at review: ${current.severity} → ${decided} (${severityReason})`
            : `Severity confirmed at review: ${current.severity}`,
          oldValues: { severity: current.severity },
          newValues: { severity: decided, reason: severityReason },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      });
    }
    const data = {
      confirmedSeverity: decided ?? existing?.confirmedSeverity ?? null,
      investigationRequired: dto.decision
        ? dto.decision === 'INVESTIGATE'
        : (dto.investigationRequired ?? existing?.investigationRequired ?? null),
      ...answers,
      // The first reviewer and time are kept; later saves show as "last updated".
      reviewedById: existing?.reviewedById ?? user.id,
      reviewedAt: existing?.reviewedAt ?? new Date(),
      ...(dto.decision
        ? {
            decision: dto.decision,
            decisionReason: dto.decision === 'NO_INVESTIGATION' ? decisionReason : null,
            decidedAt: new Date(),
          }
        : {}),
    };
    // A new review after a reopen gets the next cycle number (earlier cycles are archived).
    const cycleNumber = existing
      ? existing.cycleNumber
      : (await this.prisma.incidentReviewCycle.count({ where: { incidentId: id } })) + 1;
    const review = await this.prisma.incidentReview.upsert({
      where: { incidentId: id },
      create: {
        incidentId: id,
        ...data,
        cycleNumber,
        createdById: user.id,
        updatedById: user.id,
      },
      update: { ...data, updatedById: user.id },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentReview',
      recordId: id,
      description: 'Manager review saved',
      oldValues: existing ? auditSnapshot(existing) : undefined,
      newValues: auditSnapshot(review),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    if (draftChanges.length) {
      await this.audit.logAudit({
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentReviewChange',
        recordId: id,
        description: `Review updated: ${draftChanges.join(', ')}`,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }
    if (reviewChanges.length) {
      await this.audit.logAudit({
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentReviewChange',
        recordId: id,
        description: `Review updated: ${reviewChanges.join(', ')} (${changeReason})`,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }
    // Escalation / safeguarding routing: only when a flag newly becomes "Yes" (re-saving the
    // review must not notify everyone again). Internal notifications; never blocking.
    const newlyRaised = {
      safeguardingConcern: review.safeguardingConcern === true && existing?.safeguardingConcern !== true,
      escalationRequired: review.escalationRequired === true && existing?.escalationRequired !== true,
    };
    const raisedLabels = [
      newlyRaised.safeguardingConcern && 'Safeguarding concern raised at review',
      newlyRaised.escalationRequired && 'Escalation requested at review',
    ].filter((x): x is string => Boolean(x));
    for (const description of raisedLabels) {
      // Kept in the audit log and shown on the timeline.
      await this.audit.logAudit({
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentReviewFlag',
        recordId: id,
        description,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }
    if (raisedLabels.length) {
      void this.notifyOnReviewFlags(id, newlyRaised, user.id).catch((e) =>
        this.logger.warn(`Incident review notification failed for ${id}: ${e}`),
      );
    }
    if (dto.decision) {
      await this.changeStatus(
        user,
        id,
        dto.decision === 'INVESTIGATE'
          ? { status: IncidentStatus.UNDER_INVESTIGATION, reason: 'Review completed: investigate' }
          : {
              status: IncidentStatus.AWAITING_CLOSURE,
              reason: `Review completed — no investigation needed: ${decisionReason}`,
            },
        meta,
      );
      return {
        message:
          dto.decision === 'INVESTIGATE'
            ? 'Review saved — investigation started'
            : 'Review saved — ready to close',
        data: review,
      };
    }
    return { message: 'Manager review saved', data: review };
  }

  async upsertInvestigation(
    user: RequestUser,
    id: string,
    dto: UpsertIncidentInvestigationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForEdit(user, id);
    const existing = await this.prisma.incidentInvestigation.findUnique({
      where: { incidentId: id },
    });
    const nextScope =
      dto.investigationScope !== undefined
        ? dto.investigationScope
        : (existing?.investigationScope ?? null);

    let nextExternalType: IncidentExternalInvestigationType | null;
    if (dto.investigationScope === IncidentInvestigationScope.INTERNAL) {
      nextExternalType = null;
    } else if (dto.externalType !== undefined) {
      nextExternalType = dto.externalType;
    } else if (dto.investigationScope === IncidentInvestigationScope.EXTERNAL) {
      nextExternalType = existing?.externalType ?? null;
    } else {
      nextExternalType = existing?.externalType ?? null;
    }

    if (nextScope === IncidentInvestigationScope.EXTERNAL && !nextExternalType) {
      throw new BadRequestException(
        'Select an external investigation type (Police, Agency, or Combined)',
      );
    }
    if (nextScope === IncidentInvestigationScope.INTERNAL) {
      nextExternalType = null;
    }

    const core = await this.investigations.prepareSave(existing, dto);
    const data = {
      investigationScope: nextScope,
      externalType: nextExternalType,
      ...core.data,
    };
    const investigation = await this.prisma.incidentInvestigation.upsert({
      where: { incidentId: id },
      create: {
        incidentId: id,
        ...data,
        createdById: user.id,
        updatedById: user.id,
      },
      update: { ...data, updatedById: user.id },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentInvestigation',
      recordId: id,
      description: 'Investigation updated',
      oldValues: existing ? auditSnapshot(existing) : undefined,
      newValues: auditSnapshot(investigation),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    // Timeline: one entry per meaningful set-up / evidence change (none when nothing changed).
    for (const line of core.changes) {
      await this.audit.logAudit({
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentInvestigationChange',
        recordId: id,
        description: line,
        oldValues: existing ? setupAuditValues(existing) : undefined,
        newValues: setupAuditValues(investigation),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }
    return { message: 'Investigation saved', data: await this.investigations.mapInvestigation(investigation, []) };
  }

  async eligibleInvestigators(user: RequestUser, id: string) {
    await this.loadForManage(user, id);
    // Office users are not linked to staff records, so the lead is always picked from the list.
    return { data: await this.investigations.investigatorCandidates() };
  }

  async pauseInvestigation(
    user: RequestUser,
    id: string,
    dto: PauseIncidentInvestigationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForEdit(user, id);
    const existing = await this.prisma.incidentInvestigation.findUnique({
      where: { incidentId: id },
    });
    const { reason, nextReviewDate: parsed } = await this.investigations.validatePause(existing, dto);
    const investigation = await this.prisma.$transaction(async (tx) => {
      await tx.incidentInvestigationPause.create({
        data: { incidentId: id, reason, pausedById: user.id, nextReviewDate: parsed },
      });
      const updated = await tx.incidentInvestigation.update({
        where: { incidentId: id },
        data: { investigationStatus: 'PAUSED', updatedById: user.id },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentInvestigationChange',
        recordId: id,
        description: `Investigation paused: ${reason} (next review ${formatDayKey(dto.nextReviewDate)})`,
        // validatePause only lets an in-progress investigation be paused.
        oldValues: { investigationStatus: 'IN_PROGRESS' },
        newValues: { investigationStatus: 'PAUSED', reason, nextReviewDate: dto.nextReviewDate },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return updated;
    });
    return { message: 'Investigation paused', data: investigation };
  }

  async resumeInvestigation(user: RequestUser, id: string, meta?: RequestAuditMeta) {
    await this.loadForEdit(user, id);
    const existing = await this.prisma.incidentInvestigation.findUnique({
      where: { incidentId: id },
    });
    if (existing?.investigationStatus !== 'PAUSED') {
      throw new BadRequestException('The investigation is not paused');
    }
    const investigation = await this.prisma.$transaction(async (tx) => {
      await tx.incidentInvestigationPause.updateMany({
        where: { incidentId: id, resumedAt: null },
        data: { resumedAt: new Date(), resumedById: user.id },
      });
      const updated = await tx.incidentInvestigation.update({
        where: { incidentId: id },
        data: { investigationStatus: 'IN_PROGRESS', updatedById: user.id },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentInvestigationChange',
        recordId: id,
        description: 'Investigation resumed',
        oldValues: { investigationStatus: 'PAUSED' },
        newValues: { investigationStatus: 'IN_PROGRESS' },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return updated;
    });
    return { message: 'Investigation resumed', data: investigation };
  }

  private employeeNames(ids: string[]): Promise<Record<string, string>> {
    return this.investigations.employeeNames(ids);
  }

  private userNames(ids: string[]): Promise<Record<string, string>> {
    return this.investigations.userNames(ids);
  }

  /**
   * Interim suspension of a carer while the incident is under investigation.
   * Starts today (employee set inactive, future rota unallocated) or on a later start date
   * (SCHEDULED, started by the hourly job). It stays until lifted; the decision after the
   * investigation is made at Outcome & close.
   */
  async suspendCarer(
    user: RequestUser,
    id: string,
    dto: SuspendIncidentCarerDto,
    meta?: RequestAuditMeta,
  ) {
    if (!this.can(user, 'incidents.investigate')) {
      throw new ForbiddenException(
        'You do not have permission to suspend a carer from an investigation',
      );
    }
    const incident = await this.loadForEdit(user, id);
    const investigation = await this.prisma.incidentInvestigation.findUnique({
      where: { incidentId: id },
      select: { investigationStatus: true },
    });
    if (
      incident.status !== IncidentStatus.UNDER_INVESTIGATION ||
      !investigation ||
      investigation.investigationStatus === 'COMPLETED'
    ) {
      throw new BadRequestException(
        'A carer can only be suspended while the investigation is in progress',
      );
    }
    const employeeId = dto.employeeId ?? incident.primaryEmployeeId;
    if (!employeeId) {
      throw new BadRequestException(
        'Select a carer to suspend (no primary employee on this incident)',
      );
    }
    await this.assertEmployeeExists(employeeId);
    await this.orgScope.assertEmployeeInScope(
      this.orgScope.fromRequestUser(user),
      employeeId,
    );
    const open = await this.prisma.incidentCarerSuspension.findFirst({
      where: { incidentId: id, employeeId, deletedAt: null, status: { not: 'LIFTED' } },
      select: { id: true },
    });
    if (open) {
      throw new BadRequestException('This carer is already suspended for this incident');
    }
    const reason = dto.reason.trim();
    const suspendFrom = this.parseDateOnly(dto.suspendFrom);
    const suspendTo = this.parseDateOnly(dto.suspendTo);
    const fromKey = dateOnlyKey(suspendFrom)!;
    const toKey = dateOnlyKey(suspendTo)!;
    const today = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    if (fromKey < today) {
      throw new BadRequestException('The suspension can’t start before today');
    }
    if (toKey < fromKey) {
      throw new BadRequestException('Suspension end date must be on or after the start date');
    }
    const startsNow = fromKey === today;
    if (startsNow) await this.deactivateSuspendedEmployee(user.id, employeeId, meta);

    const suspension = await this.prisma.incidentCarerSuspension.create({
      data: {
        incidentId: id,
        employeeId,
        reason,
        suspendFrom,
        suspendTo,
        suspendedAt: new Date(),
        status: startsNow ? 'ACTIVE' : 'SCHEDULED',
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const name = (await this.employeeNames([employeeId]))[employeeId] ?? 'Carer';
    await this.logSuspensionChange(
      user.id,
      id,
      startsNow
        ? `Interim suspension: ${name}, ${formatDayKey(fromKey)} to ${formatDayKey(toKey)} — ${reason}`
        : `Interim suspension scheduled: ${name}, from ${formatDayKey(fromKey)} to ${formatDayKey(toKey)} — ${reason}`,
      undefined,
      this.suspensionAuditValues(suspension),
      meta,
    );
    return {
      message: startsNow ? 'Carer suspended' : 'Suspension scheduled',
      data: this.mapCarerSuspension(suspension, today),
    };
  }

  /**
   * Lift a suspension (reason required). The carer is set active again when they have no other
   * active suspension on any incident. A scheduled suspension is simply cancelled.
   */
  async liftCarerSuspension(
    user: RequestUser,
    id: string,
    suspensionId: string,
    dto: { reason: string },
    meta?: RequestAuditMeta,
  ) {
    if (!this.can(user, 'incidents.investigate')) {
      throw new ForbiddenException('You do not have permission to lift a carer suspension');
    }
    await this.loadForEdit(user, id);
    const suspension = await this.prisma.incidentCarerSuspension.findFirst({
      where: { id: suspensionId, incidentId: id, deletedAt: null },
    });
    if (!suspension) throw new NotFoundException('Carer suspension not found');
    if (suspension.status === 'LIFTED') {
      throw new BadRequestException('This suspension has already been lifted');
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for lifting the suspension');

    const lifted = await this.prisma.incidentCarerSuspension.update({
      where: { id: suspension.id },
      data: {
        status: 'LIFTED',
        liftedAt: new Date(),
        liftedById: user.id,
        liftReason: reason,
        updatedById: user.id,
      },
    });
    if (suspension.status === 'ACTIVE') {
      await this.reactivateIfNoOtherSuspension(user.id, suspension.employeeId, meta);
    }
    const name = (await this.employeeNames([suspension.employeeId]))[suspension.employeeId] ?? 'Carer';
    await this.logSuspensionChange(
      user.id,
      id,
      suspension.status === 'SCHEDULED'
        ? `Scheduled suspension cancelled: ${name} — ${reason}`
        : `Suspension lifted: ${name} — ${reason}`,
      this.suspensionAuditValues(suspension),
      this.suspensionAuditValues(lifted),
      meta,
    );
    const today = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    return { message: 'Suspension lifted', data: this.mapCarerSuspension(lifted, today) };
  }

  /**
   * Decision at Outcome & close: the suspension continues beyond the incident (for example while
   * an HR disciplinary process runs). Needs a reason and the date it will next be reviewed / end.
   */
  async continueCarerSuspension(
    user: RequestUser,
    id: string,
    suspensionId: string,
    dto: { suspendTo: string; reason: string },
    meta?: RequestAuditMeta,
  ) {
    if (!this.can(user, 'incidents.investigate') && !this.can(user, 'incidents.close')) {
      throw new ForbiddenException('You do not have permission to decide on a carer suspension');
    }
    const incident = await this.loadForEdit(user, id);
    if (
      incident.status !== IncidentStatus.ACTIONS_REQUIRED &&
      incident.status !== IncidentStatus.AWAITING_CLOSURE
    ) {
      throw new BadRequestException(
        'Continuing a suspension is decided after the investigation, at Outcome & close',
      );
    }
    const suspension = await this.prisma.incidentCarerSuspension.findFirst({
      where: { id: suspensionId, incidentId: id, deletedAt: null },
    });
    if (!suspension) throw new NotFoundException('Carer suspension not found');
    if (suspension.status === 'LIFTED') {
      throw new BadRequestException('A lifted suspension can’t be continued');
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for continuing the suspension');
    const newTo = this.parseDateOnly(dto.suspendTo);
    const newKey = dateOnlyKey(newTo)!;
    const today = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    if (newKey < today) {
      throw new BadRequestException('The review / end date can’t be in the past');
    }
    if (newKey < dateOnlyKey(suspension.suspendFrom)!) {
      throw new BadRequestException('The review / end date can’t be before the suspension starts');
    }
    const continued = await this.prisma.incidentCarerSuspension.update({
      where: { id: suspension.id },
      data: {
        continuedAt: new Date(),
        continuedById: user.id,
        continueReason: reason,
        suspendTo: newTo,
        updatedById: user.id,
      },
    });
    const name = (await this.employeeNames([suspension.employeeId]))[suspension.employeeId] ?? 'Carer';
    await this.logSuspensionChange(
      user.id,
      id,
      `Suspension continued after the investigation: ${name} — ${reason} (until ${formatDayKey(newKey)})`,
      this.suspensionAuditValues(suspension),
      { ...this.suspensionAuditValues(continued), continueReason: reason },
      meta,
    );
    return { message: 'Suspension continued', data: this.mapCarerSuspension(continued, today) };
  }

  /**
   * A carer's interim suspensions across incidents (for the employee record), limited to the
   * incidents the viewer may see.
   */
  async listEmployeeSuspensions(user: RequestUser, employeeId: string) {
    const scope = this.orgScope.fromRequestUser(user);
    await this.orgScope.assertEmployeeInScope(scope, employeeId);
    const scopeWhere = await this.orgScope.incidentScopeWhere(scope);
    const rows = await this.prisma.incidentCarerSuspension.findMany({
      where: {
        employeeId,
        deletedAt: null,
        incident: {
          deletedAt: null,
          privacyLevel: { in: this.allowedPrivacyLevels(user) },
          ...(scopeWhere ? { AND: [scopeWhere as Prisma.IncidentWhereInput] } : {}),
        },
      },
      include: { incident: { select: { referenceNumber: true, status: true } } },
      orderBy: { suspendedAt: 'desc' },
    });
    const today = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    const names = await this.userNames(
      rows
        .flatMap((r) => [r.createdById, r.liftedById, r.continuedById])
        .filter((x): x is string => Boolean(x)),
    );
    const name = (uid: string | null) => (uid ? (names[uid] ?? null) : null);
    return {
      data: rows.map((r) => ({
        ...this.mapCarerSuspension(r, today),
        incidentReference: r.incident.referenceNumber,
        incidentStatus: r.incident.status,
        suspendedByName: name(r.createdById),
        liftedByName: name(r.liftedById),
        continuedByName: name(r.continuedById),
      })),
    };
  }

  /** Move the end date later (reason required). */
  async extendCarerSuspension(
    user: RequestUser,
    id: string,
    suspensionId: string,
    dto: { suspendTo: string; reason: string },
    meta?: RequestAuditMeta,
  ) {
    if (!this.can(user, 'incidents.investigate')) {
      throw new ForbiddenException('You do not have permission to extend a carer suspension');
    }
    await this.loadForEdit(user, id);
    const suspension = await this.prisma.incidentCarerSuspension.findFirst({
      where: { id: suspensionId, incidentId: id, deletedAt: null },
    });
    if (!suspension) throw new NotFoundException('Carer suspension not found');
    if (suspension.status === 'LIFTED') {
      throw new BadRequestException('A lifted suspension can’t be extended');
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for extending the suspension');
    const newTo = this.parseDateOnly(dto.suspendTo);
    const newKey = dateOnlyKey(newTo)!;
    const oldKey = dateOnlyKey(suspension.suspendTo)!;
    const today = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    if (newKey <= oldKey) {
      throw new BadRequestException('The new end date must be after the current end date');
    }
    if (newKey < today) {
      throw new BadRequestException('The new end date can’t be in the past');
    }
    const extended = await this.prisma.incidentCarerSuspension.update({
      where: { id: suspension.id },
      data: { suspendTo: newTo, updatedById: user.id },
    });
    const name = (await this.employeeNames([suspension.employeeId]))[suspension.employeeId] ?? 'Carer';
    await this.logSuspensionChange(
      user.id,
      id,
      `Suspension extended: ${name}, ${formatDayKey(oldKey)} → ${formatDayKey(newKey)} — ${reason}`,
      this.suspensionAuditValues(suspension),
      { ...this.suspensionAuditValues(extended), reason },
      meta,
    );
    return { message: 'Suspension extended', data: this.mapCarerSuspension(extended, today) };
  }

  /**
   * Hourly job: start scheduled suspensions whose start date has come (organisation timezone).
   * Returns how many were started.
   */
  async startScheduledSuspensions(systemUserId: string): Promise<number> {
    const today = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    const due = await this.prisma.incidentCarerSuspension.findMany({
      where: {
        deletedAt: null,
        status: 'SCHEDULED',
        suspendFrom: { lte: new Date(`${today}T00:00:00.000Z`) },
      },
    });
    for (const s of due) {
      await this.deactivateSuspendedEmployee(systemUserId, s.employeeId);
      await this.prisma.incidentCarerSuspension.update({
        where: { id: s.id },
        data: { status: 'ACTIVE' },
      });
      const name = (await this.employeeNames([s.employeeId]))[s.employeeId] ?? 'Carer';
      await this.logSuspensionChange(
        systemUserId,
        s.incidentId,
        `Suspension started: ${name} (scheduled start date)`,
        { status: 'SCHEDULED' },
        { status: 'ACTIVE' },
      );
    }
    return due.length;
  }

  /** Set the employee inactive (future rota is unallocated by the employees service). */
  private async deactivateSuspendedEmployee(
    actorId: string,
    employeeId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.employees.update(actorId, employeeId, { isActive: false }, meta);
    const inactiveStatus = await this.prisma.employeeStatus.findFirst({
      where: { deletedAt: null, name: { equals: 'Inactive', mode: 'insensitive' } },
      select: { id: true },
    });
    if (inactiveStatus) {
      await this.employees.updateStatus(actorId, employeeId, { statusId: inactiveStatus.id }, meta);
    }
  }

  /** Set the employee active again unless another incident still has them suspended. */
  private async reactivateIfNoOtherSuspension(
    actorId: string,
    employeeId: string,
    meta?: RequestAuditMeta,
  ) {
    const stillActive = await this.prisma.incidentCarerSuspension.count({
      where: { employeeId, deletedAt: null, status: 'ACTIVE' },
    });
    if (stillActive > 0) return;
    await this.employees.update(actorId, employeeId, { isActive: true }, meta);
    const activeStatus = await this.prisma.employeeStatus.findFirst({
      where: { deletedAt: null, name: { equals: 'Active', mode: 'insensitive' } },
      select: { id: true },
    });
    if (activeStatus) {
      await this.employees.updateStatus(actorId, employeeId, { statusId: activeStatus.id }, meta);
    }
  }

  private suspensionAuditValues(row: Prisma.IncidentCarerSuspensionGetPayload<object>) {
    return {
      employeeId: row.employeeId,
      status: row.status,
      reason: row.reason,
      suspendFrom: dateOnlyKey(row.suspendFrom),
      suspendTo: dateOnlyKey(row.suspendTo),
      liftReason: row.liftReason,
      continueReason: row.continueReason,
    };
  }

  /** Audit entry shown on the incident timeline (recordId = incident). */
  private async logSuspensionChange(
    userId: string,
    incidentId: string,
    description: string,
    oldValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
    meta?: RequestAuditMeta,
  ) {
    await this.audit.logAudit({
      userId,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentCarerSuspensionChange',
      recordId: incidentId,
      description,
      oldValues,
      newValues,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  /** Parse YYYY-MM-DD (or ISO datetime) as a UTC date-only value. */
  private parseDateOnly(value: string): Date {
    const day = value.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new BadRequestException('Invalid suspension date');
    }
    const parsed = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid suspension date');
    }
    return parsed;
  }

  private mapCarerSuspension(
    row: import('@prisma/client').IncidentCarerSuspension,
    todayKey: string,
  ) {
    const suspendTo = row.suspendTo.toISOString().slice(0, 10);
    return {
      id: row.id,
      incidentId: row.incidentId,
      employeeId: row.employeeId,
      reason: row.reason,
      suspendFrom: row.suspendFrom.toISOString().slice(0, 10),
      suspendTo,
      suspendedAt: row.suspendedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      status: row.status,
      /** Active and past its end date: a manager should lift or extend it. */
      reviewDue: row.status === 'ACTIVE' && suspendTo < todayKey,
      liftedAt: row.liftedAt?.toISOString() ?? null,
      liftReason: row.liftReason,
      /** Decided at Outcome & close: continues beyond the incident. */
      continuedAt: row.continuedAt?.toISOString() ?? null,
      continueReason: row.continueReason,
    };
  }

  /**
   * Course for a carer (a "Course for carer" corrective measure): creates a mandatory learning
   * assignment (allowed for inactive / suspended carers) and the recommendation record.
   */
  private async createCourseRecommendation(
    user: RequestUser,
    incident: { id: string; referenceNumber: string },
    input: { employeeId: string; courseId: string; dueAt: string | null; reason: string | null },
    meta?: RequestAuditMeta,
  ) {
    await this.assertEmployeeExists(input.employeeId);
    await this.orgScope.assertEmployeeInScope(this.orgScope.fromRequestUser(user), input.employeeId);
    const course = await this.prisma.learningCourse.findFirst({
      where: { id: input.courseId },
      select: { id: true, title: true },
    });
    if (!course) throw new BadRequestException('Course not found');
    const existingRow = await this.prisma.incidentCarerCourseRecommendation.findFirst({
      where: { incidentId: incident.id, employeeId: input.employeeId, courseId: input.courseId },
    });
    if (existingRow && !existingRow.deletedAt) {
      throw new BadRequestException('This course is already a measure for this carer on this incident');
    }
    const assignment = await this.learningAssignments.createFromSource(
      user.id,
      {
        employeeId: input.employeeId,
        courseId: input.courseId,
        dueAt: input.dueAt,
        isMandatory: true,
        assignmentReason:
          input.reason ?? `Corrective measure after incident ${incident.referenceNumber}`,
        sourceEntityType: 'Incident',
        sourceEntityId: incident.id,
        allowInactiveEmployee: true,
      },
      meta,
    );
    const data = {
      reason: input.reason,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      learningAssignmentId: assignment.id,
      recommendedAt: new Date(),
      updatedById: user.id,
    };
    const recommendation = existingRow
      ? await this.prisma.incidentCarerCourseRecommendation.update({
          where: { id: existingRow.id },
          data: { ...data, deletedAt: null },
        })
      : await this.prisma.incidentCarerCourseRecommendation.create({
          data: {
            ...data,
            incidentId: incident.id,
            employeeId: input.employeeId,
            courseId: input.courseId,
            createdById: user.id,
          },
        });
    return { recommendation, courseTitle: course.title };
  }

  /** Cancelling a course measure removes the recommendation and cancels its learning assignment. */
  private async cancelCourseRecommendation(
    userId: string,
    recommendationId: string,
    meta?: RequestAuditMeta,
  ) {
    const recommendation = await this.prisma.incidentCarerCourseRecommendation.findFirst({
      where: { id: recommendationId, deletedAt: null },
    });
    if (!recommendation) return;
    await this.prisma.incidentCarerCourseRecommendation.update({
      where: { id: recommendation.id },
      data: { deletedAt: new Date(), updatedById: userId },
    });
    if (recommendation.learningAssignmentId) {
      try {
        await this.learningAssignments.cancel(
          recommendation.learningAssignmentId,
          userId,
          { cancellationReason: 'Incident corrective measure cancelled' },
          meta,
        );
      } catch (err) {
        this.logger.warn(
          `Could not cancel learning assignment ${recommendation.learningAssignmentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async mapCourseRecommendations(
    rows: import('@prisma/client').IncidentCarerCourseRecommendation[],
  ) {
    if (rows.length === 0) return [];
    const courseIds = [...new Set(rows.map((r) => r.courseId))];
    const courses = await this.prisma.learningCourse.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, title: true, code: true },
    });
    const byId = new Map(courses.map((c) => [c.id, c]));
    return rows.map((row) => {
      const course = byId.get(row.courseId);
      return {
        id: row.id,
        incidentId: row.incidentId,
        employeeId: row.employeeId,
        courseId: row.courseId,
        courseTitle: course?.title ?? null,
        courseCode: course?.code ?? null,
        learningAssignmentId: row.learningAssignmentId,
        reason: row.reason,
        dueAt: row.dueAt?.toISOString() ?? null,
        recommendedAt: row.recommendedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Outcome & lessons learned (closure record)
  // ---------------------------------------------------------------------------

  async upsertOutcome(
    user: RequestUser,
    id: string,
    dto: UpsertIncidentOutcomeDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForEdit(user, id);
    const existing = await this.prisma.incidentOutcome.findUnique({
      where: { incidentId: id },
    });
    const investigation = await this.prisma.incidentInvestigation.findUnique({
      where: { incidentId: id },
      select: { id: true },
    });
    // "Changes made" is now recorded as corrective measures: keep older answers when not sent.
    const changesMade = dto.changesMade ?? existing?.changesMade ?? [];
    const changeDetails = sanitizeChangesMadeDetails(
      dto.changesMadeDetails !== undefined ? dto.changesMadeDetails : existing?.changesMadeDetails,
      changesMade,
    );
    const lessonsLearned = dto.lessonsLearned?.trim() || null;
    if (investigation && !lessonsLearned) {
      throw new BadRequestException('Add the lessons learned from the investigation');
    }
    const today = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    const sharing =
      dto.outcomeSharing !== undefined
        ? sanitizeOutcomeSharing(dto.outcomeSharing, today)
        : { entries: null, errors: [] as string[] };
    if (sharing.errors.length) {
      throw new BadRequestException(`To save the outcome, add: ${sharing.errors.join(', ')}`);
    }
    // Duty of Candour results letters fill (and override) those people's "outcome shared" rows.
    const candourLinks = await this.candour.outcomeLinks(id);
    const savedSharing = (
      Array.isArray(existing?.outcomeSharing) ? existing.outcomeSharing : []
    ) as unknown as OutcomeSharingEntry[];
    const baseSharing = sharing.entries ?? savedSharing;
    const sharingEntries =
      candourLinks.length || baseSharing.some((e) => e.source === 'CANDOUR')
        ? applyCandourToSharing(baseSharing, candourLinks)
        : sharing.entries;
    const learningSharedOn =
      dto.learningSharedOn !== undefined ? dto.learningSharedOn : dateOnlyKey(existing?.learningSharedOn);
    const learningSharedMethod =
      dto.learningSharedMethod !== undefined ? dto.learningSharedMethod : (existing?.learningSharedMethod ?? null);
    if (!!learningSharedOn !== !!learningSharedMethod) {
      throw new BadRequestException('Say both when and how the learning was shared with the team');
    }
    if (learningSharedOn && learningSharedOn > today) {
      throw new BadRequestException('The date the learning was shared can’t be in the future');
    }
    const data = {
      finalOutcome: dto.finalOutcome?.trim() || null,
      lessonsLearned,
      // With an investigation, preventability is its answer ("Could this have been prevented?").
      preventability: investigation ? (existing?.preventability ?? null) : (dto.preventability ?? null),
      changesMade,
      changesMadeDetails: changeDetails ?? Prisma.JsonNull,
      // Older Yes/No answers are kept as they were (replaced by outcomeSharing / learning shared).
      informationSharedWithStaff:
        dto.informationSharedWithStaff ?? existing?.informationSharedWithStaff ?? null,
      serviceUserInformed: dto.serviceUserInformed ?? existing?.serviceUserInformed ?? null,
      nokInformed: dto.nokInformed ?? existing?.nokInformed ?? null,
      finalManagementComments: dto.finalManagementComments?.trim() || null,
      ...(sharingEntries !== null
        ? {
            outcomeSharing: sharingEntries.length
              ? (sharingEntries as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          }
        : {}),
      learningSharedOn: learningSharedOn ? new Date(`${learningSharedOn}T00:00:00.000Z`) : null,
      learningSharedMethod,
      learningSharedNote:
        dto.learningSharedNote !== undefined
          ? dto.learningSharedNote?.trim() || null
          : (existing?.learningSharedNote ?? null),
    };
    const outcome = await this.prisma.incidentOutcome.upsert({
      where: { incidentId: id },
      create: {
        incidentId: id,
        ...data,
        createdById: user.id,
        updatedById: user.id,
      },
      update: { ...data, updatedById: user.id },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentOutcome',
      recordId: id,
      description: 'Closure outcome saved',
      oldValues: existing ? auditSnapshot(existing) : undefined,
      newValues: auditSnapshot(outcome),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return {
      message: 'Outcome saved',
      data: { ...outcome, learningSharedOn: dateOnlyKey(outcome.learningSharedOn) },
    };
  }

  // ---------------------------------------------------------------------------
  // Dashboard statistics (privacy-filtered)
  // ---------------------------------------------------------------------------

  async getStats(user: RequestUser, locationId?: string) {
    const scope = this.orgScope.fromRequestUser(user);
    const base: Prisma.IncidentWhereInput = {
      deletedAt: null,
      isArchived: false,
      ...this.privacyWhere(user),
    };

    const locationIds = this.orgScope.resolveListLocationIds(
      scope,
      locationId,
      undefined,
    );
    if (locationIds && locationIds.length === 0) {
      return {
        data: {
          total: 0,
          open: 0,
          closedThisMonth: 0,
          overdueActions: 0,
          notPickedUp: 0,
          underReview: 0,
          underInvestigation: 0,
          actionsRequired: 0,
          highOrCritical: 0,
          candourOverdue: 0,
          byStatus: {},
          bySeverity: {},
        },
      };
    }

    if (locationIds?.length) {
      const serviceUsers = await this.prisma.serviceUser.findMany({
        where: { deletedAt: null, locationId: { in: locationIds } },
        select: { id: true },
      });
      const suIds = serviceUsers.map((s) => s.id);
      andWhereFragment(base, {
        OR: [
          { locationId: { in: locationIds } },
          ...(suIds.length
            ? [
                { primaryServiceUserId: { in: suIds } },
                { involvedServiceUserIds: { hasSome: suIds } },
              ]
            : []),
        ],
      });
    } else {
      andWhereFragment(base, await this.orgScope.incidentScopeWhere(scope));
    }

    // Month boundaries follow the organisation calendar (not UTC), matching the list filters.
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const monthStartDay = `${operationalTodayIso(new Date(), timeZone).slice(0, 8)}01`;
    const startOfMonth = incidentOccurredAtRange(monthStartDay, undefined, timeZone)!.gte!;

    const [byStatus, bySeverity, open, closedThisMonth, total, overdueActions, openHighOrCritical] =
      await Promise.all([
        this.prisma.incident.groupBy({
          by: ['status'],
          where: base,
          _count: true,
        }),
        this.prisma.incident.groupBy({
          by: ['severity'],
          where: base,
          _count: true,
        }),
        this.prisma.incident.count({
          where: { ...base, status: { in: OPEN_INCIDENT_STATUSES } },
        }),
        this.prisma.incident.count({
          where: {
            ...base,
            status: IncidentStatus.CLOSED,
            closedAt: { gte: startOfMonth },
          },
        }),
        this.prisma.incident.count({ where: base }),
        this.prisma.incidentAction.count({
          where: {
            deletedAt: null,
            dueDate: { lt: new Date() },
            status: {
              notIn: [
                IncidentActionStatus.COMPLETED,
                IncidentActionStatus.CANCELLED,
              ],
            },
            // Closed incidents are read-only, so their leftover measures can't be actioned.
            incident: { is: { ...base, status: { in: OPEN_INCIDENT_STATUSES } } },
          },
        }),
        this.prisma.incident.count({
          where: {
            ...base,
            status: { in: OPEN_INCIDENT_STATUSES },
            severity: { in: [IncidentSeverity.HIGH, IncidentSeverity.CRITICAL] },
          },
        }),
      ]);

    const statusCounts = Object.fromEntries(
      byStatus.map((r) => [r.status, r._count]),
    ) as Record<IncidentStatus, number>;
    const severityCounts = Object.fromEntries(
      bySeverity.map((r) => [r.severity, r._count]),
    ) as Record<IncidentSeverity, number>;

    return {
      data: {
        total,
        open,
        closedThisMonth,
        overdueActions,
        notPickedUp: statusCounts[IncidentStatus.REPORTED] ?? 0,
        underReview: statusCounts[IncidentStatus.UNDER_REVIEW] ?? 0,
        underInvestigation:
          statusCounts[IncidentStatus.UNDER_INVESTIGATION] ?? 0,
        actionsRequired: statusCounts[IncidentStatus.ACTIONS_REQUIRED] ?? 0,
        highOrCritical: openHighOrCritical,
        candourOverdue: await this.countCandourOverdue(base),
        /** First day of the current organisation month (YYYY-MM-DD) — for "closed this month" links. */
        monthStart: monthStartDay,
        byStatus: statusCounts,
        bySeverity: severityCounts,
      },
    };
  }

  private async notifyOnReviewFlags(
    incidentId: string,
    review: {
      safeguardingConcern: boolean | null;
      escalationRequired: boolean | null;
    },
    actorId: string,
  ): Promise<void> {
    if (!review.safeguardingConcern && !review.escalationRequired) return;
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        privacyLevel: true,
        referenceNumber: true,
        severity: true,
        occurredAt: true,
        primaryServiceUserId: true,
        primaryEmployeeId: true,
        primaryPersonName: true,
        category: { select: { label: true } },
      },
    });
    if (!incident) return;
    // Only managers who may open this incident (clearance + branch) — the alert names the person.
    const recipients = await this.notifiableManagerIds(incident, actorId);
    if (!recipients.length) return;

    let personShortName: string | null = null;
    let personFullName: string | null = null;
    if (incident.primaryServiceUserId) {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: incident.primaryServiceUserId },
        select: { firstName: true, lastName: true, preferredName: true },
      });
      personFullName =
        [su?.firstName, su?.lastName].filter(Boolean).join(' ').trim() || null;
      personShortName = su?.preferredName?.trim() || personFullName;
    } else if (incident.primaryEmployeeId) {
      const pd = await this.prisma.employeePersonalDetail.findFirst({
        where: { employeeId: incident.primaryEmployeeId },
        select: { firstName: true, lastName: true },
      });
      personFullName = pd ? `${pd.firstName} ${pd.lastName}`.trim() : null;
      personShortName = personFullName;
    } else if (incident.primaryPersonName?.trim()) {
      personFullName = incident.primaryPersonName.trim();
      personShortName = personFullName;
    }

    const reviewer = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { firstName: true, lastName: true },
    });
    const display = await loadNotificationDisplay(this.prisma);
    const { title, message } = buildIncidentReviewFlagNotification({
      safeguardingConcern: Boolean(review.safeguardingConcern),
      escalationRequired: Boolean(review.escalationRequired),
      referenceNumber: incident.referenceNumber,
      categoryLabel: incident.category?.label,
      severity: incident.severity,
      occurredAtLabel: formatNotificationDateTime(incident.occurredAt, display),
      personShortName,
      personFullName,
      reviewerName:
        [reviewer?.firstName, reviewer?.lastName].filter(Boolean).join(' ').trim() || null,
    });
    await this.notifications.notifyUsers({
      recipientUserIds: recipients,
      type: NotificationType.INCIDENT_REPORTED,
      title,
      message,
      module: NotificationModule.SERVICE_CARE,
      severity: NotificationSeverity.ERROR,
      recordType: 'Incident',
      recordId: incidentId,
      createdById: actorId,
    });
  }

  // ---------------------------------------------------------------------------
  // Staff actions (Outcome & close): warning, fine, dismissal… per staff member
  // ---------------------------------------------------------------------------

  /** Decided after the investigation, at Outcome & close (same window as continuing a suspension). */
  private async loadForStaffAction(user: RequestUser, id: string) {
    if (!this.can(user, 'incidents.investigate') && !this.can(user, 'incidents.close')) {
      throw new ForbiddenException('You do not have permission to record staff actions');
    }
    const incident = await this.loadForEdit(user, id);
    if (
      incident.status !== IncidentStatus.ACTIONS_REQUIRED &&
      incident.status !== IncidentStatus.AWAITING_CLOSURE
    ) {
      throw new BadRequestException(
        'Staff actions are decided after the review or investigation, at Outcome & close',
      );
    }
    return incident;
  }

  /** A fine is a salary deduction: the same permission as adding one on the Salary tab. */
  private assertCanFine(user: RequestUser) {
    if (!this.can(user, 'billing.payroll_runs.manage') && !this.can(user, 'employees.update')) {
      throw new ForbiddenException('You do not have permission to add a fine to a salary');
    }
  }

  private async currentSalaryMonth(): Promise<string> {
    const tz = await this.orgSettings.getOperationalTimezone();
    return dayKeyInTimeZone(new Date(), tz).slice(0, 7);
  }

  async createStaffAction(
    user: RequestUser,
    id: string,
    dto: CreateIncidentStaffActionDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForStaffAction(user, id);
    await this.assertEmployeeExists(dto.employeeId);
    await this.orgScope.assertEmployeeInScope(
      this.orgScope.fromRequestUser(user),
      dto.employeeId,
    );
    const existing = await this.prisma.incidentStaffAction.findFirst({
      where: { incidentId: id, employeeId: dto.employeeId, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'A staff action is already recorded for this person — change it instead',
      );
    }
    const isFine = dto.actionType === 'FINE';
    if (isFine) this.assertCanFine(user);
    const problems = staffActionProblems(dto, await this.currentSalaryMonth());
    if (problems.length) {
      throw new BadRequestException(`To record a fine, add: ${problems.join(', ')}`);
    }
    const reason = dto.reason.trim();
    const amount = isFine ? Math.round(Number(dto.fineAmount) * 100) / 100 : null;
    const month = isFine ? dto.fineSalaryMonth!.trim() : null;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.incidentStaffAction.create({
        data: {
          incidentId: id,
          employeeId: dto.employeeId,
          actionType: dto.actionType,
          reason,
          staffInformedOn: dto.staffInformedOn ? this.parseDateOnly(dto.staffInformedOn) : null,
          fineAmount: amount,
          fineSalaryMonth: month,
          deductionAllowedConfirmed: isFine && dto.deductionAllowedConfirmed === true,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      if (!isFine) return created;
      const deduction = await tx.employeeSalaryDeduction.create({
        data: {
          employeeId: dto.employeeId,
          type: 'FINE',
          amount: amount!,
          reason: `${incident.referenceNumber}: ${reason}`.slice(0, 500),
          notes: 'Fine decided on the incident (Outcome & close → Staff actions)',
          salaryMonth: month!,
          incidentId: id,
          incidentStaffActionId: created.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      return tx.incidentStaffAction.update({
        where: { id: created.id },
        data: { salaryDeductionId: deduction.id },
      });
    });

    const name = (await this.employeeNames([dto.employeeId]))[dto.employeeId] ?? 'Staff member';
    await this.logStaffActionChange(
      user.id,
      id,
      `Staff action: ${name} — ${this.describeStaffAction(row)} — ${reason}`,
      undefined,
      this.staffActionAuditValues(row),
      meta,
    );
    return { message: 'Staff action recorded', data: this.mapStaffAction(row) };
  }

  async updateStaffAction(
    user: RequestUser,
    id: string,
    staffActionId: string,
    dto: UpdateIncidentStaffActionDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForStaffAction(user, id);
    const existing = await this.prisma.incidentStaffAction.findFirst({
      where: { id: staffActionId, incidentId: id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Staff action not found');
    const changeReason = dto.changeReason.trim();
    if (!changeReason) throw new BadRequestException('Say why the decision changed');

    const actionType = dto.actionType ?? existing.actionType;
    const isFine = actionType === 'FINE';
    const wasFine = existing.actionType === 'FINE';
    const next = {
      actionType,
      reason: dto.reason !== undefined ? dto.reason.trim() : existing.reason,
      staffInformedOn:
        dto.staffInformedOn !== undefined
          ? dto.staffInformedOn
            ? this.parseDateOnly(dto.staffInformedOn)
            : null
          : existing.staffInformedOn,
      fineAmount: isFine
        ? dto.fineAmount !== undefined
          ? dto.fineAmount
          : existing.fineAmount === null
            ? null
            : Number(existing.fineAmount)
        : null,
      fineSalaryMonth: isFine
        ? dto.fineSalaryMonth !== undefined
          ? dto.fineSalaryMonth?.trim() || null
          : existing.fineSalaryMonth
        : null,
      deductionAllowedConfirmed: isFine
        ? (dto.deductionAllowedConfirmed ?? existing.deductionAllowedConfirmed)
        : false,
    };
    if (isFine || wasFine) this.assertCanFine(user);
    if (isFine) {
      const fineChanged =
        !wasFine ||
        Number(existing.fineAmount) !== Number(next.fineAmount) ||
        existing.fineSalaryMonth !== next.fineSalaryMonth;
      // An unchanged fine may stay in a month that has since passed.
      if (fineChanged) {
        const problems = staffActionProblems(next, await this.currentSalaryMonth());
        if (problems.length) {
          throw new BadRequestException(`To record a fine, add: ${problems.join(', ')}`);
        }
      }
    }
    const amount = isFine ? Math.round(Number(next.fineAmount) * 100) / 100 : null;
    const incidentRef = (
      await this.prisma.incident.findUnique({ where: { id }, select: { referenceNumber: true } })
    )?.referenceNumber;

    const row = await this.prisma.$transaction(async (tx) => {
      let salaryDeductionId = existing.salaryDeductionId;
      const deductionData = {
        amount: amount!,
        reason: `${incidentRef}: ${next.reason}`.slice(0, 500),
        salaryMonth: next.fineSalaryMonth!,
        updatedById: user.id,
      };
      if (isFine && salaryDeductionId) {
        await tx.employeeSalaryDeduction.update({
          where: { id: salaryDeductionId },
          data: deductionData,
        });
      } else if (isFine) {
        const created = await tx.employeeSalaryDeduction.create({
          data: {
            ...deductionData,
            employeeId: existing.employeeId,
            type: 'FINE',
            notes: 'Fine decided on the incident (Outcome & close → Staff actions)',
            incidentId: id,
            incidentStaffActionId: existing.id,
            createdById: user.id,
          },
        });
        salaryDeductionId = created.id;
      } else if (salaryDeductionId) {
        // No longer a fine: take it off the salary.
        await tx.employeeSalaryDeduction.update({
          where: { id: salaryDeductionId },
          data: { deletedAt: new Date(), isActive: false, updatedById: user.id },
        });
        salaryDeductionId = null;
      }
      return tx.incidentStaffAction.update({
        where: { id: existing.id },
        data: {
          ...next,
          fineAmount: amount,
          salaryDeductionId,
          updatedById: user.id,
        },
      });
    });

    const name =
      (await this.employeeNames([existing.employeeId]))[existing.employeeId] ?? 'Staff member';
    await this.logStaffActionChange(
      user.id,
      id,
      `Staff action changed: ${name} — ${this.describeStaffAction(existing)} → ${this.describeStaffAction(row)} — ${changeReason}`,
      this.staffActionAuditValues(existing),
      this.staffActionAuditValues(row),
      meta,
    );
    return { message: 'Staff action updated', data: this.mapStaffAction(row) };
  }

  async removeStaffAction(
    user: RequestUser,
    id: string,
    staffActionId: string,
    dto: { reason: string },
    meta?: RequestAuditMeta,
  ) {
    await this.loadForStaffAction(user, id);
    const existing = await this.prisma.incidentStaffAction.findFirst({
      where: { id: staffActionId, incidentId: id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Staff action not found');
    if (existing.salaryDeductionId) this.assertCanFine(user);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Say why the staff action is removed');
    await this.prisma.$transaction(async (tx) => {
      if (existing.salaryDeductionId) {
        await tx.employeeSalaryDeduction.update({
          where: { id: existing.salaryDeductionId },
          data: { deletedAt: new Date(), isActive: false, updatedById: user.id },
        });
      }
      await tx.incidentStaffAction.update({
        where: { id: existing.id },
        data: {
          deletedAt: new Date(),
          deletedById: user.id,
          deleteReason: reason,
          updatedById: user.id,
        },
      });
    });
    const name =
      (await this.employeeNames([existing.employeeId]))[existing.employeeId] ?? 'Staff member';
    await this.logStaffActionChange(
      user.id,
      id,
      `Staff action removed: ${name} — ${this.describeStaffAction(existing)} — ${reason}`,
      this.staffActionAuditValues(existing),
      undefined,
      meta,
    );
    return { message: 'Staff action removed', data: { id: existing.id } };
  }

  private describeStaffAction(row: {
    actionType: string;
    fineAmount: Prisma.Decimal | number | null;
    fineSalaryMonth: string | null;
  }): string {
    const label = staffActionLabel(row.actionType);
    if (row.actionType !== 'FINE' || row.fineAmount === null || !row.fineSalaryMonth) return label;
    return `${label} (${fineSummary(Number(row.fineAmount), row.fineSalaryMonth)})`;
  }

  private staffActionAuditValues(row: import('@prisma/client').IncidentStaffAction) {
    return {
      employeeId: row.employeeId,
      actionType: row.actionType,
      reason: row.reason,
      staffInformedOn: dateOnlyKey(row.staffInformedOn),
      fineAmount: row.fineAmount === null ? null : Number(row.fineAmount),
      fineSalaryMonth: row.fineSalaryMonth,
      deductionAllowedConfirmed: row.deductionAllowedConfirmed,
      salaryDeductionId: row.salaryDeductionId,
    };
  }

  private mapStaffAction(row: import('@prisma/client').IncidentStaffAction) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      actionType: row.actionType,
      actionLabel: staffActionLabel(row.actionType),
      reason: row.reason,
      staffInformedOn: dateOnlyKey(row.staffInformedOn),
      fineAmount: row.fineAmount === null ? null : Number(row.fineAmount),
      fineSalaryMonth: row.fineSalaryMonth,
      deductionAllowedConfirmed: row.deductionAllowedConfirmed,
      salaryDeductionId: row.salaryDeductionId,
      createdAt: row.createdAt.toISOString(),
      createdById: row.createdById,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async logStaffActionChange(
    userId: string,
    incidentId: string,
    description: string,
    oldValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
    meta?: RequestAuditMeta,
  ) {
    await this.audit.logAudit({
      userId,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentStaffActionChange',
      recordId: incidentId,
      description,
      oldValues,
      newValues,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  // ---------------------------------------------------------------------------
  // Corrective actions
  // ---------------------------------------------------------------------------

  async listActions(user: RequestUser, incidentId: string) {
    await this.loadForManage(user, incidentId);
    const actions = await this.prisma.incidentAction.findMany({
      where: { incidentId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    return { data: actions.map((a) => this.mapAction(a)) };
  }

  async createAction(
    user: RequestUser,
    incidentId: string,
    dto: CreateIncidentActionDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForEdit(user, incidentId);
    if (!dto.measureType) {
      throw new BadRequestException('Choose the type of corrective measure');
    }
    if (dto.assignedEmployeeId) {
      await this.assertEmployeeExists(dto.assignedEmployeeId);
    }
    const newRecordNeeded = canNeedNewRecord(dto.measureType) && dto.newRecordNeeded === true;
    // "New one needed" replaces the link to an existing record.
    let linkedRecords = newRecordNeeded ? [] : sanitizeLinkedItems(dto.linkedRecords);
    // Course measures are checked by their own carer + course fields below.
    const missing = missingMeasureFields({
      measureType: dto.measureType,
      assignedEmployeeId: dto.assignedEmployeeId ?? null,
      dueDate: dto.dueDate ?? null,
      linkedRecords,
      newRecordNeeded,
      description: dto.description ?? null,
    });
    if (missing.length) {
      throw new BadRequestException(`To add this measure, add: ${missing.join(', ')}`);
    }
    let courseRecommendationId: string | null = null;
    // "Course for carer": the measure creates the learning assignment; its links are carer + course.
    if (dto.measureType === 'COURSE') {
      if (!dto.courseEmployeeId || !dto.courseId) {
        throw new BadRequestException('Select the carer and the course');
      }
      const { recommendation, courseTitle } = await this.createCourseRecommendation(
        user,
        incident,
        {
          employeeId: dto.courseEmployeeId,
          courseId: dto.courseId,
          dueAt: dto.dueDate ?? null,
          reason: dto.description?.trim() || null,
        },
        meta,
      );
      courseRecommendationId = recommendation.id;
      const carerName =
        (await this.employeeNames([dto.courseEmployeeId]))[dto.courseEmployeeId] ?? 'Carer';
      linkedRecords = [
        { id: dto.courseEmployeeId, label: carerName },
        { id: dto.courseId, label: courseTitle },
      ];
    }
    const action = await this.prisma.incidentAction.create({
      data: {
        incidentId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        priority: dto.priority ?? IncidentActionPriority.MEDIUM,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assignedEmployeeId: dto.assignedEmployeeId ?? null,
        isMandatory: dto.isMandatory ?? false,
        measureType: dto.measureType ?? null,
        linkedRecords: linkedRecords.length ? linkedRecords : Prisma.JsonNull,
        addresses: [...new Set(dto.addresses ?? [])],
        courseRecommendationId,
        newRecordNeeded,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentAction',
      recordId: action.id,
      description: `Action created: ${action.title}`,
      newValues: auditSnapshot(action),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Action created', data: this.mapAction(action) };
  }

  async updateAction(
    user: RequestUser,
    actionId: string,
    dto: UpdateIncidentActionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadActionForManage(user, actionId);
    if (dto.assignedEmployeeId) {
      await this.assertEmployeeExists(dto.assignedEmployeeId);
    }
    // Mandatory measures gate High/Critical closure, so dropping one must be justified —
    // otherwise cancelling it would silently bypass the audited closure override.
    const cancellingMandatory =
      existing.isMandatory &&
      dto.status === IncidentActionStatus.CANCELLED &&
      existing.status !== IncidentActionStatus.CANCELLED;
    const unmarkingMandatory = existing.isMandatory && dto.isMandatory === false;
    const reason = dto.reason?.trim();
    if ((cancellingMandatory || unmarkingMandatory) && !reason) {
      throw new BadRequestException(
        cancellingMandatory
          ? 'A reason is required to cancel a mandatory measure'
          : 'A reason is required to make a mandatory measure optional',
      );
    }
    // Typed measures must stay SMART after an edit (who, by when, what it changes).
    const nextNewRecordNeeded =
      dto.newRecordNeeded !== undefined
        ? canNeedNewRecord(existing.measureType) && dto.newRecordNeeded
        : existing.newRecordNeeded;
    const nextLinks =
      existing.measureType === 'COURSE'
        ? sanitizeLinkedItems(existing.linkedRecords)
        : nextNewRecordNeeded
          ? []
          : dto.linkedRecords !== undefined
            ? sanitizeLinkedItems(dto.linkedRecords)
            : sanitizeLinkedItems(existing.linkedRecords);
    const missingAfterEdit = missingMeasureFields({
      measureType: existing.measureType,
      assignedEmployeeId:
        dto.assignedEmployeeId !== undefined ? dto.assignedEmployeeId || null : existing.assignedEmployeeId,
      dueDate: dto.dueDate !== undefined ? dto.dueDate || null : existing.dueDate,
      linkedRecords: nextLinks,
      newRecordNeeded: nextNewRecordNeeded,
      description: dto.description !== undefined ? dto.description : existing.description,
    });
    if (missingAfterEdit.length) {
      throw new BadRequestException(`This measure needs: ${missingAfterEdit.join(', ')}`);
    }
    const action = await this.prisma.incidentAction.update({
      where: { id: actionId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
          : {}),
        ...(dto.assignedEmployeeId !== undefined
          ? { assignedEmployeeId: dto.assignedEmployeeId || null }
          : {}),
        ...(dto.isMandatory !== undefined
          ? { isMandatory: dto.isMandatory }
          : {}),
        // A course measure's links are its carer + course; they change only by a new measure.
        ...(existing.measureType !== 'COURSE' &&
        (dto.linkedRecords !== undefined || dto.newRecordNeeded !== undefined)
          ? {
              linkedRecords: nextLinks.length ? nextLinks : Prisma.JsonNull,
              newRecordNeeded: nextNewRecordNeeded,
            }
          : {}),
        ...(dto.addresses !== undefined ? { addresses: [...new Set(dto.addresses)] } : {}),
        ...(cancellingMandatory ? { completionNotes: `Cancelled: ${reason}` } : {}),
        updatedById: user.id,
      },
    });
    if (
      dto.status === IncidentActionStatus.CANCELLED &&
      existing.status !== IncidentActionStatus.CANCELLED &&
      existing.courseRecommendationId
    ) {
      await this.cancelCourseRecommendation(user.id, existing.courseRecommendationId, meta);
    }
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentAction',
      recordId: actionId,
      ...(cancellingMandatory || unmarkingMandatory
        ? {
            description: `${cancellingMandatory ? 'Mandatory measure cancelled' : 'Mandatory measure made optional'}: ${existing.title} — ${reason}`,
          }
        : {}),
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(action),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Action updated', data: this.mapAction(action) };
  }

  async completeAction(
    user: RequestUser,
    actionId: string,
    dto: CompleteIncidentActionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadActionForComplete(user, actionId);
    const completionNotes = dto.completionNotes.trim();
    if (!completionNotes) {
      throw new BadRequestException('Say how the measure was completed');
    }
    // Record-changing measures name the record that was actually updated or added. A care plan
    // update is proven by a published version (chosen from the ones that qualify).
    const carePlanVersion =
      existing.measureType === 'CARE_PLAN_UPDATE'
        ? await this.resolveCarePlanEvidence(existing, dto.carePlanVersionId)
        : null;
    const completedRecords = carePlanVersion
      ? [{ id: carePlanVersion.instanceId, label: carePlanVersion.label }]
      : sanitizeLinkedItems(dto.completedRecords);
    if (needsCompletedRecord(existing.measureType) && !completedRecords.length) {
      throw new BadRequestException(
        'Choose the record that was updated or added to complete this measure',
      );
    }
    const action = await this.prisma.$transaction(async (tx) => {
      if (carePlanVersion) {
        await tx.serviceUserCarePlanPublishedVersion.update({
          where: { id: carePlanVersion.id },
          data: { incidentActionId: actionId },
        });
      }
      return tx.incidentAction.update({
        where: { id: actionId },
        data: {
          status: IncidentActionStatus.COMPLETED,
          completionNotes,
          completedRecords: completedRecords.length ? completedRecords : Prisma.JsonNull,
          completedById: user.id,
          completedAt: new Date(),
          updatedById: user.id,
        },
      });
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentAction',
      recordId: actionId,
      description: `Action completed: ${existing.title}`,
      oldValues: { status: existing.status },
      newValues: {
        status: action.status,
        completionNotes: action.completionNotes,
        completedRecords,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Action completed', data: this.mapAction(action) };
  }

  /**
   * Remove a measure added by mistake (soft delete, reason required). Completed measures stay —
   * they are the record of what was done. A course measure's learning assignment is cancelled.
   */
  async removeAction(
    user: RequestUser,
    actionId: string,
    dto: RemoveIncidentActionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.loadActionForManage(user, actionId);
    if (existing.status === IncidentActionStatus.COMPLETED) {
      throw new BadRequestException('A completed measure can’t be removed');
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for removing the measure');
    await this.prisma.incidentAction.update({
      where: { id: actionId },
      data: { deletedAt: new Date(), updatedById: user.id },
    });
    if (existing.courseRecommendationId && existing.status !== IncidentActionStatus.CANCELLED) {
      await this.cancelCourseRecommendation(user.id, existing.courseRecommendationId, meta);
    }
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentActionChange',
      recordId: existing.incident.id,
      description: `Corrective measure removed: ${existing.title} — ${reason}`,
      oldValues: auditSnapshot(existing),
      newValues: { deletedAt: new Date().toISOString(), reason },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Measure removed', data: { id: actionId } };
  }

  /** Actions assigned to the current user's employee record ("My Actions"). */
  async listMyActions(user: RequestUser, openOnly = true) {
    if (!user.employeeId) return { data: [] };
    const actions = await this.prisma.incidentAction.findMany({
      where: {
        assignedEmployeeId: user.employeeId,
        deletedAt: null,
        ...(openOnly
          ? {
              status: {
                notIn: [
                  IncidentActionStatus.COMPLETED,
                  IncidentActionStatus.CANCELLED,
                ],
              },
            }
          : {}),
      },
      include: {
        incident: { select: { referenceNumber: true, privacyLevel: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    // Respect confidentiality: hide actions whose incident is above the user's clearance.
    const allowed = this.allowedPrivacyLevels(user);
    return {
      data: actions
        .filter((a) => allowed.includes(a.incident.privacyLevel))
        .map((a) => ({
          ...this.mapAction(a),
          incidentReference: a.incident.referenceNumber,
        })),
    };
  }

  private async assertClosable(
    incidentId: string,
    severity: IncidentSeverity,
    dto: ChangeIncidentStatusDto,
    user: RequestUser,
  ): Promise<void> {
    if (
      severity !== IncidentSeverity.HIGH &&
      severity !== IncidentSeverity.CRITICAL
    ) {
      return;
    }
    const outstanding = await this.prisma.incidentAction.count({
      where: {
        incidentId,
        deletedAt: null,
        isMandatory: true,
        status: {
          notIn: [
            IncidentActionStatus.COMPLETED,
            IncidentActionStatus.CANCELLED,
          ],
        },
      },
    });
    if (outstanding === 0) return;
    if (!dto.overrideMandatoryActions) {
      throw new BadRequestException(
        `This ${severity} incident has ${outstanding} incomplete mandatory action(s). Complete them or override with a reason to close.`,
      );
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException(
        'A reason is required to override incomplete mandatory actions',
      );
    }
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'Incident',
      recordId: incidentId,
      description: `Closure override — ${outstanding} mandatory action(s) incomplete`,
      newValues: { overrideReason: dto.reason },
    });
  }

  /**
   * An external body (police, LA safeguarding…) can still be running when the incident closes,
   * but only with an audited reason.
   */
  private async assertExternalBodiesClosable(
    incidentId: string,
    dto: ChangeIncidentStatusDto,
    user: RequestUser,
  ): Promise<void> {
    const open = await this.prisma.incidentExternalBody.findMany({
      where: {
        incidentId,
        deletedAt: null,
        status: { in: [...OPEN_EXTERNAL_BODY_STATUSES] },
      },
      select: { bodyType: true, organisationName: true, status: true },
    });
    if (open.length === 0) return;
    const names = open.map((b) => externalBodyName(b)).join(', ');
    if (!dto.overrideOpenExternalBodies) {
      throw new BadRequestException(
        `${open.length} external bod${open.length === 1 ? 'y is' : 'ies are'} still open (${names}). Close with a reason to continue.`,
      );
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('A reason is required to close while an external body is still open');
    }
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentExternalBodyChange',
      recordId: incidentId,
      description: `Closed with external bodies still open: ${names} — ${dto.reason.trim()}`,
      newValues: { overrideReason: dto.reason.trim(), openBodies: names },
    });
  }

  /**
   * Duty of Candour at close: an undecided or "not known yet" person always blocks; a Yes that
   * isn't complete needs a manager's reason (kept on the timeline).
   */
  private async assertCandourClosable(
    incidentId: string,
    dto: ChangeIncidentStatusDto,
    user: RequestUser,
  ): Promise<void> {
    const { blocking, incomplete } = await this.candour.closeCheck(incidentId);
    if (blocking.length) {
      throw new BadRequestException(
        `Decide Duty of Candour for ${blocking.join(', ')} before closing (Review tab)`,
      );
    }
    if (!incomplete.length) return;
    if (!dto.overrideIncompleteCandour) {
      throw new BadRequestException(
        `Duty of Candour isn't complete for ${incomplete.join(', ')}. Complete it, or close with a reason.`,
      );
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('A reason is required to close while Duty of Candour is incomplete');
    }
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentCandourChange',
      recordId: incidentId,
      description: `Closed with Duty of Candour incomplete for ${incomplete.join(', ')} — ${dto.reason.trim()}`,
      newValues: { overrideReason: dto.reason.trim(), people: incomplete },
    });
  }

  private async loadActionForManage(user: RequestUser, actionId: string) {
    const action = await this.prisma.incidentAction.findFirst({
      where: { id: actionId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true, status: true } } },
    });
    if (!action || !this.canViewIncident(user, action.incident)) {
      throw new NotFoundException('Action not found');
    }
    assertIncidentEditable(action.incident);
    await this.orgScope.assertIncidentInScope(
      this.orgScope.fromRequestUser(user),
      action.incident.id,
    );
    return action;
  }

  /** Completion is allowed for managers OR the assigned employee themselves. */
  /**
   * "Care plan update" measure: the plans it is about (to open them) and the published versions
   * that can complete it (see incident-care-plan-measure.util).
   */
  async carePlanEvidenceForAction(user: RequestUser, actionId: string) {
    const action = await this.loadActionForComplete(user, actionId);
    if (action.measureType !== 'CARE_PLAN_UPDATE') {
      throw new BadRequestException('This measure is not a care plan update');
    }
    const { incident, candidates } = await this.carePlanCandidates(action);
    const plans = await this.prisma.serviceUserCarePlanInstance.findMany({
      where: {
        serviceUserId: { in: incidentServiceUserIds(incident) },
        ...(action.newRecordNeeded ? {} : { id: { in: this.linkedInstanceIds(action) } }),
      },
      select: {
        id: true,
        serviceUserId: true,
        carePathwayFormId: true,
        carePathwayForm: { select: { name: true } },
      },
    });
    const userIds = [...new Set(candidates.map((v) => v.publishedById).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const userName = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null]),
    );
    return {
      data: {
        newRecordNeeded: action.newRecordNeeded,
        measureCreatedAt: action.createdAt.toISOString(),
        serviceUserIds: incidentServiceUserIds(incident),
        plans: action.newRecordNeeded
          ? []
          : plans.map((p) => ({
              instanceId: p.id,
              serviceUserId: p.serviceUserId,
              carePathwayFormId: p.carePathwayFormId,
              formName: p.carePathwayForm.name,
            })),
        versions: candidates.map((v) => ({
          id: v.id,
          instanceId: v.instanceId,
          serviceUserId: v.instance.serviceUserId,
          carePathwayFormId: v.instance.carePathwayFormId,
          formName: v.instance.carePathwayForm.name,
          versionNumber: v.versionNumber,
          summary: v.summary,
          publishedAt: v.publishedAt.toISOString(),
          publishedByName: v.publishedById ? (userName.get(v.publishedById) ?? null) : null,
          linkedToThisMeasure: v.incidentActionId === action.id,
        })),
      },
    };
  }

  private linkedInstanceIds(action: { linkedRecords: Prisma.JsonValue }): string[] {
    return sanitizeLinkedItems(action.linkedRecords).map((r) => r.id);
  }

  /** Published versions that qualify as evidence for this care plan measure, newest first. */
  private async carePlanCandidates(action: {
    id: string;
    incidentId: string;
    createdAt: Date;
    newRecordNeeded: boolean;
    linkedRecords: Prisma.JsonValue;
  }) {
    const incident = await this.prisma.incident.findUniqueOrThrow({
      where: { id: action.incidentId },
      select: { primaryServiceUserId: true, involvedServiceUserIds: true },
    });
    const suIds = incidentServiceUserIds(incident);
    const measure = {
      id: action.id,
      createdAt: action.createdAt,
      newRecordNeeded: action.newRecordNeeded,
      linkedInstanceIds: this.linkedInstanceIds(action),
    };
    const rows = suIds.length
      ? await this.prisma.serviceUserCarePlanPublishedVersion.findMany({
          where: {
            instance: { serviceUserId: { in: suIds } },
            publishedAt: { gt: action.createdAt },
            ...(action.newRecordNeeded ? {} : { instanceId: { in: measure.linkedInstanceIds } }),
          },
          include: {
            instance: {
              select: {
                serviceUserId: true,
                carePathwayFormId: true,
                createdAt: true,
                carePathwayForm: { select: { name: true } },
              },
            },
          },
          orderBy: { publishedAt: 'desc' },
        })
      : [];
    const candidates = rows.filter((v) =>
      versionCompletesCarePlanMeasure(
        measure,
        {
          instanceId: v.instanceId,
          instanceServiceUserId: v.instance.serviceUserId,
          instanceCreatedAt: v.instance.createdAt,
          publishedAt: v.publishedAt,
          incidentActionId: v.incidentActionId,
        },
        suIds,
      ),
    );
    return { incident, candidates };
  }

  private async resolveCarePlanEvidence(
    action: {
      id: string;
      incidentId: string;
      createdAt: Date;
      newRecordNeeded: boolean;
      linkedRecords: Prisma.JsonValue;
    },
    versionId: string | undefined,
  ) {
    if (!versionId) {
      throw new BadRequestException(
        'Choose the published care plan version that made this change (publish the care plan first)',
      );
    }
    const { candidates } = await this.carePlanCandidates(action);
    const version = candidates.find((v) => v.id === versionId);
    if (!version) {
      const used = await this.prisma.serviceUserCarePlanPublishedVersion.findFirst({
        where: { id: versionId, incidentActionId: { not: null } },
        select: { incidentActionId: true },
      });
      if (used && used.incidentActionId !== action.id) {
        throw new BadRequestException('That version is already the evidence for another measure');
      }
      throw new BadRequestException(
        action.newRecordNeeded
          ? 'That version does not complete this measure: it must be a care plan created after the measure was added'
          : 'That version does not complete this measure: it must be the named care plan, published after the measure was added',
      );
    }
    return {
      id: version.id,
      instanceId: version.instanceId,
      label: `${version.instance.carePathwayForm.name} — version ${version.versionNumber}`,
    };
  }

  private async loadActionForComplete(user: RequestUser, actionId: string) {
    const action = await this.prisma.incidentAction.findFirst({
      where: { id: actionId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true, status: true } } },
    });
    if (!action || !this.canViewIncident(user, action.incident)) {
      throw new NotFoundException('Action not found');
    }
    assertIncidentEditable(action.incident);
    await this.orgScope.assertIncidentInScope(
      this.orgScope.fromRequestUser(user),
      action.incident.id,
    );
    const isAssignee =
      user.employeeId != null && action.assignedEmployeeId === user.employeeId;
    if (!this.can(user, 'incidents.manage_actions') && !isAssignee) {
      throw new ForbiddenException('You cannot complete this action');
    }
    return action;
  }

  private async assertEmployeeExists(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!emp) throw new BadRequestException('Assigned employee does not exist');
  }

  private mapAction(action: import('@prisma/client').IncidentAction) {
    return {
      id: action.id,
      incidentId: action.incidentId,
      title: action.title,
      description: action.description,
      priority: action.priority,
      status: action.status,
      displayStatus: effectiveActionStatus(action),
      isOverdue: isActionOverdue(action),
      isMandatory: action.isMandatory,
      dueDate: action.dueDate ? action.dueDate.toISOString() : null,
      assignedEmployeeId: action.assignedEmployeeId,
      completionNotes: action.completionNotes,
      completedById: action.completedById,
      completedAt: action.completedAt ? action.completedAt.toISOString() : null,
      createdAt: action.createdAt.toISOString(),
      updatedAt: action.updatedAt.toISOString(),
      measureType: action.measureType,
      linkedRecords: sanitizeLinkedItems(action.linkedRecords),
      addresses: action.addresses ?? [],
      courseRecommendationId: action.courseRecommendationId,
      newRecordNeeded: action.newRecordNeeded,
      completedRecords: sanitizeLinkedItems(action.completedRecords),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private can(user: RequestUser, permission: string): boolean {
    if (user.roles?.includes(SUPER_ADMIN_ROLE)) return true;
    return (user.permissions ?? []).includes(permission);
  }

  /** Load an incident for a management action, enforcing privacy access. */
  private async loadForManage(
    user: RequestUser,
    id: string,
  ): Promise<IncidentWithRefs> {
    await this.orgScope.assertIncidentInScope(this.orgScope.fromRequestUser(user), id);
    const incident = await this.prisma.incident.findFirst({
      where: { id, deletedAt: null },
      include: { category: true, subtype: true },
    });
    if (!incident || !this.canViewIncident(user, incident)) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  /** loadForManage for record changes: closed incidents are read-only until reopened / re-investigated. */
  private async loadForEdit(user: RequestUser, id: string): Promise<IncidentWithRefs> {
    const incident = await this.loadForManage(user, id);
    assertIncidentEditable(incident);
    return incident;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  /**
   * Managers who may actually open this incident: active account, confidentiality clearance and
   * branch scope — resolved with the same rules as their login session.
   */
  private async notifiableManagerIds(
    incident: { id: string; privacyLevel: IncidentPrivacyLevel },
    excludeUserId: string | null,
  ): Promise<string[]> {
    const candidates = (await this.managerUserIds()).filter((uid) => uid !== excludeUserId);
    const allowed: string[] = [];
    for (const uid of candidates) {
      const ctx = await this.users.getAuthContext(uid);
      if (!ctx) continue;
      const asUser: RequestUser = {
        id: ctx.id,
        email: ctx.email,
        roles: ctx.roles,
        permissions: ctx.permissions,
        accountKind: ctx.accountKind,
        assignedLocationIds: ctx.assignedLocationIds,
      };
      if (!this.canViewIncident(asUser, incident)) continue;
      try {
        await this.orgScope.assertIncidentInScope(this.orgScope.fromRequestUser(asUser), incident.id);
      } catch {
        continue;
      }
      allowed.push(uid);
    }
    return allowed;
  }

  private async managerUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        name: { in: ['Admin', 'Manager', 'Care Coordinator'] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!roles.length) return [];
    const links = await this.prisma.userRole.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { userId: true },
    });
    return [...new Set(links.map((l) => l.userId))];
  }

  /** `reporterId` is a platform User id, or null for carer-app reports (no User row). */
  private async notifyManagersOfNewIncident(
    incident: IncidentWithRefs,
    reporterId: string | null,
  ): Promise<void> {
    const recipients = await this.notifiableManagerIds(incident, reporterId);
    if (!recipients.length) return;
    const severityToNotify: Record<IncidentSeverity, NotificationSeverity> = {
      LOW: NotificationSeverity.INFO,
      MEDIUM: NotificationSeverity.WARNING,
      HIGH: NotificationSeverity.ERROR,
      CRITICAL: NotificationSeverity.CRITICAL,
    };
    await this.notifications.notifyUsers({
      recipientUserIds: recipients,
      type: NotificationType.INCIDENT_REPORTED,
      title: `${incident.category.label} reported — ${incident.referenceNumber}`,
      // Confidential details stay inside the permission-checked incident record.
      message:
        incident.privacyLevel === IncidentPrivacyLevel.NORMAL
          ? incident.description.slice(0, 240) || 'A new incident has been reported.'
          : 'A confidential incident has been reported. Open it to view the details.',
      module: NotificationModule.SERVICE_CARE,
      severity: severityToNotify[incident.severity],
      recordType: 'Incident',
      recordId: incident.id,
      metadata: {
        referenceNumber: incident.referenceNumber,
        severity: incident.severity,
        categoryKey: incident.category.key,
      },
      createdById: reporterId ?? undefined,
    });
  }

  /**
   * Resolve a carer-app category to register ids. Accepts a category id, a category key
   * (`ACCIDENT`, `near miss`) or an API-18 `incidentType` label (`Fall/slip`); unknown → `OTHER`.
   * Matching happens in memory so a non-UUID value can't fail the database query.
   */
  private async resolveCarerAppCategory(
    categoryRef?: string | null,
    subtypeRef?: string | null,
    incidentTypeLabel?: string | null,
  ): Promise<{
    categoryId: string;
    subtypeId: string | null;
    categoryKey: string;
    subtypeKey: string | null;
  }> {
    const categories = await this.prisma.incidentCategory.findMany({
      where: { deletedAt: null, isActive: true },
      include: { subtypes: { where: { deletedAt: null, isActive: true } } },
    });
    const asKey = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const byRef = (ref?: string | null) => {
      const v = ref?.trim();
      if (!v) return undefined;
      return categories.find((c) => c.id === v) ?? categories.find((c) => c.key === asKey(v));
    };
    const label = incidentTypeLabel?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
    const mapped = CARER_APP_INCIDENT_TYPES[label];
    const category =
      byRef(categoryRef) ??
      (mapped ? categories.find((c) => c.key === mapped.category) : undefined) ??
      byRef(incidentTypeLabel) ??
      categories.find((c) => c.key === 'OTHER');
    if (!category) {
      throw new BadRequestException('No active incident categories are configured');
    }
    const sub = subtypeRef?.trim();
    const subtype =
      (sub ? category.subtypes.find((s) => s.id === sub || s.key === asKey(sub)) : undefined) ??
      (mapped?.subtype && mapped.category === category.key
        ? category.subtypes.find((s) => s.key === mapped.subtype)
        : undefined);
    return {
      categoryId: category.id,
      subtypeId: subtype?.id ?? null,
      categoryKey: category.key,
      subtypeKey: subtype?.key ?? null,
    };
  }

  private mapIncident(incident: IncidentWithRefs) {
    return {
      id: incident.id,
      referenceNumber: incident.referenceNumber,
      status: incident.status,
      statusLabel: INCIDENT_STATUS_LABELS[incident.status],
      severity: incident.severity,
      severityLabel: INCIDENT_SEVERITY_LABELS[incident.severity],
      privacyLevel: incident.privacyLevel,
      shareWithHandover: incident.shareWithHandover,
      category: {
        id: incident.category.id,
        key: incident.category.key,
        label: incident.category.label,
      },
      subtype: incident.subtype
        ? {
            id: incident.subtype.id,
            key: incident.subtype.key,
            label: incident.subtype.label,
          }
        : null,
      occurredAt: incident.occurredAt.toISOString(),
      reportedAt: incident.reportedAt.toISOString(),
      locationId: incident.locationId,
      specificArea: incident.specificArea,
      locationKey: incident.locationKey,
      locationDetail: incident.locationDetail,
      primaryServiceUserId: incident.primaryServiceUserId,
      primaryEmployeeId: incident.primaryEmployeeId,
      involvedServiceUserIds: incident.involvedServiceUserIds,
      involvedEmployeeIds: incident.involvedEmployeeIds,
      primaryPersonKind: incident.primaryPersonKind,
      primaryPersonName: incident.primaryPersonName,
      affectedPersonKinds: incident.affectedPersonKinds,
      scheduledJobId: incident.scheduledJobId,
      reportedById: incident.reportedById,
      reporterEmployeeId: incident.reporterEmployeeId,
      ownerId: incident.ownerId,
      description: incident.description,
      contextBefore: incident.contextBefore,
      contextAfter: incident.contextAfter,
      immediateActions: incident.immediateActions,
      immediateActionCodes: incident.immediateActionCodes,
      injuryOccurred: incident.injuryOccurred,
      injuryDetails: incident.injuryDetails,
      peopleInvolved: incident.peopleInvolved,
      witnessDetails: incident.witnessDetails,
      whoInformedKeys: incident.whoInformedKeys,
      carerSafeguardingConcern: incident.carerSafeguardingConcern,
      followUpRequired: incident.followUpRequired,
      emergencyServicesDetails: incident.emergencyServicesDetails,
      familyInformed: incident.familyInformed,
      carerNotes: incident.carerNotes,
      isArchived: incident.isArchived,
      closedAt: incident.closedAt ? incident.closedAt.toISOString() : null,
      closedById: incident.closedById,
      createdById: incident.createdById,
      reviewStartedAt: incident.reviewStartedAt?.toISOString() ?? null,
      reopenCount: incident.reopenCount,
      lastReopenedAt: incident.lastReopenedAt?.toISOString() ?? null,
      ambulanceAttended: incident.ambulanceAttended,
      takenToAe: incident.takenToAe,
      admittedToHospital: incident.admittedToHospital,
      categoryDetails:
        (incident.categoryDetails as Record<string, unknown> | null) ?? null,
      createdAt: incident.createdAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
    };
  }

  private buildTimeline(
    incident: Prisma.IncidentGetPayload<{
      include: {
        statusHistory: true;
        severityHistory: true;
        review: true;
        reviewCycles: true;
        investigation: true;
        outcome: true;
        actions: true;
        corrections: true;
        clarifications: true;
      };
    }>,
    reporterName: string | null = null,
  ) {
    const events: Array<{
      at: string;
      kind: string;
      detail: string;
      byId: string | null;
    }> = [];
    events.push({
      at: incident.reportedAt.toISOString(),
      kind: 'REPORTED',
      detail: `Incident ${incident.referenceNumber} reported${
        reporterName ? ` by ${reporterName}` : ''
      }${incident.createdById ? '' : ' via the carer app'}`,
      // The actor is whoever keyed it into the system; carer-app reports have none.
      byId: incident.createdById,
    });
    for (const s of incident.statusHistory) {
      if (!s.fromStatus) continue; // initial REPORTED already represented above
      events.push({
        at: s.createdAt.toISOString(),
        kind: 'STATUS',
        detail: `${INCIDENT_STATUS_LABELS[s.fromStatus]} → ${INCIDENT_STATUS_LABELS[s.toStatus]}${s.reason ? ` (${s.reason})` : ''}`,
        byId: s.changedById,
      });
    }
    for (const s of incident.severityHistory) {
      if (!s.fromSeverity) continue;
      events.push({
        at: s.createdAt.toISOString(),
        kind: 'SEVERITY',
        detail:
          s.fromSeverity === s.toSeverity
            ? `Severity confirmed: ${INCIDENT_SEVERITY_LABELS[s.toSeverity]}${s.reason && s.reason !== 'Confirmed at review' ? ` (${s.reason})` : ' at review'}`
            : `Severity ${INCIDENT_SEVERITY_LABELS[s.fromSeverity]} → ${INCIDENT_SEVERITY_LABELS[s.toSeverity]}${s.reason ? ` (${s.reason})` : ''}`,
        byId: s.changedById,
      });
    }
    // Workflow records keep only their latest state, so these show when each was last saved.
    const { review, investigation, outcome } = incident;
    for (const c of incident.reviewCycles) {
      if (!c.reviewedAt) continue;
      events.push({
        at: c.reviewedAt.toISOString(),
        kind: 'REVIEW',
        detail: `Manager review saved (review ${c.cycleNumber})`,
        byId: c.reviewedById,
      });
    }
    if (review) {
      // When the review was first saved; later changes after the decision have their own events.
      events.push({
        at: (review.reviewedAt ?? review.createdAt).toISOString(),
        kind: 'REVIEW',
        detail:
          review.cycleNumber > 1 ? `Manager review saved (review ${review.cycleNumber})` : 'Manager review saved',
        byId: review.reviewedById ?? review.createdById,
      });
    }
    if (investigation) {
      events.push({
        at: investigation.createdAt.toISOString(),
        kind: 'INVESTIGATION',
        detail: 'Investigation started',
        byId: investigation.createdById,
      });
      if (investigation.completedAt) {
        events.push({
          at: investigation.completedAt.toISOString(),
          kind: 'INVESTIGATION',
          detail: 'Investigation completed',
          byId: investigation.updatedById,
        });
      }
    }
    for (const a of incident.actions) {
      events.push({
        at: a.createdAt.toISOString(),
        kind: 'ACTION',
        detail: `Corrective measure added${
          a.measureType
            ? ` (${INCIDENT_MEASURE_TYPE_LABELS[a.measureType as IncidentMeasureType] ?? a.measureType})`
            : ''
        }: ${a.title}${a.isMandatory ? ' (mandatory)' : ''}`,
        byId: a.createdById,
      });
      if (a.status === IncidentActionStatus.COMPLETED && a.completedAt) {
        events.push({
          at: a.completedAt.toISOString(),
          kind: 'ACTION',
          detail: `Corrective measure completed: ${a.title}${(() => {
            const done = sanitizeLinkedItems(a.completedRecords);
            return done.length ? ` (${done.map((i) => i.label).join(', ')})` : '';
          })()}`,
          byId: a.completedById,
        });
      } else if (a.status === IncidentActionStatus.CANCELLED) {
        events.push({
          at: a.updatedAt.toISOString(),
          kind: 'ACTION',
          detail: `Corrective measure cancelled: ${a.title}${a.completionNotes ? ` (${a.completionNotes.replace(/^Cancelled:\s*/, '')})` : ''}`,
          byId: a.updatedById,
        });
      }
    }
    if (outcome) {
      events.push({
        at: outcome.createdAt.toISOString(),
        kind: 'OUTCOME',
        detail: 'Closure outcome recorded',
        byId: outcome.createdById,
      });
    }
    // One event per correction save (fields corrected together share a reason).
    const batches = new Map<string, typeof incident.corrections>();
    for (const c of incident.corrections) {
      batches.set(c.batchId, [...(batches.get(c.batchId) ?? []), c]);
    }
    for (const rows of batches.values()) {
      const first = rows[0];
      events.push({
        at: first.createdAt.toISOString(),
        kind: 'CORRECTION',
        detail: `Corrected ${rows
          .map(
            (r) =>
              `${CORRECTION_FIELD_LABELS[r.fieldKey as CorrectableFieldKey] ?? r.fieldKey}: ${r.fromLabel ?? '—'} → ${r.toLabel ?? '—'}`,
          )
          .join('; ')} (${first.reason})`,
        byId: first.correctedById,
      });
    }
    for (const n of incident.clarifications) {
      events.push({
        at: n.createdAt.toISOString(),
        kind: 'CLARIFICATION',
        detail: `Clarification added to ${CLARIFICATION_FIELD_LABELS[n.field] ?? n.field}`,
        byId: n.createdById,
      });
    }
    return events.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** Readable visit reference (VIS-…) for incidents raised during a visit. */
  private async withVisitRef<T extends { scheduledJobId: string | null }>(
    items: T[],
  ): Promise<Array<T & { visitRef: string | null }>> {
    const refByJobId = await loadVisitRefsByScheduledJobIds(
      this.prisma,
      items
        .map((i) => i.scheduledJobId)
        .filter((id): id is string => Boolean(id)),
    );
    return items.map((item) => ({
      ...item,
      visitRef: item.scheduledJobId
        ? (refByJobId.get(item.scheduledJobId) ?? null)
        : null,
    }));
  }

  /** Readable names for list rows / exports: the primary service user and the branch. */
  private async withPlaceAndPersonNames<
    T extends { primaryServiceUserId: string | null; locationId: string | null },
  >(items: T[]): Promise<Array<T & { serviceUserName: string | null; locationName: string | null }>> {
    const suIds = [...new Set(items.map((i) => i.primaryServiceUserId).filter((id): id is string => Boolean(id)))];
    const locIds = [...new Set(items.map((i) => i.locationId).filter((id): id is string => Boolean(id)))];
    const [sus, locs] = await Promise.all([
      suIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: suIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
      locIds.length
        ? this.prisma.location.findMany({
            where: { id: { in: locIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const suName = new Map(
      sus.map((s) => [s.id, [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || null]),
    );
    const locName = new Map(locs.map((l) => [l.id, l.name]));
    return items.map((item) => ({
      ...item,
      serviceUserName: item.primaryServiceUserId ? (suName.get(item.primaryServiceUserId) ?? null) : null,
      locationName: item.locationId ? (locName.get(item.locationId) ?? null) : null,
    }));
  }

  /**
   * Who reported (the carer, `reporterEmployeeId`) and who recorded it (the office user,
   * `createdById`; null for carer-app reports).
   */
  private async withReportedBy<
    T extends {
      createdById: string | null;
      reporterEmployeeId: string | null;
    },
  >(
    items: T[],
  ): Promise<
    Array<
      T & {
        reportedBy: {
          name: string | null;
          source: 'OFFICE' | 'CARER_APP' | null;
          roles: string[];
          recordedByName: string | null;
        };
      }
    >
  > {
    // Incidents are always reported by a carer (reporterEmployeeId). When the office keys it in,
    // the logged-in creator (createdById) is who recorded it — never the legacy reportedById.
    const userIds = [
      ...new Set(
        items
          .map((i) => i.createdById)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const employeeIds = [
      ...new Set(
        items
          .map((i) => i.reporterEmployeeId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [users, employees] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              userRoles: { select: { role: { select: { name: true } } } },
            },
          })
        : [],
      employeeIds.length
        ? this.prisma.employeePersonalDetail.findMany({
            where: { employeeId: { in: employeeIds } },
            select: { employeeId: true, firstName: true, lastName: true },
          })
        : [],
    ]);
    const userById = new Map(
      users.map((u) => [
        u.id,
        {
          name:
            [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
            u.email,
          roles: u.userRoles.map((ur) => ur.role.name).sort(),
        },
      ]),
    );
    const employeeNameById = new Map(
      employees.map((e) => [
        e.employeeId,
        [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || null,
      ]),
    );
    return items.map((item) => {
      const office = item.createdById
        ? userById.get(item.createdById)
        : undefined;
      const carerName = item.reporterEmployeeId
        ? (employeeNameById.get(item.reporterEmployeeId) ?? null)
        : null;
      return {
        ...item,
        reportedBy: {
          // Older office rows may have no carer — fall back to the office user.
          name: carerName ?? office?.name ?? null,
          source: item.createdById
            ? ('OFFICE' as const)
            : item.reporterEmployeeId
              ? ('CARER_APP' as const)
              : null,
          roles: office?.roles ?? [],
          recordedByName: office?.name ?? null,
        },
      };
    });
  }

  private async enrichTimelineWithActors(
    events: Array<{
      at: string;
      kind: string;
      detail: string;
      byId: string | null;
    }>,
  ) {
    const ids = [
      ...new Set(events.map((e) => e.byId).filter((id): id is string => Boolean(id))),
    ];
    if (ids.length === 0) {
      return events.map((e) => ({ ...e, byName: null as string | null }));
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const nameById = new Map(
      users.map((u) => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        return [u.id, name || u.email] as const;
      }),
    );
    return events.map((e) => ({
      ...e,
      byName: e.byId ? (nameById.get(e.byId) ?? null) : null,
    }));
  }

  /** Display names for the affected people and location (ids only on the incident; no cross-schema FKs). */
  private async resolveAffectedRefs(incident: {
    primaryServiceUserId: string | null;
    primaryEmployeeId: string | null;
    involvedServiceUserIds: string[];
    involvedEmployeeIds: string[];
    locationId: string | null;
  }) {
    const [serviceUser, employee, location, involvedSus, involvedEmps] = await Promise.all([
      incident.primaryServiceUserId
        ? this.prisma.serviceUser.findUnique({
            where: { id: incident.primaryServiceUserId },
            select: { id: true, firstName: true, lastName: true, serviceUserNumber: true },
          })
        : null,
      incident.primaryEmployeeId
        ? this.prisma.employee.findUnique({
            where: { id: incident.primaryEmployeeId },
            select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
          })
        : null,
      incident.locationId
        ? this.prisma.location.findUnique({
            where: { id: incident.locationId },
            select: { id: true, name: true },
          })
        : null,
      incident.involvedServiceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: incident.involvedServiceUserIds } },
            select: { id: true, firstName: true, lastName: true, serviceUserNumber: true },
          })
        : [],
      incident.involvedEmployeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: incident.involvedEmployeeIds } },
            select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
          })
        : [],
    ]);
    const fullName = (first?: string | null, last?: string | null) =>
      [first, last].filter(Boolean).join(' ').trim() || null;
    // Keep the order people were picked in (primary first).
    const suById = new Map(involvedSus.map((s) => [s.id, s]));
    const empById = new Map(involvedEmps.map((e) => [e.id, e]));
    return {
      primaryServiceUser: serviceUser
        ? {
            id: serviceUser.id,
            name: fullName(serviceUser.firstName, serviceUser.lastName),
            serviceUserNumber: serviceUser.serviceUserNumber,
          }
        : null,
      primaryEmployee: employee
        ? {
            id: employee.id,
            name: fullName(employee.personalDetail?.firstName, employee.personalDetail?.lastName),
          }
        : null,
      location: location ? { id: location.id, name: location.name } : null,
      involvedServiceUsers: incident.involvedServiceUserIds
        .map((id) => suById.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({
          id: s.id,
          name: fullName(s.firstName, s.lastName),
          serviceUserNumber: s.serviceUserNumber,
        })),
      involvedEmployees: incident.involvedEmployeeIds
        .map((id) => empById.get(id))
        .filter((e): e is NonNullable<typeof e> => Boolean(e))
        .map((e) => ({
          id: e.id,
          name: fullName(e.personalDetail?.firstName, e.personalDetail?.lastName),
        })),
    };
  }
}
