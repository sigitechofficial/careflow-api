import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateCommunicationNoteDto } from './dto/create-communication-note.dto';

type CommunicationNoteRow = Prisma.ServiceUserCommunicationNoteGetPayload<object>;

const ALLOWED_SHARE_TARGETS = new Set(['handover', 'manager', 'family']);

function normalizeShareWith(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(v => v.trim().toLowerCase()).filter(v => ALLOWED_SHARE_TARGETS.has(v)))];
}

function mapCommunicationNote(row: CommunicationNoteRow) {
  const shareWith = Array.isArray(row.shareWith)
    ? row.shareWith.filter((v): v is string => typeof v === 'string')
    : [];

  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    name: row.name,
    position: row.position,
    reason: row.reason,
    outcome: row.outcome,
    signature: row.signature,
    recordedAt: row.recordedAt.toISOString(),
    isPrivate: row.isPrivate,
    shareWith,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ServiceUserCommunicationNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const user = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('Service user not found');
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);

    const rows = await this.prisma.serviceUserCommunicationNote.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: { recordedAt: 'desc' },
    });

    return { data: rows.map(mapCommunicationNote) };
  }

  async create(
    userId: string,
    serviceUserId: string,
    dto: CreateCommunicationNoteDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);

    const recordedAt = new Date(dto.recordedAt);
    if (Number.isNaN(recordedAt.getTime())) {
      throw new BadRequestException('recordedAt must be a valid ISO date-time');
    }

    const shareWith = normalizeShareWith(dto.shareWith);

    return this.prisma.$transaction(async tx => {
      const created = await tx.serviceUserCommunicationNote.create({
        data: {
          serviceUserId,
          name: dto.name.trim(),
          position: dto.position.trim(),
          reason: dto.reason.trim(),
          outcome: dto.outcome.trim(),
          signature: dto.signature?.trim() || null,
          recordedAt,
          isPrivate: dto.isPrivate === true,
          shareWith,
          createdById: userId,
        },
      });

      const mapped = mapCommunicationNote(created);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_COMMUNICATION_NOTE_CREATED,
        eventType: AuditEventType.CREATE,
        recordType: 'ServiceUserCommunicationNote',
        recordId: created.id,
        description: `Communication note recorded for ${mapped.name}`,
        newValues: auditSnapshot(mapped),
        metadata: { serviceUserId, position: mapped.position },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Communication note created', data: mapped };
    });
  }

  async remove(
    userId: string,
    serviceUserId: string,
    noteId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);

    return this.prisma.$transaction(async tx => {
      const before = await tx.serviceUserCommunicationNote.findFirst({
        where: { id: noteId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Communication note not found');

      const deleted = await tx.serviceUserCommunicationNote.update({
        where: { id: noteId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });

      const mapped = mapCommunicationNote(deleted);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_COMMUNICATION_NOTE_DELETED,
        eventType: AuditEventType.DELETE,
        recordType: 'ServiceUserCommunicationNote',
        recordId: deleted.id,
        description: `Communication note removed for ${before.name}`,
        oldValues: auditSnapshot(mapCommunicationNote(before)),
        newValues: auditSnapshot(mapped),
        metadata: { serviceUserId, position: before.position },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Communication note removed', data: mapped };
    });
  }
}
