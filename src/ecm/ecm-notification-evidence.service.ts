import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EcmAuditEventType,
  EcmNotificationMethod,
  EcmNotificationOutcome,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAuditService } from './ecm-audit.service';

export type CreateNotificationEvidenceInput = {
  scheduledJobId: string;
  ecmExceptionId?: string | null;
  contactedByUserId: string;
  contactName?: string;
  contactRole?: string;
  method: EcmNotificationMethod | string;
  outcome?: EcmNotificationOutcome | string;
  attemptedAt?: string;
  answeredAt?: string;
  deliveredAt?: string;
  readAt?: string;
  etaGiven?: string;
  reasonGiven?: string;
  replacementDetails?: string;
  acceptedDeclined?: string;
  proofUrl?: string;
  notes?: string;
};

@Injectable()
export class EcmNotificationEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EcmAuditService,
  ) {}

  async create(input: CreateNotificationEvidenceInput) {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: input.scheduledJobId, deletedAt: null },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const row = await this.prisma.ecmNotificationEvidence.create({
      data: {
        scheduledJobId: input.scheduledJobId,
        ecmExceptionId: input.ecmExceptionId ?? null,
        contactedByUserId: input.contactedByUserId,
        contactName: input.contactName?.trim() || null,
        contactRole: input.contactRole?.trim() || null,
        method: input.method as EcmNotificationMethod,
        outcome:
          (input.outcome as EcmNotificationOutcome) ||
          EcmNotificationOutcome.ATTEMPTED,
        attemptedAt: input.attemptedAt ? new Date(input.attemptedAt) : new Date(),
        answeredAt: input.answeredAt ? new Date(input.answeredAt) : null,
        deliveredAt: input.deliveredAt ? new Date(input.deliveredAt) : null,
        readAt: input.readAt ? new Date(input.readAt) : null,
        etaGiven: input.etaGiven?.trim() || null,
        reasonGiven: input.reasonGiven?.trim() || null,
        replacementDetails: input.replacementDetails?.trim() || null,
        acceptedDeclined: input.acceptedDeclined?.trim() || null,
        proofUrl: input.proofUrl?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });

    await this.audit.append({
      eventType: EcmAuditEventType.NOTIFICATION_RECORDED,
      scheduledJobId: input.scheduledJobId,
      ecmExceptionId: input.ecmExceptionId,
      actorUserId: input.contactedByUserId,
      summary: `SU/family contact recorded via ${row.method} (${row.outcome})`,
      detail: {
        evidenceId: row.id,
        contactName: row.contactName,
        method: row.method,
        outcome: row.outcome,
        etaGiven: row.etaGiven,
      },
    });

    return { data: this.map(row) };
  }

  async listForJob(scheduledJobId: string) {
    const rows = await this.prisma.ecmNotificationEvidence.findMany({
      where: { scheduledJobId },
      orderBy: { attemptedAt: 'desc' },
    });
    return { data: rows.map((r) => this.map(r)) };
  }

  private map(r: {
    id: string;
    scheduledJobId: string;
    ecmExceptionId: string | null;
    contactedByUserId: string | null;
    contactName: string | null;
    contactRole: string | null;
    method: EcmNotificationMethod;
    outcome: EcmNotificationOutcome;
    attemptedAt: Date;
    answeredAt: Date | null;
    deliveredAt: Date | null;
    readAt: Date | null;
    etaGiven: string | null;
    reasonGiven: string | null;
    replacementDetails: string | null;
    acceptedDeclined: string | null;
    proofUrl: string | null;
    notes: string | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      scheduledJobId: r.scheduledJobId,
      ecmExceptionId: r.ecmExceptionId,
      contactedByUserId: r.contactedByUserId,
      contactName: r.contactName,
      contactRole: r.contactRole,
      method: r.method,
      outcome: r.outcome,
      attemptedAt: r.attemptedAt.toISOString(),
      answeredAt: r.answeredAt?.toISOString() ?? null,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      readAt: r.readAt?.toISOString() ?? null,
      etaGiven: r.etaGiven,
      reasonGiven: r.reasonGiven,
      replacementDetails: r.replacementDetails,
      acceptedDeclined: r.acceptedDeclined,
      proofUrl: r.proofUrl,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
