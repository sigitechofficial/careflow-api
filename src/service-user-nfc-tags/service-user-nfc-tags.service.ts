import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateServiceUserNfcTagDto } from './dto/create-service-user-nfc-tag.dto';
import { UpdateServiceUserNfcTagDto } from './dto/update-service-user-nfc-tag.dto';
import { formatNfcTagUid, normalizeNfcTagUid } from './nfc-tag-uid.util';

type TagRow = Prisma.ServiceUserNfcTagGetPayload<object>;

function fullName(first?: string | null, last?: string | null): string | null {
  const name = [first, last].filter((p) => p && p.trim()).join(' ').trim();
  return name || null;
}

const INVALID_UID_MESSAGE =
  'Enter the tag UID in hex, e.g. 04:A2:3B:1C:5D:80:00 (4, 7 or 10 bytes). ' +
  'If you use a USB reader, set it to output the UID in hex.';

@Injectable()
export class ServiceUserNfcTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private map(row: TagRow, registeredByName: string | null = null) {
    return {
      id: row.id,
      serviceUserId: row.serviceUserId,
      uid: row.uid,
      uidDisplay: formatNfcTagUid(row.uid),
      label: row.label,
      locationNote: row.locationNote,
      status: row.status,
      statusReason: row.statusReason,
      statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
      lastScannedAt: row.lastScannedAt?.toISOString() ?? null,
      registeredAt: row.createdAt.toISOString(),
      registeredByName,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async ensureServiceUser(serviceUserId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!su) throw new NotFoundException('Service user not found');
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map<string, string | null>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(users.map((u) => [u.id, fullName(u.firstName, u.lastName) ?? u.email]));
  }

  /** Throws when [uid] is already ACTIVE on any service user (optionally ignoring one tag). */
  private async assertUidFree(
    tx: Prisma.TransactionClient,
    uid: string,
    ignoreTagId?: string,
  ) {
    const clash = await tx.serviceUserNfcTag.findFirst({
      where: {
        uid,
        status: 'ACTIVE',
        deletedAt: null,
        ...(ignoreTagId ? { id: { not: ignoreTagId } } : {}),
      },
      select: {
        label: true,
        serviceUser: { select: { firstName: true, lastName: true } },
      },
    });
    if (clash) {
      const who = fullName(clash.serviceUser.firstName, clash.serviceUser.lastName) ?? 'another service user';
      throw new ConflictException(
        `This tag is already active for ${who} ("${clash.label}"). Mark it lost or retired there first.`,
      );
    }
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const rows = await this.prisma.serviceUserNfcTag.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    const names = await this.userNames(rows.map((r) => r.createdById));
    return {
      data: rows.map((r) => this.map(r, r.createdById ? (names.get(r.createdById) ?? null) : null)),
    };
  }

