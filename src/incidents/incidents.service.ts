import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IncidentActionPriority,
  BodyMapBodyView,
  BodyMapLinkedModule,
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
import { incidentAttachmentRoot } from './incident-attachment.config';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { andWhereFragment, OrgScopeService } from '../common/org-scope/org-scope.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto';
import {
  AssignIncidentOwnerDto,
  ChangeIncidentSeverityDto,
  ChangeIncidentStatusDto,
} from './dto/incident-workflow.dto';
import {
  UpsertIncidentInvestigationDto,
  UpsertIncidentReviewDto,
} from './dto/incident-review.dto';
import {
  CompleteIncidentActionDto,
  CreateIncidentActionDto,
  UpdateIncidentActionDto,
} from './dto/incident-action.dto';
import { UpsertIncidentOutcomeDto } from './dto/incident-outcome.dto';
import { SuspendIncidentCarerDto } from './dto/suspend-incident-carer.dto';
import { RecommendIncidentCarerCourseDto } from './dto/recommend-incident-carer-course.dto';
import { EmployeesService } from '../employees/employees.service';
import { LearningAssignmentsService } from '../learning/learning-assignments.service';
import { effectiveActionStatus, isActionOverdue } from './incident-action.util';
import {
  INCIDENT_PRIVACY_RANK,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  OPEN_INCIDENT_STATUSES,
  canTransitionIncidentStatus,
  isReinvestigateTransition,
  formatIncidentReference,
} from './incident-workflow.util';

const SUPER_ADMIN_ROLE = 'Super Admin';
const REFERENCE_MAX_RETRIES = 5;

