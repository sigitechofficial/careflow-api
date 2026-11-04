import { Injectable, Logger } from '@nestjs/common';
import {
  CarePlanRiskLinkStatus,
  InitialAssessmentRiskStatus,
  InitialAssessmentStatus,
  Prisma,
  ServiceUserCarePlanInstanceStatus,
  ServiceUserCarePlanLifecycleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { InitialAssessmentCarePlanRulesService } from './initial-assessment-care-plan-rules.service';
import { computeReassessmentFlags } from './care-plan-reassessment.util';

const ASSESSED = [
  InitialAssessmentStatus.SUBMITTED,
  InitialAssessmentStatus.REVIEWED,
];

/**
 * After an initial assessment is submitted or reviewed: flag the service user's active care plans
 * that it affects, and mark earlier open risks of the same type for an authorised decision. Never
 * changes, archives or publishes a care plan, and never closes a risk.
 */
@Injectable()
export class CarePlanReassessmentService {
  private readonly logger = new Logger(CarePlanReassessmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly carePlanRules: InitialAssessmentCarePlanRulesService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Never throws: the assessment action has already succeeded. */
  async onAssessmentCompleted(submissionId: string, userId: string) {
    try {
      return await this.run(submissionId, userId);
    } catch (error) {
      this.logger.warn(
        `Reassessment review for submission ${submissionId} failed: ${String(error)}`,
      );
      return { flagged: 0, risksForReview: 0, error: String(error) };
    }
  }

  private async run(submissionId: string, userId: string) {
    const submission = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { id: submissionId, deletedAt: null, status: { in: ASSESSED } },
      select: {
        id: true,
        serviceUserId: true,
        submittedAt: true,
        createdAt: true,
      },
    });
    if (!submission) return { flagged: 0, risksForReview: 0 };
    const at = submission.submittedAt ?? submission.createdAt;
    const previous = await this.prisma.initialAssessmentSubmission.findFirst({
      where: {
        serviceUserId: submission.serviceUserId,
        id: { not: submission.id },
        deletedAt: null,
        status: { in: [...ASSESSED, InitialAssessmentStatus.ARCHIVED] },
        submittedAt: { lt: at },
      },
      orderBy: { submittedAt: 'desc' },
      select: { id: true },
    });

    const risksForReview = previous
      ? await this.markSupersededRisks(submission, userId)
      : 0;

    const plans = await this.prisma.serviceUserCarePlanInstance.findMany({
      where: {
        serviceUserId: submission.serviceUserId,
        status: ServiceUserCarePlanInstanceStatus.PUBLISHED,
        lifecycleStatus: ServiceUserCarePlanLifecycleStatus.ACTIVE,
        // Only plans carers actually work to (some records are PUBLISHED with no version).
        publishedVersions: { some: {} },
      },
      select: {
        id: true,
        carePathwayFormId: true,
        carePathwayForm: { select: { name: true } },
        riskLinks: { select: { riskRecord: { select: { riskType: true } } } },
      },
    });
    if (!plans.length) return { flagged: 0, risksForReview };

    const loadRisks = (id: string) =>
      this.prisma.initialAssessmentRiskRecord.findMany({
        where: { submissionId: id },
        select: { riskType: true, riskLevel: true },
      });
    const [currentRecs, currentRisks] = await Promise.all([
      this.carePlanRules.loadRecommendations(submission.id),
      loadRisks(submission.id),
    ]);
    const prev = previous
      ? {
          recommendations: await this.carePlanRules.loadRecommendations(
            previous.id,
          ),
          risks: await loadRisks(previous.id),
        }
      : null;

    const drafts = computeReassessmentFlags({
      plans: plans.map((p) => ({
        instanceId: p.id,
        carePathwayFormId: p.carePathwayFormId,
        formName: p.carePathwayForm.name,
        linkedRiskTypes: [
          ...new Set(p.riskLinks.map((l) => l.riskRecord.riskType)),
        ],
      })),
      current: { recommendations: currentRecs, risks: currentRisks },
      previous: prev,
    });

    let flagged = 0;
    for (const draft of drafts) {
      try {
        const flag = await this.prisma.carePlanReassessmentFlag.create({
          data: {
            serviceUserId: submission.serviceUserId,
            carePlanInstanceId: draft.instanceId,
            triggeringSubmissionId: submission.id,
            previousSubmissionId: previous?.id ?? null,
            changeTypes: draft.changeTypes,
            reason: draft.reason,
            detailsJson: draft.details as Prisma.InputJsonValue,
          },
        });
        flagged++;
        await this.audit.logAudit({
          userId,
          module: AuditModule.CARE_PLAN,
          action: AuditAction.CARE_PLAN_REASSESSMENT_FLAGGED,
          recordType: 'CarePlanReassessmentFlag',
          recordId: flag.id,
          newValues: {
            changeTypes: draft.changeTypes,
            reason: draft.reason,
            triggeringSubmissionId: submission.id,
          },
          metadata: {
            serviceUserId: submission.serviceUserId,
            carePlanInstanceId: draft.instanceId,
          },
        });
      } catch (error) {
        // Same plan already flagged for this assessment (submit then review): keep the first flag.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          continue;
        throw error;
      }
    }
    return { flagged, risksForReview };
  }

  /**
   * Earlier OPEN / CONTROLLED risks of a type the new assessment records again need an authorised
   * decision (keep, control or close). Their status is not changed; linked care plans are flagged.
   */
  private async markSupersededRisks(
    submission: { id: string; serviceUserId: string },
    userId: string,
  ) {
    const newTypes = await this.prisma.initialAssessmentRiskRecord.findMany({
      where: { submissionId: submission.id },
      select: { riskType: true },
      distinct: ['riskType'],
    });
    if (!newTypes.length) return 0;
    const older = await this.prisma.initialAssessmentRiskRecord.findMany({
      where: {
        serviceUserId: submission.serviceUserId,
        submissionId: { not: submission.id },
        status: {
          in: [
            InitialAssessmentRiskStatus.OPEN,
            InitialAssessmentRiskStatus.CONTROLLED,
          ],
        },
        riskType: { in: newTypes.map((t) => t.riskType) },
        supersedeReviewRequired: false,
      },
      select: { id: true, riskType: true, status: true },
    });
    if (!older.length) return 0;
    const ids = older.map((r) => r.id);
    await this.prisma.$transaction([
      this.prisma.initialAssessmentRiskRecord.updateMany({
        where: { id: { in: ids }, supersedeReviewRequired: false },
        data: {
          supersededBySubmissionId: submission.id,
          supersedeReviewRequired: true,
        },
      }),
      this.prisma.carePlanRiskLink.updateMany({
        where: { riskRecordId: { in: ids } },
        data: {
          status: CarePlanRiskLinkStatus.REVIEW_REQUIRED,
          reviewReason:
            'A newer assessment recorded this risk again — check the controls in this care plan.',
        },
      }),
    ]);
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_RISKS_SUPERSEDE_REVIEW,
      recordType: 'InitialAssessmentSubmission',
      recordId: submission.id,
      newValues: {
        riskRecordIds: ids,
        riskTypes: [...new Set(older.map((r) => r.riskType))],
        statusUnchanged: true,
      },
      metadata: { serviceUserId: submission.serviceUserId },
    });
    return ids.length;
  }
}
