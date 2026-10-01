import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { PatchServiceUserLegalDocumentsDto } from './dto/patch-service-user-legal-documents.dto';
import { CreateServiceUserDolsRecordDto } from './dto/create-service-user-dols-record.dto';
import { UpdateServiceUserDolsRecordDto } from './dto/update-service-user-dols-record.dto';
import {
  CreateServiceUserLegalAuthorityDto,
  UpdateServiceUserLegalAuthorityDto,
} from './dto/service-user-legal-authority.dto';

const DOC_SEGMENTS = ['service-users', 'documents'] as const;

function parseOptionalCalendarDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new BadRequestException('Date must be YYYY-MM-DD');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) throw new BadRequestException('Invalid date');
  return dt;
}

function mapLegalRow(row: {
  id: string;
  serviceUserId: string;
  dnacprInPlace: boolean;
  dnacprCertificateUrl: string | null;
  dnacprStartDate: Date | null;
  lpaHealthCertificateUrl: string | null;
  lpaFinanceCertificateUrl: string | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    dnacprInPlace: row.dnacprInPlace,
    dnacprCertificateUrl: row.dnacprCertificateUrl,
    dnacprStartDate: row.dnacprStartDate ? row.dnacprStartDate.toISOString().slice(0, 10) : null,
    lpaHealthCertificateUrl: row.lpaHealthCertificateUrl,
    lpaFinanceCertificateUrl: row.lpaFinanceCertificateUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapLegalVirtual(serviceUserId: string) {
  return {
    id: null as string | null,
    serviceUserId,
    dnacprInPlace: false,
    dnacprCertificateUrl: null as string | null,
    dnacprStartDate: null as string | null,
    lpaHealthCertificateUrl: null as string | null,
    lpaFinanceCertificateUrl: null as string | null,
    updatedAt: null as string | null,
  };
}

function mapDols(row: {
  id: string;
  serviceUserId: string;
  applicationDate: Date | null;
  issueDate: Date | null;
  renewalDate: Date | null;
  isCurrent: boolean;
  reportedToChc: boolean;
  notes: string;
  certificateUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    applicationDate: row.applicationDate ? row.applicationDate.toISOString().slice(0, 10) : null,
    issueDate: row.issueDate ? row.issueDate.toISOString().slice(0, 10) : null,
    renewalDate: row.renewalDate ? row.renewalDate.toISOString().slice(0, 10) : null,
    isCurrent: row.isCurrent,
    reportedToChc: row.reportedToChc,
    notes: row.notes,
    certificateUrl: row.certificateUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type LegalAuthorityDbRow = Prisma.ServiceUserLegalAuthorityGetPayload<Record<string, never>>;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function mapLegalAuthority(row: LegalAuthorityDbRow) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    category: row.category,
    holderName: row.holderName,
    holderRelationship: row.holderRelationship,
    holderContact: row.holderContact,
    scope: row.scope,
    lifeSustainingTreatment: row.lifeSustainingTreatment,
    registeredOn: dateOnly(row.registeredOn),
    expiresOn: dateOnly(row.expiresOn),
    reference: row.reference,
    verificationStatus: row.verificationStatus,
    verificationMethod: row.verificationMethod,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    verifiedById: row.verifiedById,
    documentUrl: row.documentUrl,
    notes: row.notes,
    source: row.source,
    sourceSubmissionId: row.sourceSubmissionId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const EVIDENCED_STATUSES = new Set(['DOCUMENT_SEEN', 'VERIFIED']);

@Injectable()
export class ServiceUserDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  filePublicUrl(fileName: string): string {
    return `/uploads/${DOC_SEGMENTS.join('/')}/${fileName}`;
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  async getBundle(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const [legal, dols, authorities] = await Promise.all([
      this.prisma.serviceUserLegalDocument.findUnique({ where: { serviceUserId } }),
      this.prisma.serviceUserDolsRecord.findMany({
        where: { serviceUserId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.serviceUserLegalAuthority.findMany({
        where: { serviceUserId, deletedAt: null },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    return {
      data: {
        legal: legal ? mapLegalRow(legal) : mapLegalVirtual(serviceUserId),
        dols: dols.map(mapDols),
        legalAuthorities: authorities.map(mapLegalAuthority),
      },
    };
  }

  async patchLegal(userId: string, serviceUserId: string, dto: PatchServiceUserLegalDocumentsDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    const dnacprStartDate =
      dto.dnacprStartDate === undefined ? undefined : parseOptionalCalendarDate(dto.dnacprStartDate);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.serviceUserLegalDocument.findUnique({ where: { serviceUserId } });
      const oldSnap = auditSnapshot(existing ? mapLegalRow(existing) : mapLegalVirtual(serviceUserId));

      const patch: Prisma.ServiceUserLegalDocumentUncheckedUpdateInput = {
        ...(dto.dnacprInPlace !== undefined ? { dnacprInPlace: dto.dnacprInPlace } : {}),
        ...(dnacprStartDate !== undefined ? { dnacprStartDate } : {}),
        updatedById: userId,
      };

      const updated = existing
        ? await tx.serviceUserLegalDocument.update({
            where: { id: existing.id },
            data: patch,
          })
        : await tx.serviceUserLegalDocument.create({
            data: {
              serviceUserId,
              dnacprInPlace: dto.dnacprInPlace ?? false,
              dnacprStartDate: dnacprStartDate !== undefined ? dnacprStartDate : null,
              createdById: userId,
            },
          });

      const newSnap = auditSnapshot(mapLegalRow(updated));
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_LEGAL_DOCUMENTS_UPDATED,
        recordType: 'ServiceUserLegalDocument',
        recordId: updated.id,
        oldValues: oldSnap,
        newValues: newSnap,
        metadata: { changedFields: this.audit.getChangedFields(oldSnap, newSnap) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Documents updated', data: mapLegalRow(updated) };
    });
  }

  private validateCertMime(mimetype: string) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if (!allowed.has(mimetype)) throw new BadRequestException('Only JPEG, PNG, WebP, and PDF files are allowed');
  }

  private async ensureLegalRow(tx: Prisma.TransactionClient, serviceUserId: string, userId: string) {
    const row = await tx.serviceUserLegalDocument.findUnique({ where: { serviceUserId } });
    if (row) return row;
    return tx.serviceUserLegalDocument.create({
      data: { serviceUserId, createdById: userId },
    });
  }

  async uploadDnacprCertificate(userId: string, serviceUserId: string, file: Express.Multer.File, meta?: RequestAuditMeta) {
    this.validateCertMime(file.mimetype);
    await this.ensureServiceUser(serviceUserId);
    const url = this.filePublicUrl(file.filename);
    return this.prisma.$transaction(async (tx) => {
      const base = await this.ensureLegalRow(tx, serviceUserId, userId);
      const beforeUrl = base.dnacprCertificateUrl;
      const updated = await tx.serviceUserLegalDocument.update({
        where: { id: base.id },
        data: { dnacprCertificateUrl: url, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_LEGAL_DOCUMENTS_UPDATED,
        recordType: 'ServiceUserLegalDocument',
        recordId: updated.id,
        oldValues: auditSnapshot({ dnacprCertificateUrl: beforeUrl }),
        newValues: auditSnapshot({ dnacprCertificateUrl: url }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'DNACPR certificate uploaded', data: mapLegalRow(updated) };
    });
  }

  async uploadLpaHealthCertificate(userId: string, serviceUserId: string, file: Express.Multer.File, meta?: RequestAuditMeta) {
    this.validateCertMime(file.mimetype);
    await this.ensureServiceUser(serviceUserId);
    const url = this.filePublicUrl(file.filename);
    return this.prisma.$transaction(async (tx) => {
      const base = await this.ensureLegalRow(tx, serviceUserId, userId);
      const beforeUrl = base.lpaHealthCertificateUrl;
      const updated = await tx.serviceUserLegalDocument.update({
        where: { id: base.id },
        data: { lpaHealthCertificateUrl: url, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_LEGAL_DOCUMENTS_UPDATED,
        recordType: 'ServiceUserLegalDocument',
        recordId: updated.id,
        oldValues: auditSnapshot({ lpaHealthCertificateUrl: beforeUrl }),
        newValues: auditSnapshot({ lpaHealthCertificateUrl: url }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'LPA health certificate uploaded', data: mapLegalRow(updated) };
    });
  }

  async uploadLpaFinanceCertificate(userId: string, serviceUserId: string, file: Express.Multer.File, meta?: RequestAuditMeta) {
    this.validateCertMime(file.mimetype);
    await this.ensureServiceUser(serviceUserId);
    const url = this.filePublicUrl(file.filename);
    return this.prisma.$transaction(async (tx) => {
      const base = await this.ensureLegalRow(tx, serviceUserId, userId);
      const beforeUrl = base.lpaFinanceCertificateUrl;
      const updated = await tx.serviceUserLegalDocument.update({
        where: { id: base.id },
        data: { lpaFinanceCertificateUrl: url, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_LEGAL_DOCUMENTS_UPDATED,
        recordType: 'ServiceUserLegalDocument',
        recordId: updated.id,
        oldValues: auditSnapshot({ lpaFinanceCertificateUrl: beforeUrl }),
        newValues: auditSnapshot({ lpaFinanceCertificateUrl: url }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'LPA finance certificate uploaded', data: mapLegalRow(updated) };
    });
  }

  async createDols(userId: string, serviceUserId: string, dto: CreateServiceUserDolsRecordDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    const applicationDate =
      dto.applicationDate !== undefined ? parseOptionalCalendarDate(dto.applicationDate) : undefined;
    const issueDate = dto.issueDate !== undefined ? parseOptionalCalendarDate(dto.issueDate) : undefined;
    const renewalDate = dto.renewalDate !== undefined ? parseOptionalCalendarDate(dto.renewalDate) : undefined;
    const notes = dto.notes?.trim() ?? '';

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceUserDolsRecord.create({
        data: {
          serviceUserId,
          applicationDate: applicationDate ?? null,
          issueDate: issueDate ?? null,
          renewalDate: renewalDate ?? null,
          isCurrent: dto.isCurrent ?? false,
          reportedToChc: dto.reportedToChc ?? false,
          notes,
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOLS_RECORD_CREATED,
        recordType: 'ServiceUserDolsRecord',
        recordId: created.id,
        newValues: auditSnapshot(mapDols(created)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'DoLS record created', data: mapDols(created) };
    });
  }

  async updateDols(
    userId: string,
    serviceUserId: string,
    dolsId: string,
    dto: UpdateServiceUserDolsRecordDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserDolsRecord.findFirst({
        where: { id: dolsId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('DoLS record not found');

      const applicationDate =
        dto.applicationDate !== undefined ? parseOptionalCalendarDate(dto.applicationDate) : undefined;
      const issueDate = dto.issueDate !== undefined ? parseOptionalCalendarDate(dto.issueDate) : undefined;
      const renewalDate = dto.renewalDate !== undefined ? parseOptionalCalendarDate(dto.renewalDate) : undefined;
      const notes = dto.notes !== undefined ? dto.notes.trim() : undefined;

      const updated = await tx.serviceUserDolsRecord.update({
        where: { id: dolsId },
        data: {
          ...(applicationDate !== undefined ? { applicationDate } : {}),
          ...(issueDate !== undefined ? { issueDate } : {}),
          ...(renewalDate !== undefined ? { renewalDate } : {}),
          ...(dto.isCurrent !== undefined ? { isCurrent: dto.isCurrent } : {}),
          ...(dto.reportedToChc !== undefined ? { reportedToChc: dto.reportedToChc } : {}),
          ...(notes !== undefined ? { notes } : {}),
          updatedById: userId,
        },
      });
      const oldS = auditSnapshot(mapDols(before));
      const newS = auditSnapshot(mapDols(updated));
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOLS_RECORD_UPDATED,
        recordType: 'ServiceUserDolsRecord',
        recordId: dolsId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'DoLS record updated', data: mapDols(updated) };
    });
  }

  async removeDols(userId: string, serviceUserId: string, dolsId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserDolsRecord.findFirst({
        where: { id: dolsId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('DoLS record not found');
      await tx.serviceUserDolsRecord.update({
        where: { id: dolsId },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOLS_RECORD_DELETED,
        recordType: 'ServiceUserDolsRecord',
        recordId: dolsId,
        oldValues: auditSnapshot(mapDols(before)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'DoLS record removed', data: {} };
    });
  }

  async uploadDolsCertificate(
    userId: string,
    serviceUserId: string,
    dolsId: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    this.validateCertMime(file.mimetype);
    await this.ensureServiceUser(serviceUserId);
    const url = this.filePublicUrl(file.filename);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserDolsRecord.findFirst({
        where: { id: dolsId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('DoLS record not found');
      const beforeUrl = before.certificateUrl;
      const updated = await tx.serviceUserDolsRecord.update({
        where: { id: dolsId },
        data: { certificateUrl: url, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOLS_RECORD_UPDATED,
        recordType: 'ServiceUserDolsRecord',
        recordId: dolsId,
        oldValues: auditSnapshot({ certificateUrl: beforeUrl }),
        newValues: auditSnapshot({ certificateUrl: url }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'DoLS certificate uploaded', data: mapDols(updated) };
    });
  }

  private legalAuthorityData(
    dto: UpdateServiceUserLegalAuthorityDto,
  ): Prisma.ServiceUserLegalAuthorityUncheckedUpdateInput {
    const registeredOn = dto.registeredOn === undefined ? undefined : parseOptionalCalendarDate(dto.registeredOn);
    const expiresOn = dto.expiresOn === undefined ? undefined : parseOptionalCalendarDate(dto.expiresOn);
    return {
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.holderName !== undefined ? { holderName: dto.holderName.trim() } : {}),
      ...(dto.holderRelationship !== undefined ? { holderRelationship: dto.holderRelationship.trim() } : {}),
      ...(dto.holderContact !== undefined ? { holderContact: dto.holderContact.trim() } : {}),
      ...(dto.scope !== undefined ? { scope: dto.scope.trim() } : {}),
      ...(dto.lifeSustainingTreatment !== undefined ? { lifeSustainingTreatment: dto.lifeSustainingTreatment } : {}),
      ...(registeredOn !== undefined ? { registeredOn } : {}),
      ...(expiresOn !== undefined ? { expiresOn } : {}),
      ...(dto.reference !== undefined ? { reference: dto.reference.trim() } : {}),
      ...(dto.verificationStatus !== undefined ? { verificationStatus: dto.verificationStatus } : {}),
      ...(dto.verificationMethod !== undefined ? { verificationMethod: dto.verificationMethod.trim() } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
  }

  async createLegalAuthority(
    userId: string,
    serviceUserId: string,
    dto: CreateServiceUserLegalAuthorityDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const data = this.legalAuthorityData(dto);
    const evidenced = EVIDENCED_STATUSES.has(dto.verificationStatus ?? 'REPORTED');
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceUserLegalAuthority.create({
        data: {
          ...(data as Prisma.ServiceUserLegalAuthorityUncheckedCreateInput),
          serviceUserId,
          category: dto.category,
          holderName: dto.holderName.trim(),
          ...(evidenced ? { verifiedAt: new Date(), verifiedById: userId } : {}),
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_LEGAL_AUTHORITY_CREATED,
        recordType: 'ServiceUserLegalAuthority',
        recordId: created.id,
        newValues: auditSnapshot(mapLegalAuthority(created)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Legal authority added', data: mapLegalAuthority(created) };
    });
  }

  async updateLegalAuthority(
    userId: string,
    serviceUserId: string,
    authorityId: string,
    dto: UpdateServiceUserLegalAuthorityDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserLegalAuthority.findFirst({
        where: { id: authorityId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Legal authority not found');
      const data = this.legalAuthorityData(dto);
      // Who checked it and when — set whenever the status moves to seen / verified.
      if (
        dto.verificationStatus !== undefined &&
        dto.verificationStatus !== before.verificationStatus &&
        EVIDENCED_STATUSES.has(dto.verificationStatus)
      ) {
        data.verifiedAt = new Date();
        data.verifiedById = userId;
      }
      const updated = await tx.serviceUserLegalAuthority.update({
        where: { id: authorityId },
        data: { ...data, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_LEGAL_AUTHORITY_UPDATED,
        recordType: 'ServiceUserLegalAuthority',
        recordId: authorityId,
        oldValues: auditSnapshot(mapLegalAuthority(before)),
        newValues: auditSnapshot(mapLegalAuthority(updated)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Legal authority updated', data: mapLegalAuthority(updated) };
    });
  }

  async removeLegalAuthority(userId: string, serviceUserId: string, authorityId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserLegalAuthority.findFirst({
        where: { id: authorityId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Legal authority not found');
      await tx.serviceUserLegalAuthority.update({
        where: { id: authorityId },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_LEGAL_AUTHORITY_DELETED,
        recordType: 'ServiceUserLegalAuthority',
        recordId: authorityId,
        oldValues: auditSnapshot(mapLegalAuthority(before)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Legal authority removed', data: {} };
    });
  }
}
