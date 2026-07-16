import { Injectable, Logger } from '@nestjs/common';
import { EcmAuditEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type EcmAuditAppendInput = {
  eventType: EcmAuditEventType;
  summary: string;
  scheduledJobId?: string | null;
  ecmExceptionId?: string | null;
  actorUserId?: string | null;
  detail?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
};

/**
 * Immutable ECM audit trail (BE1.14). Append-only — never update/delete.
 */
@Injectable()
export class EcmAuditService {
  private readonly logger = new Logger(EcmAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(input: EcmAuditAppendInput): Promise<void> {
    const client = input.tx ?? this.prisma;
    try {
      await client.ecmAuditEvent.create({
        data: {
          eventType: input.eventType,
          summary: input.summary,
          scheduledJobId: input.scheduledJobId ?? null,
          ecmExceptionId: input.ecmExceptionId ?? null,
          actorUserId: input.actorUserId ?? null,
          detail: input.detail ?? undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `ECM audit append failed type=${input.eventType}: ${(err as Error).message}`,
      );
    }
  }

  async listForJob(scheduledJobId: string, limit = 100) {
    const rows = await this.prisma.ecmAuditEvent.findMany({
      where: { scheduledJobId },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 200),
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        scheduledJobId: r.scheduledJobId,
        ecmExceptionId: r.ecmExceptionId,
        eventType: r.eventType,
        actorUserId: r.actorUserId,
        summary: r.summary,
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
