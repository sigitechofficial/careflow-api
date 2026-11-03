import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CarePlanReviewFlagStatus,
  CarePlanRiskLinkStatus,
  InitialAssessmentRiskStatus,
  Prisma,
  ServiceUserCarePlanLifecycleStatus,
} from '@prisma/client';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { PrismaService } from '../prisma/prisma.service';

const riskSelect = {
  id: true,
  submissionId: true,
  serviceUserId: true,
  riskType: true,
  description: true,
  riskLevel: true,
  severity: true,
  likelihood: true,
  controlMeasures: true,
  status: true,
  supersededBySubmissionId: true,
  supersedeReviewRequired: true,
  createdAt: true,
} satisfies Prisma.InitialAssessmentRiskRecordSelect;

type RiskRow = Prisma.InitialAssessmentRiskRecordGetPayload<{
  select: typeof riskSelect;
}>;

function riskSnapshot(r: RiskRow) {
  return {
    riskLevel: r.riskLevel,
    severity: r.severity,
    likelihood: r.likelihood,
    controlMeasures: r.controlMeasures,
    status: r.status,
  };
}

function mapRisk(r: RiskRow) {
  return {
    id: r.id,
    submissionId: r.submissionId,
    riskType: r.riskType,
    description: r.description,
    riskLevel: r.riskLevel,
    severity: r.severity,
    controlMeasures: r.controlMeasures,
    status: r.status,
    supersedeReviewRequired: r.supersedeReviewRequired,
    supersededBySubmissionId: r.supersededBySubmissionId,
  };
}

/**
 * Links existing initial assessment risk records to the care plan that controls them, and handles
 * reassessment review flags. Risk records are never created, changed or closed here.
 */
