import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, promises as fsp } from 'fs';
import { join } from 'path';
import {
  IncidentPrivacyLevel,
  IncidentRelatedRecordStatus,
  IncidentStatus,
  Prisma,
  type IncidentAttachment,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  allowedPrivacyLevels,
  assertIncidentEditable,
  canViewIncidentPrivacy,
  hasIncidentPermission,
} from './incident-access.util';
import { andWhereFragment, OrgScopeService } from '../common/org-scope/org-scope.service';
import { operationalTodayIso } from '../common/utils/operational-day.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { INCIDENT_SEVERITY_LABELS, incidentOccurredAtRange } from './incident-workflow.util';
import {
  incidentAttachmentContentMatchesType,
  incidentAttachmentRoot,
} from './incident-attachment.config';
import {
  CreateIncidentAttachmentMetaDto,
  CreateIncidentInjuryDto,
  CreateIncidentWitnessDto,
  CreateRelatedCareRecordDto,
  LinkRelatedIncidentDto,
  UpdateRelatedCareRecordDto,
} from './dto/incident-care.dto';

const FALL_WINDOW_DAYS = 90;

@Injectable()
export class IncidentCareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  // --- shared access helpers -------------------------------------------------

  /** Same rule as opening the incident itself: privacy clearance and branch scope. */
  private async canAccessIncident(
    user: RequestUser,
    incident: { id: string; privacyLevel: IncidentPrivacyLevel },
  ): Promise<boolean> {
    if (!canViewIncidentPrivacy(user, incident)) return false;
    try {
      await this.orgScope.assertIncidentInScope(this.orgScope.fromRequestUser(user), incident.id);
      return true;
    } catch (err) {
      if (err instanceof NotFoundException) return false;
      throw err;
    }
  }

  private async loadIncident(user: RequestUser, incidentId: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId, deletedAt: null },
      select: {
        id: true,
        privacyLevel: true,
        referenceNumber: true,
        primaryServiceUserId: true,
        status: true,
      },
    });
    if (!incident || !(await this.canAccessIncident(user, incident))) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  /** loadIncident for record changes: closed incidents are read-only until reopened. */
  private async loadIncidentForEdit(user: RequestUser, incidentId: string) {
    const incident = await this.loadIncident(user, incidentId);
    assertIncidentEditable(incident);
    return incident;
  }

  private requirePermission(user: RequestUser, permission: string) {
    if (!hasIncidentPermission(user, permission)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  private async assertServiceUser(id?: string | null) {
    if (!id) return;
    const su = await this.prisma.serviceUser.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!su)
      throw new BadRequestException('Linked service user does not exist');
  }

  private async assertEmployee(id?: string | null) {
    if (!id) return;
    const emp = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!emp) throw new BadRequestException('Linked employee does not exist');
  }

  private logChange(
    user: RequestUser,
    recordType: string,
    recordId: string,
    description: string,
    values: unknown,
    meta?: RequestAuditMeta,
  ) {
    return this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType,
      recordId,
      description,
      newValues: auditSnapshot(values),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  // --- injuries --------------------------------------------------------------

  async listInjuries(user: RequestUser, incidentId: string) {
    await this.loadIncident(user, incidentId);
    const rows = await this.prisma.incidentInjury.findMany({
      where: { incidentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return { data: rows };
  }

  async addInjury(
    user: RequestUser,
    incidentId: string,
    dto: CreateIncidentInjuryDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadIncidentForEdit(user, incidentId);
    this.requirePermission(user, 'incidents.update');
    await this.assertServiceUser(dto.personServiceUserId);
    await this.assertEmployee(dto.personEmployeeId);
    const injury = await this.prisma.incidentInjury.create({
      data: {
        incidentId,
        personKind: dto.personKind,
        personServiceUserId: dto.personServiceUserId ?? null,
        personEmployeeId: dto.personEmployeeId ?? null,
        personName: dto.personName?.trim() || null,
        injurySeverity: dto.injurySeverity,
        injuryType: dto.injuryType.trim(),
        bodyRegion: dto.bodyRegion?.trim() || null,
        side: dto.side?.trim() || null,
        notes: dto.notes?.trim() || null,
        measurements: dto.measurements?.trim() || null,
        bodyMapRecordId: dto.bodyMapRecordId ?? null,
        createdById: user.id,
      },
    });
    // Recording an injury implies the incident involved injury.
    await this.prisma.incident.update({
      where: { id: incidentId },
      data: { injuryOccurred: true },
    });
    await this.logChange(
      user,
      'IncidentInjury',
      injury.id,
      `Injury recorded: ${injury.injuryType}`,
      injury,
      meta,
    );
    return { message: 'Injury recorded', data: injury };
  }

  async deleteInjury(
    user: RequestUser,
    injuryId: string,
    meta?: RequestAuditMeta,
  ) {
    const injury = await this.prisma.incidentInjury.findFirst({
      where: { id: injuryId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true, status: true } } },
    });
    if (!injury || !(await this.canAccessIncident(user, injury.incident))) {
      throw new NotFoundException('Injury not found');
    }
    assertIncidentEditable(injury.incident);
    this.requirePermission(user, 'incidents.update');
    await this.prisma.incidentInjury.update({
      where: { id: injuryId },
      data: { deletedAt: new Date() },
    });
    await this.logChange(
      user,
      'IncidentInjury',
      injuryId,
      'Injury removed',
      { id: injuryId },
      meta,
    );
    return { message: 'Injury removed', data: { id: injuryId } };
  }

  // --- witnesses -------------------------------------------------------------

  async listWitnesses(user: RequestUser, incidentId: string) {
    await this.loadIncident(user, incidentId);
    const rows = await this.prisma.incidentWitness.findMany({
      where: { incidentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return { data: rows };
  }

  async addWitness(
    user: RequestUser,
    incidentId: string,
    dto: CreateIncidentWitnessDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadIncidentForEdit(user, incidentId);
    this.requirePermission(user, 'incidents.update');
    await this.assertServiceUser(dto.personServiceUserId);
    await this.assertEmployee(dto.personEmployeeId);
    const witness = await this.prisma.incidentWitness.create({
      data: {
        incidentId,
        personKind: dto.personKind,
        personServiceUserId: dto.personServiceUserId ?? null,
        personEmployeeId: dto.personEmployeeId ?? null,
        personName: dto.personName?.trim() || null,
        statement: dto.statement?.trim() || null,
        statementDate: dto.statementDate ? new Date(dto.statementDate) : null,
        addedById: user.id,
      },
    });
    await this.logChange(
      user,
      'IncidentWitness',
      witness.id,
      'Witness added',
      witness,
      meta,
    );
    return { message: 'Witness added', data: witness };
  }

  async deleteWitness(
    user: RequestUser,
    witnessId: string,
    meta?: RequestAuditMeta,
  ) {
    const witness = await this.prisma.incidentWitness.findFirst({
      where: { id: witnessId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true, status: true } } },
    });
    if (!witness || !(await this.canAccessIncident(user, witness.incident))) {
      throw new NotFoundException('Witness not found');
    }
    assertIncidentEditable(witness.incident);
    this.requirePermission(user, 'incidents.update');
    await this.prisma.incidentWitness.update({
      where: { id: witnessId },
      data: { deletedAt: new Date() },
    });
    await this.logChange(
      user,
      'IncidentWitness',
      witnessId,
      'Witness removed',
      { id: witnessId },
      meta,
    );
    return { message: 'Witness removed', data: { id: witnessId } };
  }

  // --- related incidents -----------------------------------------------------

  async listRelatedIncidents(user: RequestUser, incidentId: string) {
    await this.loadIncident(user, incidentId);
    const summary = {
      select: {
        id: true,
        referenceNumber: true,
        privacyLevel: true,
        severity: true,
        status: true,
        occurredAt: true,
        category: { select: { label: true } },
      },
    } as const;
    // Links are a two-way relationship: show them from whichever incident is being viewed.
    const links = await this.prisma.incidentRelatedIncident.findMany({
      where: { OR: [{ incidentId }, { relatedIncidentId: incidentId }] },
      include: { incident: summary, relatedIncident: summary },
      orderBy: { createdAt: 'desc' },
    });
    const others = links.map((l) => (l.incidentId === incidentId ? l.relatedIncident : l.incident));
    const visibleIds = new Set(
      (
        await Promise.all(
          others.map(async (o) => ((await this.canAccessIncident(user, o)) ? o.id : null)),
        )
      ).filter(Boolean),
    );
    return {
      data: links.map((l, i) => {
        const other = others[i];
        // Above clearance or outside the user's branches: acknowledged but not detailed.
        const visible = visibleIds.has(other.id);
        return {
          linkId: l.id,
          note: l.note,
          relatedIncidentId: other.id,
          // Confidential related incidents are acknowledged but not detailed.
          referenceNumber: visible ? other.referenceNumber : 'Restricted',
          categoryLabel: visible ? other.category.label : null,
          severity: visible ? other.severity : null,
          status: visible ? other.status : null,
          occurredAt: visible ? other.occurredAt.toISOString() : null,
          restricted: !visible,
        };
      }),
    };
  }

  async linkRelatedIncident(
    user: RequestUser,
    incidentId: string,
    dto: LinkRelatedIncidentDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadIncidentForEdit(user, incidentId);
    this.requirePermission(user, 'incidents.update');
    if (dto.relatedIncidentId === incidentId) {
      throw new BadRequestException('An incident cannot be linked to itself');
    }
    // Must be able to view the target incident to link it.
    await this.loadIncident(user, dto.relatedIncidentId);
    const reverse = await this.prisma.incidentRelatedIncident.findFirst({
      where: { incidentId: dto.relatedIncidentId, relatedIncidentId: incidentId },
      select: { id: true },
    });
    if (reverse) {
      throw new BadRequestException('These incidents are already linked');
    }
    try {
      const link = await this.prisma.incidentRelatedIncident.create({
        data: {
          incidentId,
          relatedIncidentId: dto.relatedIncidentId,
          note: dto.note?.trim() || null,
          createdById: user.id,
        },
      });
      await this.logChange(
        user,
        'IncidentRelatedIncident',
        link.id,
        'Related incident linked',
        link,
        meta,
      );
      return { message: 'Related incident linked', data: { linkId: link.id } };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('These incidents are already linked');
      }
      throw err;
    }
  }

  async unlinkRelatedIncident(
    user: RequestUser,
    linkId: string,
    meta?: RequestAuditMeta,
  ) {
    const side = { select: { id: true, privacyLevel: true, status: true } } as const;
    const link = await this.prisma.incidentRelatedIncident.findUnique({
      where: { id: linkId },
      include: { incident: side, relatedIncident: side },
    });
    if (
      !link ||
      !(await this.canAccessIncident(user, link.incident)) ||
      !(await this.canAccessIncident(user, link.relatedIncident))
    ) {
      throw new NotFoundException('Link not found');
    }
    // Links can be removed from either incident; only blocked when both are closed (read-only).
    if (link.incident.status === IncidentStatus.CLOSED) {
      assertIncidentEditable(link.relatedIncident);
    }
    this.requirePermission(user, 'incidents.update');
    await this.prisma.incidentRelatedIncident.delete({ where: { id: linkId } });
    await this.logChange(
      user,
      'IncidentRelatedIncident',
      linkId,
      'Related incident unlinked',
      { id: linkId },
      meta,
    );
    return { message: 'Related incident unlinked', data: { id: linkId } };
  }

  // --- related care records --------------------------------------------------

  async listCareRecords(user: RequestUser, incidentId: string) {
    await this.loadIncident(user, incidentId);
    const rows = await this.prisma.incidentRelatedCareRecord.findMany({
      where: { incidentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return { data: rows };
  }

  async addCareRecord(
    user: RequestUser,
    incidentId: string,
    dto: CreateRelatedCareRecordDto,
    meta?: RequestAuditMeta,
  ) {
    await this.loadIncidentForEdit(user, incidentId);
    this.requirePermission(user, 'incidents.update');

    if (dto.externalId) {
      const duplicate = await this.prisma.incidentRelatedCareRecord.findFirst({
        where: {
          incidentId,
          externalId: dto.externalId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException(
          'This care record is already linked to this incident',
        );
      }
    }

    const record = await this.prisma.incidentRelatedCareRecord.create({
      data: {
        incidentId,
        recordType: dto.recordType,
        referenceLabel: dto.referenceLabel.trim(),
        externalId: dto.externalId ?? null,
        status: dto.status ?? IncidentRelatedRecordStatus.REVIEW_REQUIRED,
        note: dto.note?.trim() || null,
        createdById: user.id,
      },
    });
    await this.logChange(
      user,
      'IncidentRelatedCareRecord',
      record.id,
      `Care record linked: ${record.referenceLabel}`,
      record,
      meta,
    );
    return { message: 'Care record linked', data: record };
  }

  async updateCareRecord(
    user: RequestUser,
    recordId: string,
    dto: UpdateRelatedCareRecordDto,
    meta?: RequestAuditMeta,
  ) {
    const record = await this.prisma.incidentRelatedCareRecord.findFirst({
      where: { id: recordId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true, status: true } } },
    });
    if (!record || !(await this.canAccessIncident(user, record.incident))) {
      throw new NotFoundException('Care record link not found');
    }
    assertIncidentEditable(record.incident);
    this.requirePermission(user, 'incidents.update');
    const markingUpdated =
      dto.status === IncidentRelatedRecordStatus.UPDATED &&
      record.status !== IncidentRelatedRecordStatus.UPDATED;
    const updated = await this.prisma.incidentRelatedCareRecord.update({
      where: { id: recordId },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.updatedByLabel !== undefined
          ? { updatedByLabel: dto.updatedByLabel.trim() || null }
          : {}),
        ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
        ...(markingUpdated ? { resolvedAt: new Date() } : {}),
      },
    });
    await this.logChange(
      user,
      'IncidentRelatedCareRecord',
      recordId,
      'Care record link updated',
      updated,
      meta,
    );
    return { message: 'Care record updated', data: updated };
  }

  async deleteCareRecord(
    user: RequestUser,
    recordId: string,
    meta?: RequestAuditMeta,
  ) {
    const record = await this.prisma.incidentRelatedCareRecord.findFirst({
      where: { id: recordId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true, status: true } } },
    });
    if (!record || !(await this.canAccessIncident(user, record.incident))) {
      throw new NotFoundException('Care record link not found');
    }
    assertIncidentEditable(record.incident);
    this.requirePermission(user, 'incidents.update');
    await this.prisma.incidentRelatedCareRecord.update({
      where: { id: recordId },
      data: { deletedAt: new Date() },
    });
    await this.logChange(
      user,
      'IncidentRelatedCareRecord',
      recordId,
      'Care record link removed',
      { id: recordId },
      meta,
    );
    return { message: 'Care record link removed', data: { id: recordId } };
  }

  // --- attachments -----------------------------------------------------------

  async listAttachments(user: RequestUser, incidentId: string) {
    await this.loadIncident(user, incidentId);
    const rows = await this.prisma.incidentAttachment.findMany({
      where: { incidentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { data: rows.map((a) => this.mapAttachment(a)) };
  }

  async addAttachment(
    user: RequestUser,
    incidentId: string,
    file: Express.Multer.File | undefined,
    dto: CreateIncidentAttachmentMetaDto,
    meta?: RequestAuditMeta,
  ) {
    // Multer has already written the file to disk, so remove it whenever the upload is rejected.
    const discard = async () => {
      if (file) await fsp.unlink(file.path).catch(() => undefined);
    };
    try {
      await this.loadIncidentForEdit(user, incidentId);
      this.requirePermission(user, 'incidents.update');
    } catch (e) {
      await discard();
      throw e;
    }
    if (!file) {
      // Also reached when the upload filter rejected the file type (multer then passes no file).
      throw new BadRequestException(
        'Upload a JPEG, PNG, WebP, HEIC or PDF file',
      );
    }
    if (!(await incidentAttachmentContentMatchesType(file.path, file.mimetype))) {
      await discard();
      throw new BadRequestException(
        'The file content does not match its type (allowed: JPEG, PNG, WebP, HEIC, PDF)',
      );
    }
    const attachment = await this.prisma.incidentAttachment.create({
      data: {
        incidentId,
        category: dto.category ?? 'OTHER',
        fileName: file.filename,
        originalName: file.originalname,
        fileUrl: `incidents/attachments/${file.filename}`,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentAttachment',
      recordId: attachment.id,
      description: `Attachment uploaded: ${attachment.originalName}`,
      newValues: {
        originalName: attachment.originalName,
        category: attachment.category,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return {
      message: 'Attachment uploaded',
      data: this.mapAttachment(attachment),
    };
  }

  /** Permission-checked resolution of a stored file for streaming download. */
  async getAttachmentForDownload(user: RequestUser, attachmentId: string) {
    const attachment = await this.prisma.incidentAttachment.findFirst({
      where: { id: attachmentId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true } } },
    });
    if (!attachment || !(await this.canAccessIncident(user, attachment.incident))) {
      throw new NotFoundException('Attachment not found');
    }
    const absolutePath = join(incidentAttachmentRoot(), attachment.fileName);
    if (!existsSync(absolutePath)) {
      throw new NotFoundException('File is no longer available');
    }
    return {
      absolutePath,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
    };
  }

  async deleteAttachment(
    user: RequestUser,
    attachmentId: string,
    meta?: RequestAuditMeta,
  ) {
    const attachment = await this.prisma.incidentAttachment.findFirst({
      where: { id: attachmentId, deletedAt: null },
      include: { incident: { select: { id: true, privacyLevel: true, status: true } } },
    });
    if (!attachment || !(await this.canAccessIncident(user, attachment.incident))) {
      throw new NotFoundException('Attachment not found');
    }
    assertIncidentEditable(attachment.incident);
    this.requirePermission(user, 'incidents.update');
    await this.prisma.incidentAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });
    await this.logChange(
      user,
      'IncidentAttachment',
      attachmentId,
      'Attachment removed',
      { id: attachmentId },
      meta,
    );
    return { message: 'Attachment removed', data: { id: attachmentId } };
  }

  private mapAttachment(a: IncidentAttachment) {
    return {
      id: a.id,
      incidentId: a.incidentId,
      category: a.category,
      originalName: a.originalName,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      caption: a.caption,
      uploadedById: a.uploadedById,
      createdAt: a.createdAt.toISOString(),
      downloadUrl: `/incidents/attachments/${a.id}/download`,
    };
  }

  // --- service user incident history + trend indicators ----------------------

  async getServiceUserHistory(user: RequestUser, serviceUserId: string) {
    const allowed = allowedPrivacyLevels(user);
    const where: Prisma.IncidentWhereInput = {
      primaryServiceUserId: serviceUserId,
      deletedAt: null,
      isArchived: false,
      privacyLevel: { in: allowed },
    };
    andWhereFragment(where, await this.orgScope.incidentScopeWhere(this.orgScope.fromRequestUser(user)));
    const incidents = await this.prisma.incident.findMany({
      where,
      select: {
        id: true,
        referenceNumber: true,
        severity: true,
        status: true,
        occurredAt: true,
        category: { select: { key: true, label: true } },
        subtype: { select: { key: true, label: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });

    const now = Date.now();
    const windowStart = now - FALL_WINDOW_DAYS * 86_400_000;
    // "This month" follows the organisation calendar (not UTC), matching the dashboard.
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const monthStart = incidentOccurredAtRange(
      `${operationalTodayIso(new Date(), timeZone).slice(0, 8)}01`,
      undefined,
      timeZone,
    )!.gte!;

    const falls90 = incidents.filter(
      (i) => i.subtype?.key === 'FALL' && i.occurredAt.getTime() >= windowStart,
    ).length;
    const medicationThisMonth = incidents.filter(
      (i) =>
        i.category.key === 'MEDICATION' &&
        i.occurredAt.getTime() >= monthStart.getTime(),
    ).length;

    const trends: { level: 'info' | 'warning'; label: string }[] = [];
    if (falls90 >= 2) {
      trends.push({
        level: falls90 >= 3 ? 'warning' : 'info',
        label: `${falls90} falls recorded in the last ${FALL_WINDOW_DAYS} days`,
      });
    }
    if (medicationThisMonth >= 2) {
      trends.push({
        level: 'warning',
        label: `${medicationThisMonth} medication incidents this month`,
      });
    }

    return {
      data: {
        total: incidents.length,
        trends,
        incidents: incidents.map((i) => ({
          id: i.id,
          referenceNumber: i.referenceNumber,
          severity: i.severity,
          severityLabel: INCIDENT_SEVERITY_LABELS[i.severity],
          status: i.status,
          occurredAt: i.occurredAt.toISOString(),
          categoryLabel: i.category.label,
          subtypeLabel: i.subtype?.label ?? null,
        })),
      },
    };
  }
}