type IncidentWithRefs = Prisma.IncidentGetPayload<{
  include: { category: true; subtype: true };
}>;

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

    await this.validateReferences(dto);

    const scope = this.orgScope.fromRequestUser(user);
    if (dto.locationId) {
      this.orgScope.assertLocationAccess(scope, dto.locationId);
    }
    if (dto.primaryServiceUserId) {
      await this.orgScope.assertServiceUserInScope(scope, dto.primaryServiceUserId);
    }
    if (dto.primaryEmployeeId) {
      await this.orgScope.assertEmployeeInScope(scope, dto.primaryEmployeeId);
    }

    const severity = dto.severity ?? IncidentSeverity.LOW;
    const privacyLevel = dto.privacyLevel ?? IncidentPrivacyLevel.NORMAL;
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
              reportedById: user.id,
              reporterEmployeeId:
                dto.reporterEmployeeId ?? user.employeeId ?? null,
              primaryServiceUserId: dto.primaryServiceUserId ?? null,
              primaryEmployeeId: dto.primaryEmployeeId ?? null,
              affectedPersonKinds: dto.affectedPersonKinds ?? [],
              primaryPersonKind:
                dto.primaryPersonKind ?? dto.affectedPersonKinds?.[0] ?? null,
              primaryPersonName: dto.primaryPersonName?.trim() || null,
              description: dto.description.trim(),
              contextBefore: dto.contextBefore?.trim() || null,
              contextAfter: dto.contextAfter?.trim() || null,
              immediateActions: dto.immediateActions?.trim() || null,
              immediateActionCodes: dto.immediateActionCodes ?? [],
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
  async createFromCarerApp(params: {
    userId: string;
    employeeId: string;
    scheduledJobId: string;
    categoryId: string;
    subtypeId?: string | null;
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
    /** Free-text witnesses captured in the carer app; mirrored as IncidentWitness rows. */
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
  }): Promise<IncidentWithRefs> {
    const category = await this.prisma.incidentCategory.findFirst({
      where: { id: params.categoryId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException('Invalid or inactive incident category');
    }

    const year = new Date().getUTCFullYear();
    let created: IncidentWithRefs | null = null;
    for (let attempt = 0; attempt < REFERENCE_MAX_RETRIES; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const referenceNumber = await this.allocateReference(tx, year);
          const incident = await tx.incident.create({
            data: {
              referenceNumber,
              categoryId: params.categoryId,
              subtypeId: params.subtypeId ?? null,
              status: IncidentStatus.REPORTED,
              severity: params.severity,
              privacyLevel: IncidentPrivacyLevel.NORMAL,
              shareWithHandover: false,
              occurredAt: params.occurredAt,
              scheduledJobId: params.scheduledJobId,
              specificArea: params.specificArea?.trim() || null,
              // The carer is an employee-app account, not a platform User, so we do
              // not set reportedById/createdById (User FK). reporterEmployeeId links
              // the actual reporter.
              reportedById: null,
              reporterEmployeeId: params.employeeId,
              primaryServiceUserId: params.primaryServiceUserId ?? null,
              primaryEmployeeId: params.primaryEmployeeId ?? null,
              affectedPersonKinds: params.affectedPersonKinds ?? [],
              primaryPersonKind: params.affectedPersonKinds?.[0] ?? null,
              primaryPersonName: params.primaryPersonName?.trim() || null,
              description: params.description.trim(),
              contextBefore: params.contextBefore?.trim() || null,
              contextAfter: params.contextAfter?.trim() || null,
              immediateActions: params.immediateActions?.trim() || null,
              injuryOccurred: params.injuryOccurred ?? false,
              injuryDetails: params.injuryDetails?.trim() || null,
              peopleInvolved: params.peopleInvolved?.trim() || null,
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

    void this.notifyManagersOfNewIncident(created, params.userId).catch((e) =>
      this.logger.warn(
        `Incident notification failed for ${created?.referenceNumber}: ${e}`,
      ),
    );

    // Mirror any body-map marks as real injuries + body-map records so they show
    // in the admin incident "Injuries" section. Non-fatal: the incident is
    // already created, so a failure here must not fail the carer submit.
    await this.mirrorCarerAppInjuries(created.id, params).catch((e) =>
      this.logger.warn(
        `Failed to mirror carer-app injuries for ${created?.referenceNumber}: ${e}`,
      ),
    );

    // Mirror free-text witnesses as IncidentWitness rows (admin "Witnesses"
    // section). Non-fatal, same rationale as injuries.
    await this.mirrorCarerAppWitnesses(created.id, params.witnesses).catch((e) =>
      this.logger.warn(
        `Failed to mirror carer-app witnesses for ${created?.referenceNumber}: ${e}`,
      ),
    );

    return created;
  }

  /**
   * Turn the carer app's free-text "witnesses" field into IncidentWitness rows.
   * Splits on newlines / semicolons / commas so "John Smith, Jane Doe" becomes
   * two witnesses; a single sentence becomes one row.
   */
  private async mirrorCarerAppWitnesses(
    incidentId: string,
    witnesses?: string | null,
  ): Promise<void> {
    const raw = witnesses?.trim();
    if (!raw) return;
    const names = raw
      .split(/[\n;,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const list = names.length > 0 ? names : [raw];
    for (const name of list) {
      try {
        await this.prisma.incidentWitness.create({
          data: {
            incidentId,
            personKind: IncidentPersonKind.OTHER,
            personName: name.slice(0, 255),
          },
        });
      } catch (e) {
        this.logger.warn(`Failed to mirror one carer-app witness: ${e}`);
      }
    }
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
    const ext = extname(input.originalName) || '.jpg';
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
      case IncidentSeverity.CRITICAL:
        return IncidentInjurySeverity.FATAL;
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

    if (dto.primaryServiceUserId) {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: dto.primaryServiceUserId, deletedAt: null },
        select: { id: true },
      });
      if (!su)
        throw new BadRequestException('Linked service user does not exist');
    }

    for (const employeeId of [
      dto.primaryEmployeeId,
      dto.reporterEmployeeId,
    ].filter(Boolean) as string[]) {
      const emp = await this.prisma.employee.findFirst({
        where: { id: employeeId, deletedAt: null },
        select: { id: true },
      });
      if (!emp) throw new BadRequestException('Linked employee does not exist');
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

    const where: Prisma.IncidentWhereInput = {
      deletedAt: null,
      ...this.privacyWhere(user),
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.privacyLevel ? { privacyLevel: query.privacyLevel } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.subtypeId ? { subtypeId: query.subtypeId } : {}),
      ...(query.serviceUserId
        ? { primaryServiceUserId: query.serviceUserId }
        : {}),
      ...(query.employeeId ? { primaryEmployeeId: query.employeeId } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.openOnly ? { status: { in: OPEN_INCIDENT_STATUSES } } : {}),
    };

    if (locationIds?.length) {
      const serviceUsers = await this.prisma.serviceUser.findMany({
        where: { deletedAt: null, locationId: { in: locationIds } },
        select: { id: true },
      });
      const suIds = serviceUsers.map((s) => s.id);
      andWhereFragment(where, {
        OR: [
          { locationId: { in: locationIds } },
          ...(suIds.length ? [{ primaryServiceUserId: { in: suIds } }] : []),
        ],
      });
    } else {
      andWhereFragment(where, await this.orgScope.incidentScopeWhere(scope));
    }

    if (query.dateFrom || query.dateTo) {
      where.occurredAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo
          ? { lte: new Date(`${query.dateTo.slice(0, 10)}T23:59:59.999Z`) }
          : {}),
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
        orderBy: [{ occurredAt: 'desc' }, { reportedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: {
        items: rows.map((r) => this.mapIncident(r)),
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
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
        _count: {
          select: {
            attachments: { where: { deletedAt: null } },
            relatedFrom: true,
          },
        },
      },
    });
    // 404 (not 403) for incidents above clearance so their existence is not revealed.
    if (!incident || !this.canViewIncident(user, incident)) {
      throw new NotFoundException('Incident not found');
    }
    return {
      data: {
        ...this.mapIncident(incident),
        history: await this.enrichTimelineWithActors(this.buildTimeline(incident)),
        review: incident.review ?? null,
        investigation: incident.investigation ?? null,
        outcome: incident.outcome ?? null,
        actions: incident.actions.map((a) => this.mapAction(a)),
        carerSuspensions: incident.carerSuspensions.map((s) =>
          this.mapCarerSuspension(s),
        ),
        courseRecommendations: await this.mapCourseRecommendations(
          incident.courseRecommendations,
        ),
        injuries: incident.injuries,
        witnesses: incident.witnesses,
        relatedCareRecords: incident.relatedCareRecords,
        attachmentCount: incident._count.attachments,
        relatedIncidentCount: incident._count.relatedFrom,
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
    if (!canTransitionIncidentStatus(incident.status, dto.status)) {
      throw new BadRequestException(
        `Cannot move incident from ${INCIDENT_STATUS_LABELS[incident.status]} to ${INCIDENT_STATUS_LABELS[dto.status]}`,
      );
    }
    const reinvestigate = isReinvestigateTransition(incident.status, dto.status);

    if (dto.status === IncidentStatus.REOPENED || reinvestigate) {
      if (!this.can(user, 'incidents.reopen')) {
        throw new ForbiddenException(
          reinvestigate
            ? 'You do not have permission to submit an incident for re-investigation'
            : 'You do not have permission to reopen incidents',
        );
      }
      if (!dto.reason?.trim()) {
        throw new BadRequestException(
          reinvestigate
            ? 'A reason is required to submit an incident for re-investigation'
            : 'A reason is required to reopen an incident',
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
      await this.assertClosable(id, incident.severity, dto, user);
      const outcome = await this.prisma.incidentOutcome.findUnique({
        where: { incidentId: id },
        select: { finalOutcome: true },
      });
      if (!outcome?.finalOutcome?.trim()) {
        throw new BadRequestException(
          'Record the closure outcome (final outcome) before closing this incident',
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
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.INCIDENT,
        action:
          dto.status === IncidentStatus.REOPENED || reinvestigate
            ? AuditAction.INCIDENT_REOPENED
            : dto.status === IncidentStatus.CLOSED
              ? AuditAction.INCIDENT_CLOSED
              : AuditAction.INCIDENT_STATUS_CHANGED,
        recordType: 'Incident',
        recordId: id,
        description: reinvestigate
          ? `Submitted for re-investigation: ${incident.status} → ${dto.status}`
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

  async changeSeverity(
    user: RequestUser,
    id: string,
    dto: ChangeIncidentSeverityDto,
    meta?: RequestAuditMeta,
  ) {
    const incident = await this.loadForManage(user, id);
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
    const incident = await this.loadForManage(user, id);
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
  // Manager review & investigation (upserted, one per incident)
  // ---------------------------------------------------------------------------

  async upsertReview(
    user: RequestUser,
    id: string,
    dto: UpsertIncidentReviewDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForManage(user, id);
    const existing = await this.prisma.incidentReview.findUnique({
      where: { incidentId: id },
    });
    const data = {
      confirmedSeverity: dto.confirmedSeverity ?? null,
      investigationRequired: dto.investigationRequired ?? null,
      safeguardingConcern: dto.safeguardingConcern ?? null,
      possibleAbuseOrNeglect: dto.possibleAbuseOrNeglect ?? null,
      furtherMedicalAttention: dto.furtherMedicalAttention ?? null,
      externalNotificationRequired: dto.externalNotificationRequired ?? null,
      escalationRequired: dto.escalationRequired ?? null,
      managementNotes: dto.managementNotes?.trim() || null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    };
    const review = await this.prisma.incidentReview.upsert({
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
      recordType: 'IncidentReview',
      recordId: id,
      description: 'Manager review saved',
      oldValues: existing ? auditSnapshot(existing) : undefined,
      newValues: auditSnapshot(review),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    // Escalation / safeguarding routing (internal notifications; never blocking).
    void this.notifyOnReviewFlags(id, review, user.id).catch((e) =>
      this.logger.warn(`Incident review notification failed for ${id}: ${e}`),
    );
    return { message: 'Manager review saved', data: review };
  }

  async upsertInvestigation(
    user: RequestUser,
    id: string,
    dto: UpsertIncidentInvestigationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadForManage(user, id);
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

    const data = {
      investigationScope: nextScope,
      externalType: nextExternalType,
      whatHappened: dto.whatHappened?.trim() || null,
      whyHappened: dto.whyHappened?.trim() || null,
      contributingFactors: dto.contributingFactors ?? [],
      rootCause: dto.rootCause?.trim() || null,
      preventable: dto.preventable ?? null,
      conclusion: dto.conclusion?.trim() || null,
      completedAt: dto.markComplete
        ? (existing?.completedAt ?? new Date())
        : (existing?.completedAt ?? null),
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
    return { message: 'Investigation saved', data: investigation };
  }

  /**
   * Suspend a carer as a post-investigation decision.
   * Deactivates the employee (unallocates future rota) and records the decision.
   * Multiple carers can be suspended on the same incident.
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
    const incident = await this.loadForManage(user, id);
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

    const existingRow = await this.prisma.incidentCarerSuspension.findFirst({
      where: { incidentId: id, employeeId },
    });
    if (existingRow && !existingRow.deletedAt) {
      throw new BadRequestException(
        'This carer has already been suspended for this incident',
      );
    }

    const reason = dto.reason.trim();
    const suspendFrom = this.parseDateOnly(dto.suspendFrom);
    const suspendTo = this.parseDateOnly(dto.suspendTo);
    if (suspendTo.getTime() < suspendFrom.getTime()) {
      throw new BadRequestException(
        'Suspension end date must be on or after the start date',
      );
    }

    await this.employees.update(
      user.id,
      employeeId,
      { isActive: false },
      meta,
    );

    const inactiveStatus = await this.prisma.employeeStatus.findFirst({
      where: { deletedAt: null, name: { equals: 'Inactive', mode: 'insensitive' } },
      select: { id: true },
    });
    if (inactiveStatus) {
      await this.employees.updateStatus(
        user.id,
        employeeId,
        { statusId: inactiveStatus.id },
        meta,
      );
    }

    // Ensure an investigation row exists so the workflow step has somewhere to hang.
    await this.prisma.incidentInvestigation.upsert({
      where: { incidentId: id },
      create: {
        incidentId: id,
        createdById: user.id,
        updatedById: user.id,
      },
      update: { updatedById: user.id },
    });

    const now = new Date();
    const suspension = existingRow
      ? await this.prisma.incidentCarerSuspension.update({
          where: { id: existingRow.id },
          data: {
            reason,
            suspendFrom,
            suspendTo,
            suspendedAt: now,
            deletedAt: null,
            updatedById: user.id,
          },
        })
      : await this.prisma.incidentCarerSuspension.create({
          data: {
            incidentId: id,
            employeeId,
            reason,
            suspendFrom,
            suspendTo,
            suspendedAt: now,
            createdById: user.id,
            updatedById: user.id,
          },
        });

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentCarerSuspension',
      recordId: suspension.id,
      description: `Carer suspended after investigation`,
      newValues: {
        employeeId,
        reason,
        suspendFrom: suspendFrom.toISOString().slice(0, 10),
        suspendTo: suspendTo.toISOString().slice(0, 10),
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: 'Carer suspended',
      data: this.mapCarerSuspension(suspension),
    };
  }

  /**
   * Remove a carer suspension from this incident and reactivate the employee
   * when they have no other active incident suspensions.
   */
  async removeCarerSuspension(
    user: RequestUser,
    id: string,
    suspensionId: string,
    meta?: RequestAuditMeta,
  ) {
    if (!this.can(user, 'incidents.investigate')) {
      throw new ForbiddenException(
        'You do not have permission to remove a carer suspension',
      );
    }
    await this.loadForManage(user, id);

    const suspension = await this.prisma.incidentCarerSuspension.findFirst({
      where: { id: suspensionId, incidentId: id, deletedAt: null },
    });
    if (!suspension) {
      throw new NotFoundException('Carer suspension not found');
    }

    await this.prisma.incidentCarerSuspension.update({
      where: { id: suspension.id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });

    const otherActive = await this.prisma.incidentCarerSuspension.count({
      where: {
        employeeId: suspension.employeeId,
        deletedAt: null,
        id: { not: suspension.id },
      },
    });

    if (otherActive === 0) {
      await this.employees.update(
        user.id,
        suspension.employeeId,
        { isActive: true },
        meta,
      );
      const activeStatus = await this.prisma.employeeStatus.findFirst({
        where: { deletedAt: null, name: { equals: 'Active', mode: 'insensitive' } },
        select: { id: true },
      });
      if (activeStatus) {
        await this.employees.updateStatus(
          user.id,
          suspension.employeeId,
          { statusId: activeStatus.id },
          meta,
        );
      }
    }

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentCarerSuspension',
      recordId: suspension.id,
      description: 'Carer suspension removed',
      oldValues: {
        employeeId: suspension.employeeId,
        suspendFrom: suspension.suspendFrom.toISOString().slice(0, 10),
        suspendTo: suspension.suspendTo.toISOString().slice(0, 10),
      },
      newValues: { deletedAt: new Date().toISOString() },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Carer suspension removed', data: { id: suspension.id } };
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
  ) {
    return {
      id: row.id,
      incidentId: row.incidentId,
      employeeId: row.employeeId,
      reason: row.reason,
      suspendFrom: row.suspendFrom.toISOString().slice(0, 10),
      suspendTo: row.suspendTo.toISOString().slice(0, 10),
      suspendedAt: row.suspendedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Recommend a learning course for a carer after investigation.
   * Creates a LearningAssignment (allows inactive carers) and records the recommendation.
   */
  async recommendCarerCourse(
    user: RequestUser,
    id: string,
    dto: RecommendIncidentCarerCourseDto,
    meta?: RequestAuditMeta,
  ) {
    if (!this.can(user, 'incidents.investigate')) {
      throw new ForbiddenException(
        'You do not have permission to recommend a course from an investigation',
      );
    }
    const incident = await this.loadForManage(user, id);
    const employeeId = dto.employeeId ?? incident.primaryEmployeeId;
    if (!employeeId) {
      throw new BadRequestException(
        'Select a carer to recommend a course to (no primary employee on this incident)',
      );
    }
    await this.assertEmployeeExists(employeeId);
    await this.orgScope.assertEmployeeInScope(
      this.orgScope.fromRequestUser(user),
      employeeId,
    );

    const existingRow = await this.prisma.incidentCarerCourseRecommendation.findFirst({
      where: { incidentId: id, employeeId, courseId: dto.courseId },
    });
    if (existingRow && !existingRow.deletedAt) {
      throw new BadRequestException(
        'This course has already been recommended to this carer for this incident',
      );
    }

    // Ensure an investigation row exists so the workflow step has somewhere to hang.
    await this.prisma.incidentInvestigation.upsert({
      where: { incidentId: id },
      create: {
        incidentId: id,
        createdById: user.id,
        updatedById: user.id,
      },
      update: { updatedById: user.id },
    });

    const reason = dto.reason?.trim() || null;
    const assignment = await this.learningAssignments.createFromSource(
      user.id,
      {
        employeeId,
        courseId: dto.courseId,
        dueAt: dto.dueAt ?? null,
        isMandatory: dto.isMandatory ?? true,
        assignmentReason:
          reason ??
          `Recommended after incident investigation (${incident.referenceNumber})`,
        sourceEntityType: 'Incident',
        sourceEntityId: id,
        allowInactiveEmployee: true,
      },
      meta,
    );

    const now = new Date();
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    const recommendation = existingRow
      ? await this.prisma.incidentCarerCourseRecommendation.update({
          where: { id: existingRow.id },
          data: {
            reason,
            dueAt,
            learningAssignmentId: assignment.id,
            recommendedAt: now,
            deletedAt: null,
            updatedById: user.id,
          },
        })
      : await this.prisma.incidentCarerCourseRecommendation.create({
          data: {
            incidentId: id,
            employeeId,
            courseId: dto.courseId,
            learningAssignmentId: assignment.id,
            reason,
            dueAt,
            recommendedAt: now,
            createdById: user.id,
            updatedById: user.id,
          },
        });

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentCarerCourseRecommendation',
      recordId: recommendation.id,
      description: 'Course recommended for carer after investigation',
      newValues: {
        employeeId,
        courseId: dto.courseId,
        learningAssignmentId: assignment.id,
        reason,
        dueAt: dueAt?.toISOString() ?? null,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    const [mapped] = await this.mapCourseRecommendations([recommendation]);
    return { message: 'Course recommended', data: mapped };
  }

  /**
   * Soft-delete a course recommendation and cancel its learning assignment when present.
   */
  async removeCarerCourseRecommendation(
    user: RequestUser,
    id: string,
    recommendationId: string,
    meta?: RequestAuditMeta,
  ) {
    if (!this.can(user, 'incidents.investigate')) {
      throw new ForbiddenException(
        'You do not have permission to remove a course recommendation',
      );
    }
    await this.loadForManage(user, id);

    const recommendation =
      await this.prisma.incidentCarerCourseRecommendation.findFirst({
        where: { id: recommendationId, incidentId: id, deletedAt: null },
      });
    if (!recommendation) {
      throw new NotFoundException('Course recommendation not found');
    }

    await this.prisma.incidentCarerCourseRecommendation.update({
      where: { id: recommendation.id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });

    if (recommendation.learningAssignmentId) {
      try {
        await this.learningAssignments.cancel(
          recommendation.learningAssignmentId,
          user.id,
          { cancellationReason: 'Removed from incident investigation recommendation' },
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

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentCarerCourseRecommendation',
      recordId: recommendation.id,
      description: 'Course recommendation removed',
      oldValues: {
        employeeId: recommendation.employeeId,
        courseId: recommendation.courseId,
        learningAssignmentId: recommendation.learningAssignmentId,
      },
      newValues: { deletedAt: new Date().toISOString() },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: 'Course recommendation removed',
      data: { id: recommendation.id },
    };
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
    await this.loadForManage(user, id);
    const existing = await this.prisma.incidentOutcome.findUnique({
      where: { incidentId: id },
    });
    const data = {
      finalOutcome: dto.finalOutcome?.trim() || null,
      lessonsLearned: dto.lessonsLearned?.trim() || null,
      preventability: dto.preventability ?? null,
      changesMade: dto.changesMade ?? [],
      informationSharedWithStaff: dto.informationSharedWithStaff ?? null,
      serviceUserInformed: dto.serviceUserInformed ?? null,
      nokInformed: dto.nokInformed ?? null,
      finalManagementComments: dto.finalManagementComments?.trim() || null,
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
    return { message: 'Outcome saved', data: outcome };
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
          awaitingReview: 0,
          underInvestigation: 0,
          actionsRequired: 0,
          highOrCritical: 0,
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
          ...(suIds.length ? [{ primaryServiceUserId: { in: suIds } }] : []),
        ],
      });
    } else {
      andWhereFragment(base, await this.orgScope.incidentScopeWhere(scope));
    }

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const [byStatus, bySeverity, open, closedThisMonth, total, overdueActions] =
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
            updatedAt: { gte: startOfMonth },
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
            incident: { is: base },
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
        awaitingReview: statusCounts[IncidentStatus.AWAITING_REVIEW] ?? 0,
        underInvestigation:
          statusCounts[IncidentStatus.UNDER_INVESTIGATION] ?? 0,
        actionsRequired: statusCounts[IncidentStatus.ACTIONS_REQUIRED] ?? 0,
        highOrCritical:
          (severityCounts[IncidentSeverity.HIGH] ?? 0) +
          (severityCounts[IncidentSeverity.CRITICAL] ?? 0),
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
    const recipients = (await this.managerUserIds()).filter(
      (uid) => uid !== actorId,
    );
    if (!recipients.length) return;
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: { referenceNumber: true },
    });
    const flag = review.safeguardingConcern
      ? 'Safeguarding concern'
      : 'Escalation required';
    await this.notifications.notifyUsers({
      recipientUserIds: recipients,
      type: NotificationType.INCIDENT_REPORTED,
      title: `${flag} — ${incident?.referenceNumber ?? 'incident'}`,
      message: `An incident review flagged: ${flag}. Please review.`,
      module: NotificationModule.SERVICE_CARE,
      severity: NotificationSeverity.ERROR,
      recordType: 'Incident',
      recordId: incidentId,
      createdById: actorId,
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
    await this.loadForManage(user, incidentId);
    if (dto.assignedEmployeeId) {
      await this.assertEmployeeExists(dto.assignedEmployeeId);
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
        updatedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentAction',
      recordId: actionId,
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
    const action = await this.prisma.incidentAction.update({
      where: { id: actionId },
      data: {
        status: IncidentActionStatus.COMPLETED,
        completionNotes: dto.completionNotes?.trim() || null,
        completedById: user.id,
        completedAt: new Date(),
        updatedById: user.id,
      },
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
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Action completed', data: this.mapAction(action) };
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

  private async loadActionForManage(user: RequestUser, actionId: string) {
    const action = await this.prisma.incidentAction.findFirst({
      where: { id: actionId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true } } },
    });
    if (!action || !this.canViewIncident(user, action.incident)) {
      throw new NotFoundException('Action not found');
    }
    await this.orgScope.assertIncidentInScope(
      this.orgScope.fromRequestUser(user),
      action.incident.id,
    );
    return action;
  }

  /** Completion is allowed for managers OR the assigned employee themselves. */
  private async loadActionForComplete(user: RequestUser, actionId: string) {
    const action = await this.prisma.incidentAction.findFirst({
      where: { id: actionId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true } } },
    });
    if (!action || !this.canViewIncident(user, action.incident)) {
      throw new NotFoundException('Action not found');
    }
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

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
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

  private async notifyManagersOfNewIncident(
    incident: IncidentWithRefs,
    reporterId: string,
  ): Promise<void> {
    const recipients = (await this.managerUserIds()).filter(
      (uid) => uid !== reporterId,
    );
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
      message:
        incident.description.slice(0, 240) ||
        'A new incident has been reported.',
      module: NotificationModule.SERVICE_CARE,
      severity: severityToNotify[incident.severity],
      recordType: 'Incident',
      recordId: incident.id,
      metadata: {
        referenceNumber: incident.referenceNumber,
        severity: incident.severity,
        categoryKey: incident.category.key,
      },
      createdById: reporterId,
    });
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
      primaryServiceUserId: incident.primaryServiceUserId,
      primaryEmployeeId: incident.primaryEmployeeId,
      primaryPersonKind: incident.primaryPersonKind,
      primaryPersonName: incident.primaryPersonName,
      affectedPersonKinds: incident.affectedPersonKinds,
      scheduledJobId: incident.scheduledJobId,
      reportedById: incident.reportedById,
      ownerId: incident.ownerId,
      description: incident.description,
      contextBefore: incident.contextBefore,
      contextAfter: incident.contextAfter,
      immediateActions: incident.immediateActions,
      immediateActionCodes: incident.immediateActionCodes,
      injuryOccurred: incident.injuryOccurred,
      injuryDetails: incident.injuryDetails,
      peopleInvolved: incident.peopleInvolved,
      whoInformedKeys: incident.whoInformedKeys,
      carerSafeguardingConcern: incident.carerSafeguardingConcern,
      followUpRequired: incident.followUpRequired,
      emergencyServicesDetails: incident.emergencyServicesDetails,
      familyInformed: incident.familyInformed,
      carerNotes: incident.carerNotes,
      isArchived: incident.isArchived,
      closedAt: incident.closedAt ? incident.closedAt.toISOString() : null,
      closedById: incident.closedById,
      createdAt: incident.createdAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
    };
  }

  private buildTimeline(
    incident: Prisma.IncidentGetPayload<{
      include: { statusHistory: true; severityHistory: true };
    }>,
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
      detail: `Incident ${incident.referenceNumber} reported`,
      byId: incident.reportedById,
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
        detail: `Severity ${INCIDENT_SEVERITY_LABELS[s.fromSeverity]} → ${INCIDENT_SEVERITY_LABELS[s.toSeverity]}${s.reason ? ` (${s.reason})` : ''}`,
        byId: s.changedById,
      });
    }
    return events.sort((a, b) => a.at.localeCompare(b.at));
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
}
