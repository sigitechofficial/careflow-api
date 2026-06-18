import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ComplianceVerificationAction,
  DataAccessType,
  EmployeeComplianceStatus,
  Prisma,
} from '@prisma/client';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmployeeComplianceDto } from './dto/create-employee-compliance.dto';
import { UpdateEmployeeComplianceDto } from './dto/update-employee-compliance.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { calculateComplianceStatus } from './compliance-status.calculator';
import {
  employmentDimsFromEmployment,
  pickBestRequirementsPerType,
  requirementMatchesEmployment,
} from './compliance-requirement.matcher';
import { CARE_COMPLIANCE_CODE_ORDER } from './care-compliance-catalog-order';

const complianceInclude = {
  complianceType: true,
  requirement: true,
  documents: { where: { deletedAt: null } },
} satisfies Prisma.EmployeeComplianceInclude;

type ComplianceRowFull = Prisma.EmployeeComplianceGetPayload<{ include: typeof complianceInclude }>;

@Injectable()
export class EmployeeComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * TODO: Wire `@nestjs/schedule` daily cron to call this (see README).
   * Recomputes persisted `status` for all active compliance rows (UTC expiry rules).
   */
  async runDailyComplianceCheck(): Promise<{ updated: number }> {
    const rows = await this.prisma.employeeCompliance.findMany({
      where: { deletedAt: null },
      include: complianceInclude,
    });
    let updated = 0;
    for (const row of rows) {
      const next = this.computePersistedStatus(row);
      if (next !== row.status) {
        await this.prisma.employeeCompliance.update({
          where: { id: row.id },
          data: { status: next },
        });
        updated++;
      }
    }
    return { updated };
  }

  private assertIssueBeforeExpiry(issueDate?: Date | null, expiryDate?: Date | null) {
    if (issueDate && expiryDate && expiryDate < issueDate) {
      throw new BadRequestException('expiryDate must be on or after issueDate');
    }
  }

  private computePersistedStatus(row: ComplianceRowFull): EmployeeComplianceStatus {
    const type = row.complianceType;
    const renewal = row.requirement?.renewalBeforeDays ?? 30;
    const hasDoc = (row.documents?.length ?? 0) > 0;
    return calculateComplianceStatus(
      {
        rejectedAt: row.rejectedAt,
        submittedAt: row.submittedAt,
        verifiedAt: row.verifiedAt,
        expiryDate: row.expiryDate,
        issueDate: row.issueDate,
        isNoLongerRequired: row.isNoLongerRequired,
        documentUrl: row.documentUrl,
      },
      type
        ? {
            hasExpiry: type.hasExpiry,
            requiresDocument: type.requiresDocument,
            requiresVerification: type.requiresVerification,
          }
        : null,
      renewal,
      hasDoc,
    );
  }

  private decorateRow(row: ComplianceRowFull) {
    const effectiveStatus = this.computePersistedStatus(row);
    return {
      ...row,
      status: effectiveStatus,
      persistedStatus: row.status,
    };
  }

  async getRequiredComplianceTypesForEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { employment: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (!employee.employment) return { data: [] as { complianceTypeId: string; requirementId: string | null }[] };

    const reqs = await this.prisma.complianceRequirement.findMany({
      where: { deletedAt: null, isActive: true, complianceType: { deletedAt: null, isActive: true } },
    });
    const dims = employmentDimsFromEmployment(employee.employment);
    const best = pickBestRequirementsPerType(reqs, dims);
    return {
      data: [...best.entries()].map(([complianceTypeId, r]) => ({
        complianceTypeId,
        requirementId: r.id,
      })),
    };
  }

  private async resolveRequirementId(
    employeeId: string,
    complianceTypeId: string,
    explicitRequirementId?: string,
  ): Promise<string | null> {
    if (explicitRequirementId) {
      const r = await this.prisma.complianceRequirement.findFirst({
        where: { id: explicitRequirementId, complianceTypeId, deletedAt: null },
      });
      if (!r) throw new BadRequestException('Invalid requirementId for this compliance type');
      return r.id;
    }
    const { data } = await this.getRequiredComplianceTypesForEmployee(employeeId);
    const hit = data.find((d) => d.complianceTypeId === complianceTypeId);
    return hit?.requirementId ?? null;
  }

  async list(employeeId: string, audit?: RequestAuditMeta & { actorUserId?: string }) {
    await this.ensureEmployee(employeeId);
    const items = await this.prisma.employeeCompliance.findMany({
      where: { employeeId, deletedAt: null },
      include: complianceInclude,
      orderBy: { createdAt: 'desc' },
    });
    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        recordType: 'EmployeeComplianceList',
        recordId: employeeId,
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { count: items.length },
      });
    }
    return { data: items.map((r) => this.decorateRow(r)) };
  }

  async getOne(employeeId: string, complianceId: string, audit?: RequestAuditMeta & { actorUserId?: string }) {
    await this.ensureEmployee(employeeId);
    const row = await this.prisma.employeeCompliance.findFirst({
      where: { id: complianceId, employeeId, deletedAt: null },
      include: complianceInclude,
    });
    if (!row) throw new NotFoundException('Compliance record not found');
    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        recordType: 'EmployeeCompliance',
        recordId: complianceId,
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
      });
    }
    return { data: this.decorateRow(row) };
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeComplianceDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    this.assertIssueBeforeExpiry(dto.issueDate, dto.expiryDate);
    const type = await this.prisma.complianceType.findFirst({
      where: { id: dto.complianceTypeId, deletedAt: null },
    });
    if (!type) throw new NotFoundException('Compliance type not found');

    const requirementId = await this.resolveRequirementId(
      employeeId,
      dto.complianceTypeId,
      dto.requirementId,
    );

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeCompliance.create({
        data: {
          employeeId,
          complianceTypeId: dto.complianceTypeId,
          requirementId,
          issueDate: dto.issueDate ?? null,
          expiryDate: dto.expiryDate ?? null,
          notes: dto.notes ?? null,
          createdById: userId,
          status: EmployeeComplianceStatus.REQUIRED,
        },
        include: complianceInclude,
      });
      const status = this.computePersistedStatus(created);
      const updated = await tx.employeeCompliance.update({
        where: { id: created.id },
        data: { status },
        include: complianceInclude,
      });
      await tx.complianceVerification.create({
        data: {
          employeeComplianceId: updated.id,
          action: ComplianceVerificationAction.UPDATED,
          previousStatus: null,
          newStatus: status,
          performedById: userId,
          metadata: { source: 'create' },
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_ADDED,
        recordType: 'EmployeeCompliance',
        recordId: updated.id,
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance record created', data: this.decorateRow(updated) };
    });
  }

  async update(
    userId: string,
    employeeId: string,
    complianceId: string,
    dto: UpdateEmployeeComplianceDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId, employeeId, deletedAt: null },
        include: complianceInclude,
      });
      if (!existing) throw new NotFoundException('Compliance record not found');

      const issueDate = dto.issueDate === undefined ? existing.issueDate : dto.issueDate;
      const expiryDate = dto.expiryDate === undefined ? existing.expiryDate : dto.expiryDate;
      this.assertIssueBeforeExpiry(issueDate, expiryDate);

      let requirementId = existing.requirementId;
      if (dto.complianceTypeId && dto.complianceTypeId !== existing.complianceTypeId) {
        requirementId = await this.resolveRequirementId(employeeId, dto.complianceTypeId, dto.requirementId ?? undefined);
      } else if (dto.requirementId !== undefined) {
        requirementId = dto.requirementId
          ? await this.resolveRequirementId(
              employeeId,
              dto.complianceTypeId ?? existing.complianceTypeId!,
              dto.requirementId,
            )
          : null;
      }

      const data: Prisma.EmployeeComplianceUncheckedUpdateInput = {
        updatedById: userId,
      };
      if (dto.complianceTypeId !== undefined) data.complianceTypeId = dto.complianceTypeId;
      if (dto.requirementId !== undefined || dto.complianceTypeId !== undefined) {
        data.requirementId = requirementId;
      }
      if (dto.issueDate !== undefined) data.issueDate = dto.issueDate;
      if (dto.expiryDate !== undefined) data.expiryDate = dto.expiryDate;
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.submittedAt !== undefined) data.submittedAt = dto.submittedAt;
      if (dto.clearVerification) {
        data.verifiedAt = null;
        data.verifiedById = null;
        data.rejectedAt = null;
        data.rejectedById = null;
        data.rejectionReason = null;
      }

      let updated = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data,
        include: complianceInclude,
      });
      const status = this.computePersistedStatus(updated);
      updated = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { status },
        include: complianceInclude,
      });

      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await tx.complianceVerification.create({
        data: {
          employeeComplianceId: complianceId,
          action: ComplianceVerificationAction.UPDATED,
          previousStatus: existing.status,
          newStatus: status,
          performedById: userId,
          metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_UPDATED,
        recordType: 'EmployeeCompliance',
        recordId: complianceId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance record updated', data: this.decorateRow(updated) };
    });
  }

  async remove(userId: string, employeeId: string, complianceId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Compliance record not found');
      await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_DELETED,
        recordType: 'EmployeeCompliance',
        recordId: complianceId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance record deleted', data: {} };
    });
  }

  async verify(
    userId: string,
    employeeId: string,
    complianceId: string,
    notes: string | undefined,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId, employeeId, deletedAt: null },
        include: complianceInclude,
      });
      if (!existing) throw new NotFoundException('Compliance record not found');
      const prev = existing.status;
      const updated = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: {
          verifiedAt: new Date(),
          verifiedById: userId,
          rejectedAt: null,
          rejectedById: null,
          rejectionReason: null,
          updatedById: userId,
        },
        include: complianceInclude,
      });
      const status = this.computePersistedStatus(updated);
      const finalRow = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { status },
        include: complianceInclude,
      });
      await tx.complianceVerification.create({
        data: {
          employeeComplianceId: complianceId,
          action: ComplianceVerificationAction.VERIFIED,
          previousStatus: prev,
          newStatus: status,
          notes: notes ?? null,
          performedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_VERIFIED,
        recordType: 'EmployeeCompliance',
        recordId: complianceId,
        newValues: auditSnapshot(finalRow),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance verified', data: this.decorateRow(finalRow) };
    });
  }

  async reject(
    userId: string,
    employeeId: string,
    complianceId: string,
    rejectionReason: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId, employeeId, deletedAt: null },
        include: complianceInclude,
      });
      if (!existing) throw new NotFoundException('Compliance record not found');
      const prev = existing.status;
      const updated = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: {
          rejectedAt: new Date(),
          rejectedById: userId,
          rejectionReason,
          verifiedAt: null,
          verifiedById: null,
          updatedById: userId,
        },
        include: complianceInclude,
      });
      const status = this.computePersistedStatus(updated);
      const finalRow = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { status },
        include: complianceInclude,
      });
      await tx.complianceVerification.create({
        data: {
          employeeComplianceId: complianceId,
          action: ComplianceVerificationAction.REJECTED,
          previousStatus: prev,
          newStatus: status,
          notes: rejectionReason,
          performedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_REJECTED,
        recordType: 'EmployeeCompliance',
        recordId: complianceId,
        newValues: auditSnapshot(finalRow),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance rejected', data: this.decorateRow(finalRow) };
    });
  }

  async markNoLongerRequired(
    userId: string,
    employeeId: string,
    complianceId: string,
    reason: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId, employeeId, deletedAt: null },
        include: complianceInclude,
      });
      if (!existing) throw new NotFoundException('Compliance record not found');
      const prev = existing.status;
      const updated = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: {
          isNoLongerRequired: true,
          noLongerRequiredReason: reason,
          noLongerRequiredAt: new Date(),
          noLongerRequiredById: userId,
          updatedById: userId,
        },
        include: complianceInclude,
      });
      const status = this.computePersistedStatus(updated);
      const finalRow = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { status },
        include: complianceInclude,
      });
      await tx.complianceVerification.create({
        data: {
          employeeComplianceId: complianceId,
          action: ComplianceVerificationAction.MARKED_NO_LONGER_REQUIRED,
          previousStatus: prev,
          newStatus: status,
          notes: reason,
          performedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_MARKED_NO_LONGER_REQUIRED,
        recordType: 'EmployeeCompliance',
        recordId: complianceId,
        newValues: auditSnapshot(finalRow),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Marked as no longer required', data: this.decorateRow(finalRow) };
    });
  }

  async addDocument(
    userId: string,
    employeeId: string,
    complianceId: string,
    file: Express.Multer.File,
    fileUrl: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId, employeeId, deletedAt: null },
        include: complianceInclude,
      });
      if (!existing) throw new NotFoundException('Compliance record not found');

      const doc = await tx.employeeComplianceDocument.create({
        data: {
          employeeComplianceId: complianceId,
          fileName: file.filename,
          originalName: file.originalname,
          fileUrl,
          fileSize: file.size,
          mimeType: file.mimetype,
          uploadedById: userId,
        },
      });

      let updated = await tx.employeeCompliance.findFirst({
        where: { id: complianceId },
        include: complianceInclude,
      });
      if (!updated) throw new NotFoundException('Compliance record not found');

      const needsSubmit = updated.complianceType?.requiresVerification !== false;
      await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: {
          submittedAt: needsSubmit ? new Date() : updated.submittedAt ?? new Date(),
          updatedById: userId,
          ...(needsSubmit
            ? {}
            : {
                verifiedAt: updated.verifiedAt ?? new Date(),
                verifiedById: updated.verifiedById ?? userId,
              }),
        },
      });
      updated = await tx.employeeCompliance.findFirst({
        where: { id: complianceId },
        include: complianceInclude,
      });
      if (!updated) throw new NotFoundException('Compliance record not found');
      const status = this.computePersistedStatus(updated);
      const finalRow = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { status },
        include: complianceInclude,
      });

      await tx.complianceVerification.create({
        data: {
          employeeComplianceId: complianceId,
          action: ComplianceVerificationAction.DOCUMENT_UPLOADED,
          previousStatus: existing.status,
          newStatus: status,
          performedById: userId,
          metadata: { documentId: doc.id },
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_DOCUMENT_UPLOADED,
        recordType: 'EmployeeComplianceDocument',
        recordId: doc.id,
        newValues: auditSnapshot(doc),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Document uploaded', data: { document: doc, compliance: this.decorateRow(finalRow) } };
    });
  }

  async removeDocument(
    userId: string,
    employeeId: string,
    complianceId: string,
    documentId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.employeeComplianceDocument.findFirst({
        where: {
          id: documentId,
          employeeComplianceId: complianceId,
          deletedAt: null,
          employeeCompliance: { employeeId, deletedAt: null },
        },
      });
      if (!doc) throw new NotFoundException('Document not found');

      await tx.employeeComplianceDocument.update({
        where: { id: documentId },
        data: { deletedAt: new Date() },
      });

      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId },
        include: complianceInclude,
      });
      if (!existing) throw new NotFoundException('Compliance record not found');
      const prev = existing.status;
      const status = this.computePersistedStatus(existing);
      const finalRow = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { status, updatedById: userId },
        include: complianceInclude,
      });

      await tx.complianceVerification.create({
        data: {
          employeeComplianceId: complianceId,
          action: ComplianceVerificationAction.DOCUMENT_DELETED,
          previousStatus: prev,
          newStatus: status,
          performedById: userId,
          metadata: { documentId },
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_DOCUMENT_DELETED,
        recordType: 'EmployeeComplianceDocument',
        recordId: documentId,
        oldValues: auditSnapshot(doc),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Document deleted', data: this.decorateRow(finalRow) };
    });
  }

  async downloadDocument(
    userId: string,
    employeeId: string,
    complianceId: string,
    documentId: string,
    res: Response,
    meta?: RequestAuditMeta,
  ) {
    const doc = await this.prisma.employeeComplianceDocument.findFirst({
      where: {
        id: documentId,
        employeeComplianceId: complianceId,
        deletedAt: null,
        employeeCompliance: { employeeId, deletedAt: null },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const rel = doc.fileUrl.startsWith('/uploads/')
      ? doc.fileUrl.replace('/uploads/', '')
      : doc.fileUrl.replace(/^\//, '');
    const abs = join(process.cwd(), 'uploads', rel);
    if (!existsSync(abs)) throw new NotFoundException('File not found on disk');

    await this.audit.logDataAccess({
      userId,
      module: AuditModule.EMPLOYEE_COMPLIANCE,
      recordType: 'EmployeeComplianceDocument',
      recordId: documentId,
      accessType: DataAccessType.DOWNLOAD,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
      metadata: { employeeId, complianceId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.EMPLOYEE_COMPLIANCE,
      action: AuditAction.EMPLOYEE_COMPLIANCE_DOCUMENT_DOWNLOADED,
      recordType: 'EmployeeComplianceDocument',
      recordId: documentId,
      metadata: { employeeId, complianceId },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalName)}"`);
    createReadStream(abs).pipe(res);
  }

  private async buildChecklistItems(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { employment: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const dims = employee.employment
      ? employmentDimsFromEmployment(employee.employment)
      : { roleId: null, workAreaId: null, jobTitleId: null, contractTypeId: null, locationId: null };

    const allReqs = await this.prisma.complianceRequirement.findMany({
      where: { deletedAt: null, isActive: true, complianceType: { deletedAt: null, isActive: true } },
    });
    const matched = allReqs.filter((r) => requirementMatchesEmployment(r, dims));
    const best = pickBestRequirementsPerType(matched, dims);

    const records = await this.prisma.employeeCompliance.findMany({
      where: { employeeId, deletedAt: null },
      include: complianceInclude,
    });
    const recordByTypeId = new Map(
      records.map((r) => [r.complianceTypeId, this.decorateRow(r)] as const),
    );

    const types = await this.prisma.complianceType.findMany({
      where: { deletedAt: null, isActive: true },
    });
    const typeByCode = new Map(types.filter((t) => t.code).map((t) => [t.code!, t]));
    const typeById = new Map(types.map((t) => [t.id, t]));

    const orderedTypeIds: string[] = [];
    for (const code of CARE_COMPLIANCE_CODE_ORDER) {
      const t = typeByCode.get(code);
      if (t && best.has(t.id)) orderedTypeIds.push(t.id);
    }
    for (const typeId of best.keys()) {
      if (!orderedTypeIds.includes(typeId)) orderedTypeIds.push(typeId);
    }

    let workAreaName: string | null = null;
    if (dims.workAreaId) {
      const wa = await this.prisma.workArea.findFirst({ where: { id: dims.workAreaId } });
      workAreaName = wa?.name ?? null;
    }

    const items = orderedTypeIds.map((typeId) => {
      const type = typeById.get(typeId);
      const req = best.get(typeId);
      const record = recordByTypeId.get(typeId) ?? null;
      return {
        complianceTypeId: typeId,
        code: type?.code ?? null,
        name: type?.name ?? '—',
        isMandatory: req?.isMandatory ?? type?.isMandatoryByDefault ?? false,
        requirementId: req?.id ?? null,
        record,
      };
    });

    return { workAreaId: dims.workAreaId, workAreaName, items };
  }

  async getChecklist(employeeId: string) {
    await this.ensureEmployee(employeeId);
    const data = await this.buildChecklistItems(employeeId);
    return { data };
  }

  async ensureChecklist(userId: string, employeeId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    const built = await this.buildChecklistItems(employeeId);
    let createdCount = 0;
    for (const item of built.items) {
      if (item.record) continue;
      await this.create(
        userId,
        employeeId,
        {
          complianceTypeId: item.complianceTypeId,
          requirementId: item.requirementId ?? undefined,
        },
        meta,
      );
      createdCount++;
    }
    const refreshed = await this.buildChecklistItems(employeeId);
    return {
      message: createdCount > 0 ? `Created ${createdCount} compliance placeholder(s).` : 'Checklist already complete.',
      data: { createdCount, ...refreshed },
    };
  }

  async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