@Injectable()
export class CarePlanRiskLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async getRisks(serviceUserId: string, carePathwayFormId: string) {
    const instance = await this.findInstance(serviceUserId, carePathwayFormId);
    if (!instance) return { data: null };
    const [links, risks, flags] = await Promise.all([
      this.prisma.carePlanRiskLink.findMany({
        where: { carePlanInstanceId: instance.id },
        orderBy: { linkedAt: 'asc' },
        include: { riskRecord: { select: riskSelect } },
      }),
      this.prisma.initialAssessmentRiskRecord.findMany({
        where: {
          serviceUserId,
          status: { not: InitialAssessmentRiskStatus.CLOSED },
        },
        orderBy: [{ riskLevel: 'desc' }, { createdAt: 'desc' }],
        select: riskSelect,
      }),
      this.prisma.carePlanReassessmentFlag.findMany({
        where: { carePlanInstanceId: instance.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    const linkedIds = new Set(links.map((l) => l.riskRecordId));
    return {
      data: {
        instanceId: instance.id,
        links: links.map((l) => ({
          id: l.id,
          status: l.status,
          reviewReason: l.reviewReason,
          linkedAt: l.linkedAt.toISOString(),
          reviewedAt: l.reviewedAt?.toISOString() ?? null,
          snapshot: l.riskSnapshotJson,
          risk: mapRisk(l.riskRecord),
        })),
        /** Open / controlled risks of this service user not linked to this plan (to choose from). */
        availableRisks: risks.filter((r) => !linkedIds.has(r.id)).map(mapRisk),
        reassessmentFlags: flags.map((f) => ({
          id: f.id,
          status: f.status,
          changeTypes: f.changeTypes,
          reason: f.reason,
          triggeringSubmissionId: f.triggeringSubmissionId,
          createdAt: f.createdAt.toISOString(),
          resolvedAt: f.resolvedAt?.toISOString() ?? null,
          resolutionNote: f.resolutionNote,
        })),
      },
    };
  }

  async linkRisk(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    riskRecordId: string,
    meta?: RequestAuditMeta,
  ) {
    const instance = await this.findWritableInstance(
      serviceUserId,
      carePathwayFormId,
    );
    // Same service user only; closed risks are history, not something a plan controls now.
    const risk = await this.prisma.initialAssessmentRiskRecord.findFirst({
      where: { id: riskRecordId, serviceUserId },
      select: riskSelect,
    });
    if (!risk)
      throw new BadRequestException(
        'That risk is not recorded for this service user.',
      );
    if (risk.status === InitialAssessmentRiskStatus.CLOSED) {
      throw new BadRequestException(
        'That risk is closed and cannot be linked.',
      );
    }
    try {
      const link = await this.prisma.carePlanRiskLink.create({
        data: {
          serviceUserId,
          carePlanInstanceId: instance.id,
          riskRecordId: risk.id,
          riskSnapshotJson: riskSnapshot(risk),
          linkedById: userId,
        },
      });
      await this.log(
        userId,
        AuditAction.CARE_PLAN_RISK_LINKED,
        link.id,
        instance.id,
        serviceUserId,
        null,
        {
          riskRecordId: risk.id,
          riskType: risk.riskType,
          snapshot: riskSnapshot(risk),
        },
        meta,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This risk is already linked to this care plan.',
        );
      }
      throw error;
    }
    return this.getRisks(serviceUserId, carePathwayFormId);
  }

  async unlinkRisk(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    linkId: string,
    meta?: RequestAuditMeta,
  ) {
    const instance = await this.findWritableInstance(
      serviceUserId,
      carePathwayFormId,
    );
    const link = await this.prisma.carePlanRiskLink.findFirst({
      where: { id: linkId, carePlanInstanceId: instance.id },
    });
    if (!link) throw new NotFoundException('Care plan risk link not found');
    await this.prisma.carePlanRiskLink.delete({ where: { id: link.id } });
    await this.log(
      userId,
      AuditAction.CARE_PLAN_RISK_UNLINKED,
      link.id,
      instance.id,
      serviceUserId,
      link,
      { removed: true },
      meta,
    );
    return this.getRisks(serviceUserId, carePathwayFormId);
  }

  /** The manager confirms the care plan's controls still fit the (changed) risk. */
  async reviewRiskLink(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    linkId: string,
    meta?: RequestAuditMeta,
  ) {
    const instance = await this.findWritableInstance(
      serviceUserId,
      carePathwayFormId,
    );
    const link = await this.prisma.carePlanRiskLink.findFirst({
      where: { id: linkId, carePlanInstanceId: instance.id },
      include: { riskRecord: { select: riskSelect } },
    });
    if (!link) throw new NotFoundException('Care plan risk link not found');
    const updated = await this.prisma.carePlanRiskLink.update({
      where: { id: link.id },
      data: {
        status: CarePlanRiskLinkStatus.LINKED,
        reviewReason: null,
        riskSnapshotJson: riskSnapshot(link.riskRecord),
        reviewedById: userId,
        reviewedAt: new Date(),
      },
    });
    await this.log(
      userId,
      AuditAction.CARE_PLAN_RISK_REVIEWED,
      link.id,
      instance.id,
      serviceUserId,
      {
        status: link.status,
        snapshot: link.riskSnapshotJson,
        reviewReason: link.reviewReason,
      },
      { status: updated.status, snapshot: updated.riskSnapshotJson },
      meta,
    );
    return this.getRisks(serviceUserId, carePathwayFormId);
  }

  /** Close a reassessment review flag once the manager has reviewed the plan (note required). */
  async resolveReassessmentFlag(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    flagId: string,
    note: string,
    meta?: RequestAuditMeta,
  ) {
    const text = note?.trim() ?? '';
    if (text.length < 3)
      throw new BadRequestException(
        'Say what was reviewed (min 3 characters).',
      );
    const instance = await this.findInstance(serviceUserId, carePathwayFormId);
    if (!instance) throw new NotFoundException('Care plan not found');
    const flag = await this.prisma.carePlanReassessmentFlag.findFirst({
      where: { id: flagId, carePlanInstanceId: instance.id },
    });
    if (!flag) throw new NotFoundException('Review flag not found');
    const changed = await this.prisma.carePlanReassessmentFlag.updateMany({
      where: { id: flag.id, status: CarePlanReviewFlagStatus.OPEN },
      data: {
        status: CarePlanReviewFlagStatus.RESOLVED,
        resolvedById: userId,
        resolvedAt: new Date(),
        resolutionNote: text,
      },
    });
    if (changed.count !== 1)
      throw new ConflictException('This review flag is already resolved.');
    await this.log(
      userId,
      AuditAction.CARE_PLAN_REASSESSMENT_RESOLVED,
      flag.id,
      instance.id,
      serviceUserId,
      { status: flag.status },
      {
        status: CarePlanReviewFlagStatus.RESOLVED,
        note: text,
        triggeringSubmissionId: flag.triggeringSubmissionId,
      },
      meta,
      'CarePlanReassessmentFlag',
    );
    return this.getRisks(serviceUserId, carePathwayFormId);
  }

  private findInstance(serviceUserId: string, carePathwayFormId: string) {
    return this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      select: { id: true, lifecycleStatus: true },
    });
  }

  private async findWritableInstance(
    serviceUserId: string,
    carePathwayFormId: string,
  ) {
    const instance = await this.findInstance(serviceUserId, carePathwayFormId);
    if (!instance) throw new NotFoundException('Care plan not found');
    if (
      instance.lifecycleStatus === ServiceUserCarePlanLifecycleStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        'This care plan is archived; its risk links are read-only.',
      );
    }
    return instance;
  }

  private log(
    userId: string,
    action: AuditAction,
    recordId: string,
    instanceId: string,
    serviceUserId: string,
    oldValues: object | null,
    newValues: object,
    meta?: RequestAuditMeta,
    recordType = 'CarePlanRiskLink',
  ) {
    return this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PLAN,
      action,
      recordType,
      recordId,
      ...(oldValues ? { oldValues: oldValues } : {}),
      newValues: newValues,
      metadata: { serviceUserId, carePlanInstanceId: instanceId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }
}
