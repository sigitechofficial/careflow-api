import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EcmAuditEventType,
  EcmScheduleChangeClass,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAuditService } from './ecm-audit.service';
import {
  deriveScheduleTimingFlags,
  suggestChangeClass,
} from './ecm-schedule-timing.util';
import { getOperationalTimeZone } from '../common/utils/operational-day.util';

export type RecordScheduleRevisionInput = {
  scheduledJobId: string;
  plannedStartDateTime: Date;
  plannedEndDateTime?: Date | null;
  previousStartDateTime: Date;
  previousEndDateTime?: Date | null;
  changedById?: string | null;
  changeClass?: EcmScheduleChangeClass | string;
  reasonCode?: string | null;
  reasonNote?: string | null;
  serviceUserAgreed?: boolean | null;
  serviceUserInformed?: boolean | null;
  commissionerAuthorised?: boolean | null;
  managerApproved?: boolean | null;
  managerApprovedById?: string | null;
  tx?: Prisma.TransactionClient;
};

/**
 * Append-only schedule version history (BE1.25–27 / GAP1).
 * Version 1 is always ORIGINAL and is never overwritten.
 */
@Injectable()
export class EcmScheduleVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EcmAuditService,
  ) {}

  async ensureOriginal(params: {
    scheduledJobId: string;
    plannedStartDateTime: Date;
    plannedEndDateTime?: Date | null;
    changedById?: string | null;
    tx?: Prisma.TransactionClient;
  }) {
    const client = params.tx ?? this.prisma;
    const existing = await client.ecmScheduleVersion.findFirst({
      where: { scheduledJobId: params.scheduledJobId, isOriginal: true },
    });
    if (existing) return existing;

    const created = await client.ecmScheduleVersion.create({
      data: {
        scheduledJobId: params.scheduledJobId,
        versionNumber: 1,
        isOriginal: true,
        changeClass: EcmScheduleChangeClass.ORIGINAL,
        plannedStartDateTime: params.plannedStartDateTime,
        plannedEndDateTime: params.plannedEndDateTime ?? null,
        changedById: params.changedById ?? null,
        beforeDueTime: true,
        lateNotice: false,
        retrospective: false,
      },
    });

    await this.audit.append({
      tx: params.tx,
      eventType: EcmAuditEventType.SCHEDULE_VERSION_CREATED,
      scheduledJobId: params.scheduledJobId,
      actorUserId: params.changedById,
      summary: 'Original schedule version recorded',
      detail: {
        versionNumber: 1,
        plannedStartDateTime: params.plannedStartDateTime.toISOString(),
        plannedEndDateTime: params.plannedEndDateTime?.toISOString() ?? null,
      },
    });

    return created;
  }

  async recordTimeChange(input: RecordScheduleRevisionInput) {
    const startSame =
      input.plannedStartDateTime.getTime() === input.previousStartDateTime.getTime();
    const endSame =
      (input.plannedEndDateTime?.getTime() ?? null) ===
      (input.previousEndDateTime?.getTime() ?? null);
    if (startSame && endSame) {
      return this.ensureOriginal({
        scheduledJobId: input.scheduledJobId,
        plannedStartDateTime: input.plannedStartDateTime,
        plannedEndDateTime: input.plannedEndDateTime,
        changedById: input.changedById,
        tx: input.tx,
      });
    }

    await this.ensureOriginal({
      scheduledJobId: input.scheduledJobId,
      plannedStartDateTime: input.previousStartDateTime,
      plannedEndDateTime: input.previousEndDateTime,
      changedById: input.changedById,
      tx: input.tx,
    });

    const client = input.tx ?? this.prisma;
    const changedAt = new Date();
    const orgSettings = await this.prisma.organisationGeneralSettings.findFirst({
      select: { timezone: true },
    });
    const flags = deriveScheduleTimingFlags(
      input.previousStartDateTime,
      changedAt,
      input.plannedStartDateTime,
      undefined,
      getOperationalTimeZone(orgSettings?.timezone),
    );

    let changeClass: EcmScheduleChangeClass =
      (input.changeClass as EcmScheduleChangeClass) ||
      (suggestChangeClass(flags) as EcmScheduleChangeClass);

    if (flags.retrospective && changeClass === EcmScheduleChangeClass.PLANNED) {
      changeClass = EcmScheduleChangeClass.RETROSPECTIVE;
    } else if (flags.lateNotice && changeClass === EcmScheduleChangeClass.PLANNED) {
      changeClass = EcmScheduleChangeClass.LATE_NOTICE;
    } else if (flags.sameDay && changeClass === EcmScheduleChangeClass.PLANNED) {
      changeClass = EcmScheduleChangeClass.SAME_DAY;
    }

    if (
      changeClass === EcmScheduleChangeClass.RETROSPECTIVE &&
      input.managerApproved !== true
    ) {
      // Still record the revision; FE/API can gate approval separately.
      // Do not block operational time moves — flag for manager review.
    }

    const latest = await client.ecmScheduleVersion.findFirst({
      where: { scheduledJobId: input.scheduledJobId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const created = await client.ecmScheduleVersion.create({
      data: {
        scheduledJobId: input.scheduledJobId,
        versionNumber,
        isOriginal: false,
        changeClass,
        plannedStartDateTime: input.plannedStartDateTime,
        plannedEndDateTime: input.plannedEndDateTime ?? null,
        previousStartDateTime: input.previousStartDateTime,
        previousEndDateTime: input.previousEndDateTime ?? null,
        reasonCode: input.reasonCode?.trim() || null,
        reasonNote: input.reasonNote?.trim() || null,
        changedById: input.changedById ?? null,
        changedAt,
        serviceUserAgreed: input.serviceUserAgreed ?? null,
        serviceUserInformed: input.serviceUserInformed ?? null,
        informedAt: input.serviceUserInformed ? changedAt : null,
        agreedAt: input.serviceUserAgreed ? changedAt : null,
        beforeDueTime: flags.beforeDueTime,
        lateNotice: flags.lateNotice,
        retrospective: flags.retrospective,
        managerApproved: input.managerApproved ?? null,
        managerApprovedById: input.managerApprovedById ?? null,
        managerApprovedAt: input.managerApproved === true ? changedAt : null,
        commissionerAuthorised: input.commissionerAuthorised ?? null,
      },
    });

    await this.audit.append({
      tx: input.tx,
      eventType: EcmAuditEventType.SCHEDULE_VERSION_CREATED,
      scheduledJobId: input.scheduledJobId,
      actorUserId: input.changedById,
      summary: `Schedule revision v${versionNumber} (${changeClass})`,
      detail: {
        versionNumber,
        changeClass,
        lateNotice: flags.lateNotice,
        retrospective: flags.retrospective,
        plannedStartDateTime: input.plannedStartDateTime.toISOString(),
        previousStartDateTime: input.previousStartDateTime.toISOString(),
        reasonCode: input.reasonCode ?? null,
      },
    });

    return created;
  }

  async listForJob(scheduledJobId: string) {
    const rows = await this.prisma.ecmScheduleVersion.findMany({
      where: { scheduledJobId },
      orderBy: { versionNumber: 'asc' },
    });
    const originalRow = rows.find((r) => r.isOriginal) ?? rows[0] ?? null;
    const currentRow = rows[rows.length - 1] ?? null;
    return {
      data: {
        scheduledJobId,
        original: originalRow ? this.mapVersion(originalRow) : null,
        current: currentRow ? this.mapVersion(currentRow) : null,
        versions: rows.map((r) => this.mapVersion(r)),
      },
    };
  }

  async approveRetrospective(
    versionId: string,
    managerUserId: string,
    note?: string,
  ) {
    const row = await this.prisma.ecmScheduleVersion.findUnique({
      where: { id: versionId },
    });
    if (!row) throw new BadRequestException('Schedule version not found');
    if (!row.retrospective) {
      throw new BadRequestException('Only retrospective changes require manager approval');
    }
    // Immutable versions: record approval via a new audit + update approval fields only.
    // Enterprise compromise: approval metadata may be set once (null → true).
    if (row.managerApproved === true) {
      return row;
    }
    const updated = await this.prisma.ecmScheduleVersion.update({
      where: { id: versionId },
      data: {
        managerApproved: true,
        managerApprovedById: managerUserId,
        managerApprovedAt: new Date(),
        reasonNote: note?.trim()
          ? `${row.reasonNote ? `${row.reasonNote}\n` : ''}Approved: ${note.trim()}`
          : row.reasonNote,
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.MANUAL_OVERRIDE,
      scheduledJobId: row.scheduledJobId,
      actorUserId: managerUserId,
      summary: `Retrospective schedule change v${row.versionNumber} approved`,
      detail: { versionId, note: note ?? null },
    });
    return updated;
  }

  private mapVersion(r: {
    id: string;
    scheduledJobId: string;
    versionNumber: number;
    isOriginal: boolean;
    changeClass: EcmScheduleChangeClass;
    plannedStartDateTime: Date;
    plannedEndDateTime: Date | null;
    previousStartDateTime: Date | null;
    previousEndDateTime: Date | null;
    reasonCode: string | null;
    reasonNote: string | null;
    changedById: string | null;
    changedAt: Date;
    serviceUserAgreed: boolean | null;
    serviceUserInformed: boolean | null;
    informedAt: Date | null;
    agreedAt: Date | null;
    beforeDueTime: boolean;
    lateNotice: boolean;
    retrospective: boolean;
    managerApproved: boolean | null;
    managerApprovedById: string | null;
    managerApprovedAt: Date | null;
    commissionerAuthorised: boolean | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      scheduledJobId: r.scheduledJobId,
      versionNumber: r.versionNumber,
      isOriginal: r.isOriginal,
      changeClass: r.changeClass,
      plannedStartDateTime: r.plannedStartDateTime.toISOString(),
      plannedEndDateTime: r.plannedEndDateTime?.toISOString() ?? null,
      previousStartDateTime: r.previousStartDateTime?.toISOString() ?? null,
      previousEndDateTime: r.previousEndDateTime?.toISOString() ?? null,
      reasonCode: r.reasonCode,
      reasonNote: r.reasonNote,
      changedById: r.changedById,
      changedAt: r.changedAt.toISOString(),
      serviceUserAgreed: r.serviceUserAgreed,
      serviceUserInformed: r.serviceUserInformed,
      informedAt: r.informedAt?.toISOString() ?? null,
      agreedAt: r.agreedAt?.toISOString() ?? null,
      beforeDueTime: r.beforeDueTime,
      lateNotice: r.lateNotice,
      retrospective: r.retrospective,
      managerApproved: r.managerApproved,
      managerApprovedById: r.managerApprovedById,
      managerApprovedAt: r.managerApprovedAt?.toISOString() ?? null,
      commissionerAuthorised: r.commissionerAuthorised,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
