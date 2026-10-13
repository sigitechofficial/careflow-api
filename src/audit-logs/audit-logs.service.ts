import { Injectable, InternalServerErrorException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import {
  Prisma,
  AuditStatus,
  DataAccessType,
  ExportType,
  SecuritySeverity,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { getRequestAuditMeta, type RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { LoginHistoryQueryDto } from './dto/login-history-query.dto';
import { SecurityEventQueryDto } from './dto/security-event-query.dto';
import { DataAccessLogQueryDto } from './dto/data-access-log-query.dto';
import { ExportLogQueryDto } from './dto/export-log-query.dto';
import {
  buildAuditLogContext,
  collectAuditEnrichmentIds,
  formatServiceUserDisplayName,
  type AuditLogContext,
} from './audit-log-context.util';
import { resolveAuditEventType } from './audit-event-type.util';
import { AuditEventType } from '@prisma/client';
import { AuditModule } from './enums/audit-module.enum';
import { AuditAction } from './enums/audit-action.enum';
import { assertFinancialResetEnvironment } from '../billing/financial-controls.util';

type Db = PrismaService | Prisma.TransactionClient;

const SENSITIVE_FIELD_NAMES = new Set(
  [
    'password',
    'passwordhash',
    'refreshtoken',
    'accesstoken',
    'resettoken',
    'token',
    'pin',
    'secret',
    'otp',
    'mfasecret',
    'authorization',
    'cookie',
    'refreshtokenhash',
    'keysafenumber',
    'keysafe',
  ].map((s) => s.toLowerCase()),
);

export type LogAuditParams = {
  tx?: Prisma.TransactionClient;
  userId?: string | null;
  module: string;
  action: string;
  /** Enterprise event category (stored for filtering). Inferred from action when omitted. */
  eventType?: AuditEventType | null;
  recordType?: string | null;
  recordId?: string | null;
  description?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  status?: AuditStatus;
};

export type LogLoginParams = {
  tx?: Prisma.TransactionClient;
  userId?: string | null;
  email?: string | null;
  event: string;
  status: AuditStatus;
  failureReason?: string | null;
  deviceName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type LogSecurityEventParams = {
  tx?: Prisma.TransactionClient;
  userId?: string | null;
  eventType: string;
  severity?: SecuritySeverity;
  description?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
};

export type LogDataAccessParams = {
  tx?: Prisma.TransactionClient;
  userId?: string | null;
  module: string;
  recordType?: string | null;
  recordId?: string | null;
  accessType: DataAccessType;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
};

export type LogExportParams = {
  tx?: Prisma.TransactionClient;
  userId?: string | null;
  module: string;
  exportType: ExportType;
  filters?: unknown;
  fileName?: string | null;
  recordCount?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
};

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  getRequestMeta(req: Request): RequestAuditMeta {
    return getRequestAuditMeta(req);
  }

  shouldMaskField(fieldName: string): boolean {
    return SENSITIVE_FIELD_NAMES.has(fieldName.toLowerCase());
  }

  maskSensitiveData(data: unknown): Prisma.InputJsonValue {
    if (data === null || data === undefined) {
      return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
    }
    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }
    if (Array.isArray(data)) {
      return data.map((item) => this.maskSensitiveData(item)) as Prisma.InputJsonValue;
    }
    if (typeof data === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (this.shouldMaskField(k)) {
          out[k] = '[REDACTED]';
        } else if (v !== null && typeof v === 'object') {
          out[k] = this.maskSensitiveData(v) as unknown;
        } else {
          out[k] = v;
        }
      }
      return out as Prisma.InputJsonValue;
    }
    return data as Prisma.InputJsonValue;
  }

  getChangedFields(
    oldData: Record<string, unknown> | null | undefined,
    newData: Record<string, unknown> | null | undefined,
  ): string[] {
    const keys = new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})]);
    const changed: string[] = [];
    for (const k of keys) {
      if (this.shouldMaskField(k)) continue;
      const a = JSON.stringify(oldData?.[k]);
      const b = JSON.stringify(newData?.[k]);
      if (a !== b) changed.push(k);
    }
    return changed;
  }

  private readonly auditFailures = new Logger('AuditLog');

  private db(tx?: Prisma.TransactionClient): Db {
    return tx ?? this.prisma;
  }

  async logAudit(params: LogAuditParams) {
    const client = this.db(params.tx);
    const eventType = resolveAuditEventType(
      params.action,
      params.metadata,
      params.eventType,
    );
    return client.auditLog
      .create({
      data: {
        userId: params.userId ?? undefined,
        module: params.module,
        action: params.action,
        eventType,
        recordType: params.recordType ?? undefined,
        recordId: params.recordId ?? undefined,
        description: params.description ?? undefined,
        oldValues:
          params.oldValues !== undefined && params.oldValues !== null
            ? (this.maskSensitiveData(params.oldValues) as Prisma.InputJsonValue)
            : undefined,
        newValues:
          params.newValues !== undefined && params.newValues !== null
            ? (this.maskSensitiveData(params.newValues) as Prisma.InputJsonValue)
            : undefined,
        metadata:
          params.metadata !== undefined && params.metadata !== null
            ? (this.maskSensitiveData(params.metadata) as Prisma.InputJsonValue)
            : undefined,
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
        status: params.status ?? AuditStatus.SUCCESS,
      },
      })
      .catch((error: unknown) => {
        throw this.auditWriteFailure(error, params);
      });
  }

  /**
   * An audit entry that cannot be written is never skipped: the failure is logged and the caller
   * gets an error it can answer with. Inside a transaction that error rolls the change back with
   * it. The usual cause is a user who no longer exists (a session left over from a deleted
   * account): that is answered as "not signed in", not as a server fault.
   */
  private auditWriteFailure(error: unknown, params: LogAuditParams) {
    const staleUser =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003' &&
      String((error.meta as { constraint?: unknown } | undefined)?.constraint ?? error.message).includes('userId');
    this.auditFailures.error(
      `Audit entry not written (${params.module}/${params.action}, record ${params.recordType ?? '-'} ${params.recordId ?? '-'}, ` +
        `user ${params.userId ?? '-'}): ${staleUser ? 'the user no longer exists' : error instanceof Error ? error.message.split('\n').pop() : 'unknown error'}` +
        (params.tx ? '. The change was rolled back.' : ''),
    );
    if (staleUser) return new UnauthorizedException('Your account is no longer active. Sign in again.');
    return new InternalServerErrorException(
      params.tx
        ? 'The change was not saved because its audit entry could not be written. Try again.'
        : 'The action could not be recorded in the audit log.',
    );
  }

  async logLogin(params: LogLoginParams) {
    const client = this.db(params.tx);
    return client.loginHistory.create({
      data: {
        userId: params.userId ?? undefined,
        email: params.email ?? undefined,
        event: params.event,
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
        deviceName: params.deviceName ?? undefined,
        status: params.status,
        failureReason: params.failureReason ?? undefined,
      },
    });
  }

  async logSecurityEvent(params: LogSecurityEventParams) {
    const client = this.db(params.tx);
    return client.securityEvent.create({
      data: {
        userId: params.userId ?? undefined,
        eventType: params.eventType,
        severity: params.severity ?? SecuritySeverity.MEDIUM,
        description: params.description ?? undefined,
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
        metadata:
          params.metadata !== undefined && params.metadata !== null
            ? (this.maskSensitiveData(params.metadata) as Prisma.InputJsonValue)
            : undefined,
      },
    });
  }

  async logDataAccess(params: LogDataAccessParams) {
    const client = this.db(params.tx);
    return client.dataAccessLog.create({
      data: {
        userId: params.userId ?? undefined,
        module: params.module,
        recordType: params.recordType ?? undefined,
        recordId: params.recordId ?? undefined,
        accessType: params.accessType,
        reason: params.reason ?? undefined,
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
        metadata:
          params.metadata !== undefined && params.metadata !== null
            ? (this.maskSensitiveData(params.metadata) as Prisma.InputJsonValue)
            : undefined,
      },
    });
  }

  async logExport(params: LogExportParams) {
    const client = this.db(params.tx);
    return client.exportLog.create({
      data: {
        userId: params.userId ?? undefined,
        module: params.module,
        exportType: params.exportType,
        filters:
          params.filters !== undefined && params.filters !== null
            ? (this.maskSensitiveData(params.filters) as Prisma.InputJsonValue)
            : undefined,
        fileName: params.fileName ?? undefined,
        recordCount: params.recordCount ?? undefined,
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
        metadata:
          params.metadata !== undefined && params.metadata !== null
            ? (this.maskSensitiveData(params.metadata) as Prisma.InputJsonValue)
            : undefined,
      },
    });
  }

  private async medicationIdsForServiceUser(serviceUserId: string): Promise<string[]> {
    const rows = await this.prisma.serviceUserMedication.findMany({
      where: { serviceUserId },
      select: { id: true },
    });
    return rows.map(r => r.id);
  }

  private serviceUserAuditScope(serviceUserId: string, medicationIds: string[]): Prisma.AuditLogWhereInput {
    const or: Prisma.AuditLogWhereInput[] = [
      { metadata: { path: ['serviceUserId'], equals: serviceUserId } },
      { recordId: serviceUserId },
    ];
    if (medicationIds.length > 0) {
      or.push({
        recordType: 'ServiceUserMedication',
        recordId: { in: medicationIds },
      });
    }
    return { OR: or };
  }

  /**
   * `excludeModules`: modules the caller may not read. Pay and payroll entries are organisation
   * wide (they name runs, amounts and approvers across branches), so a branch-limited user does
   * not see them (SI-10).
   */
  async findAuditLogs(query: AuditLogQueryDto, options?: { excludeModules?: string[] }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.AuditLogWhereInput = {};
    if (options?.excludeModules?.length) where.NOT = { module: { in: options.excludeModules } };
    if (query.userId) where.userId = query.userId;
    if (query.module) where.module = query.module;
    if (query.action) where.action = query.action;
    if (query.eventType) where.eventType = query.eventType;
    if (query.recordType) where.recordType = query.recordType;
    if (query.recordId) where.recordId = query.recordId;
    if (query.status) where.status = query.status;
    if (query.ipAddress?.trim()) {
      where.ipAddress = { contains: query.ipAddress.trim(), mode: 'insensitive' };
    }
    const range = this.buildDateRange(query.dateFrom, query.dateTo);
    if (range) where.createdAt = range;
    if (query.serviceUserId) {
      const medicationIds = await this.medicationIdsForServiceUser(query.serviceUserId);
      where.AND = [
        ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
        this.serviceUserAuditScope(query.serviceUserId, medicationIds),
      ];
    }
    if (query.search?.trim()) {
      const s = query.search.trim();
      const searchOr: Prisma.AuditLogWhereInput[] = [
        { action: { contains: s, mode: 'insensitive' } },
        { module: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { recordType: { contains: s, mode: 'insensitive' } },
        { ipAddress: { contains: s, mode: 'insensitive' } },
      ];
      where.AND = [
        ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
        { OR: searchOr },
      ];
    }
    const orderBy: Prisma.AuditLogOrderByWithRelationInput = {
      [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc',
    };
    const userSelect = { id: true, email: true, firstName: true, lastName: true } as const;
    const [total, data] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { user: { select: userSelect } },
      }),
    ]);
    const enriched = await this.enrichAuditLogRows(data);
    return { data: enriched, meta: buildPaginationMeta({ page, limit, total }) };
  }

  private async enrichAuditLogRows<
    T extends {
      action: string;
      eventType: AuditEventType | null;
      description: string | null;
      metadata: Prisma.JsonValue;
      newValues: Prisma.JsonValue;
      oldValues: Prisma.JsonValue;
      recordType: string | null;
      recordId: string | null;
    },
  >(rows: T[]): Promise<Array<T & { context: AuditLogContext }>> {
    if (rows.length === 0) return [];

    const {
      serviceUserIds: suIdsFromRows,
      medicationIds,
      observationIds,
    } = collectAuditEnrichmentIds(rows);

    const [medications, observations] = await Promise.all([
      medicationIds.length > 0
        ? this.prisma.serviceUserMedication.findMany({
            where: { id: { in: medicationIds } },
            select: { id: true, medicationName: true, serviceUserId: true },
          })
        : Promise.resolve([]),
      observationIds.length > 0
        ? this.prisma.serviceUserObservation.findMany({
            where: { id: { in: observationIds } },
            select: {
              id: true,
              serviceUserId: true,
              numericValue: true,
              unit: true,
              observationType: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const allServiceUserIds = [
      ...new Set([
        ...suIdsFromRows,
        ...medications.map(m => m.serviceUserId),
        ...observations.map(o => o.serviceUserId),
      ]),
    ];

    const serviceUsers =
      allServiceUserIds.length > 0
        ? await this.prisma.serviceUser.findMany({
            where: { id: { in: allServiceUserIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              serviceUserNumber: true,
            },
          })
        : [];

    const serviceUserNames = new Map(
      serviceUsers.map(u => [u.id, formatServiceUserDisplayName(u)]),
    );
    const medicationById = new Map(
      medications.map(m => [
        m.id,
        { medicationName: m.medicationName, serviceUserId: m.serviceUserId },
      ]),
    );
    const observationById = new Map(
      observations.map(o => {
        const typeName = o.observationType.name;
        const valueLabel =
          o.numericValue != null
            ? o.unit?.trim()
              ? `${Number(o.numericValue)} ${o.unit.trim()}`
              : String(Number(o.numericValue))
            : null;
        return [
          o.id,
          { serviceUserId: o.serviceUserId, observationTypeName: typeName, valueLabel },
        ];
      }),
    );

    return rows.map(row => ({
      ...row,
      context: buildAuditLogContext(row, {
        serviceUserNames,
        medicationById,
        observationById,
      }),
    }));
  }

  async findAuditLogById(id: string, options?: { excludeModules?: string[] }) {
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!row || options?.excludeModules?.includes(row.module)) {
      throw new NotFoundException('Audit log not found');
    }
    return { data: row };
  }

  /**
   * Test reset only. The audit log is evidence: it is never cleared in production, and outside
   * production only when the server opts in (ALLOW_FINANCIAL_TEST_RESET=true). The clearing is
   * itself the first entry of the new log.
   */
  async clearAuditLogs(userId: string, meta?: RequestAuditMeta) {
    assertFinancialResetEnvironment();
    const result = await this.prisma.auditLog.deleteMany({});
    await this.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.FINANCIAL_TEST_DATA_RESET,
      recordType: 'AuditLog',
      recordId: 'all',
      newValues: { operation: 'audit log cleared', deletedCount: result.count },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return {
      message: 'Audit log cleared',
      data: { deletedCount: result.count },
    };
  }

  async findLoginHistory(query: LoginHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.LoginHistoryWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.event) where.event = query.event;
    if (query.status) where.status = query.status;
    const range = this.buildDateRange(query.dateFrom, query.dateTo);
    if (range) where.createdAt = range;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { email: { contains: s, mode: 'insensitive' } },
        { event: { contains: s, mode: 'insensitive' } },
        { failureReason: { contains: s, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.LoginHistoryOrderByWithRelationInput = {
      [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc',
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.loginHistory.count({ where }),
      this.prisma.loginHistory.findMany({ where, skip, take: limit, orderBy }),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async findSecurityEvents(query: SecurityEventQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.SecurityEventWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.eventType) where.eventType = query.eventType;
    if (query.severity) where.severity = query.severity;
    const range = this.buildDateRange(query.dateFrom, query.dateTo);
    if (range) where.createdAt = range;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { eventType: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.SecurityEventOrderByWithRelationInput = {
      [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc',
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.securityEvent.count({ where }),
      this.prisma.securityEvent.findMany({ where, skip, take: limit, orderBy }),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async findDataAccessLogs(query: DataAccessLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.DataAccessLogWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.module) where.module = query.module;
    if (query.accessType) where.accessType = query.accessType;
    if (query.recordType) where.recordType = query.recordType;
    if (query.recordId) where.recordId = query.recordId;
    const range = this.buildDateRange(query.dateFrom, query.dateTo);
    if (range) where.createdAt = range;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { module: { contains: s, mode: 'insensitive' } },
        { recordType: { contains: s, mode: 'insensitive' } },
        { reason: { contains: s, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.DataAccessLogOrderByWithRelationInput = {
      [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc',
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.dataAccessLog.count({ where }),
      this.prisma.dataAccessLog.findMany({ where, skip, take: limit, orderBy }),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async findExportLogs(query: ExportLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.ExportLogWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.module) where.module = query.module;
    if (query.exportType) where.exportType = query.exportType;
    const range = this.buildDateRange(query.dateFrom, query.dateTo);
    if (range) where.createdAt = range;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { module: { contains: s, mode: 'insensitive' } },
        { fileName: { contains: s, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.ExportLogOrderByWithRelationInput = {
      [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc',
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.exportLog.count({ where }),
      this.prisma.exportLog.findMany({ where, skip, take: limit, orderBy }),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  }

  private buildDateRange(
    dateFrom?: string,
    dateTo?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!dateFrom && !dateTo) return undefined;

    const filter: Prisma.DateTimeFilter = {};

    if (dateFrom) {
      const start = new Date(dateFrom);
      if (Number.isNaN(start.getTime())) return undefined;
      start.setUTCHours(0, 0, 0, 0);
      filter.gte = start;
    }

    if (dateTo) {
      const end = new Date(dateTo);
      if (Number.isNaN(end.getTime())) return undefined;
      end.setUTCHours(23, 59, 59, 999);
      filter.lte = end;
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
  }
}