  /** Latest scans of one tag (newest first) with carer, visit and client names. */
  async listScans(serviceUserId: string, tagId: string, limit = 50) {
    await this.ensureServiceUser(serviceUserId);
    const tag = await this.prisma.serviceUserNfcTag.findFirst({
      where: { id: tagId, serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!tag) throw new NotFoundException('NFC tag not found');

    const scans = await this.prisma.serviceUserNfcTagScan.findMany({
      where: { tagId },
      orderBy: { scannedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const [employees, jobs, clients] = await Promise.all([
      this.prisma.employeePersonalDetail.findMany({
        where: { employeeId: { in: [...new Set(scans.map((x) => x.employeeId))] } },
        select: { employeeId: true, firstName: true, lastName: true },
      }),
      this.prisma.scheduledJob.findMany({
        where: { id: { in: [...new Set(scans.map((x) => x.scheduledJobId))] } },
        select: { id: true, jobName: true, scheduledStartDateTime: true },
      }),
      this.prisma.serviceUser.findMany({
        where: { id: { in: [...new Set(scans.map((x) => x.visitServiceUserId))] } },
        select: { id: true, firstName: true, lastName: true, preferredName: true },
      }),
    ]);
    const carerName = new Map(employees.map((e) => [e.employeeId, fullName(e.firstName, e.lastName)]));
    const job = new Map(jobs.map((j) => [j.id, j]));
    const client = new Map(
      clients.map((c) => [c.id, fullName(c.preferredName ?? c.firstName, c.lastName)]),
    );

    return {
      data: scans.map((x) => ({
        id: x.id,
        scannedAt: x.scannedAt.toISOString(),
        result: x.result,
        source: x.source,
        carerName: carerName.get(x.employeeId) ?? null,
        scheduledJobId: x.scheduledJobId,
        visitName: job.get(x.scheduledJobId)?.jobName ?? null,
        visitStart: job.get(x.scheduledJobId)?.scheduledStartDateTime.toISOString() ?? null,
        /** Only set when the tag was scanned at another client's visit. */
        otherClientName:
          x.visitServiceUserId !== serviceUserId ? (client.get(x.visitServiceUserId) ?? null) : null,
      })),
    };
  }

  async create(
    userId: string,
    serviceUserId: string,
    dto: CreateServiceUserNfcTagDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const uid = normalizeNfcTagUid(dto.uid);
    if (!uid) throw new BadRequestException(INVALID_UID_MESSAGE);
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Give the tag a name');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertUidFree(tx, uid);
        const created = await tx.serviceUserNfcTag.create({
          data: {
            serviceUserId,
            uid,
            label,
            locationNote: dto.locationNote?.trim() || null,
            status: 'ACTIVE',
            createdById: userId,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.SERVICE_USER_NFC_TAG_ADDED,
          recordType: 'ServiceUserNfcTag',
          recordId: created.id,
          newValues: auditSnapshot(this.map(created)),
          metadata: { serviceUserId },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        const names = await this.userNames([userId]);
        return { message: 'NFC tag registered', data: this.map(created, names.get(userId) ?? null) };
      });
    } catch (err) {
      throw this.mapUniqueViolation(err);
    }
  }

  async update(
    userId: string,
    serviceUserId: string,
    tagId: string,
    dto: UpdateServiceUserNfcTagDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.serviceUserNfcTag.findFirst({
          where: { id: tagId, serviceUserId, deletedAt: null },
        });
        if (!before) throw new NotFoundException('NFC tag not found');

        const label = dto.label !== undefined ? dto.label.trim() : undefined;
        if (label !== undefined && !label) {
          throw new BadRequestException('Give the tag a name');
        }
        const statusChanged = dto.status !== undefined && dto.status !== before.status;
        if (statusChanged && dto.status === 'ACTIVE') {
          await this.assertUidFree(tx, before.uid, before.id);
        }

        const updated = await tx.serviceUserNfcTag.update({
          where: { id: tagId },
          data: {
            ...(label !== undefined ? { label } : {}),
            ...(dto.locationNote !== undefined
              ? { locationNote: dto.locationNote?.trim() || null }
              : {}),
            ...(statusChanged
              ? {
                  status: dto.status,
                  statusReason: dto.statusReason?.trim() || null,
                  statusChangedAt: new Date(),
                }
              : {}),
            updatedById: userId,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.SERVICE_USER_NFC_TAG_UPDATED,
          recordType: 'ServiceUserNfcTag',
          recordId: tagId,
          oldValues: auditSnapshot(this.map(before)),
          newValues: auditSnapshot(this.map(updated)),
          metadata: { serviceUserId },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        const names = await this.userNames([updated.createdById]);
        return {
          message: 'NFC tag updated',
          data: this.map(updated, updated.createdById ? (names.get(updated.createdById) ?? null) : null),
        };
      });
    } catch (err) {
      throw this.mapUniqueViolation(err);
    }
  }

  async remove(userId: string, serviceUserId: string, tagId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserNfcTag.findFirst({
        where: { id: tagId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('NFC tag not found');
      await tx.serviceUserNfcTag.update({
        where: { id: tagId },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_NFC_TAG_REMOVED,
        recordType: 'ServiceUserNfcTag',
        recordId: tagId,
        oldValues: auditSnapshot(this.map(before)),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'NFC tag removed', data: { id: tagId } };
    });
  }

  /** The partial unique index is the last line of defence against a race. */
  private mapUniqueViolation(err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('This tag is already active for another service user.');
    }
    return err;
  }
}
