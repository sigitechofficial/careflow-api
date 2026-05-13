import { Injectable, NotFoundException } from '@nestjs/common';
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

  private db(tx?: Prisma.TransactionClient): Db {
    return tx ?? this.prisma;
  }

  async logAudit(params: LogAuditParams) {
    const client = this.db(params.tx);
    return client.auditLog.create({
      data: {
        userId: params.userId ?? undefined,
        module: params.module,
        action: params.action,
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
    });
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

  async findAuditLogs(query: AuditLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.AuditLogWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.module) where.module = query.module;
    if (query.action) where.action = query.action;
    if (query.recordType) where.recordType = query.recordType;
    if (query.recordId) where.recordId = query.recordId;
    if (query.status) where.status = query.status;
    const range = this.buildDateRange(query.dateFrom, query.dateTo);
    if (range) where.createdAt = range;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { action: { contains: s, mode: 'insensitive' } },
        { module: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.AuditLogOrderByWithRelationInput = {
      [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc',
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, skip, take: limit, orderBy }),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async findAuditLogById(id: string) {
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Audit log not found');
    return { data: row };
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
    const f = dateFrom ? new Date(dateFrom) : undefined;
    const t = dateTo ? new Date(dateTo) : undefined;
    if (f && Number.isNaN(f.getTime())) return undefined;
    if (t && Number.isNaN(t.getTime())) return undefined;
    return {
      ...(f ? { gte: f } : {}),
      ...(t ? { lte: t } : {}),
    };
  }
}
