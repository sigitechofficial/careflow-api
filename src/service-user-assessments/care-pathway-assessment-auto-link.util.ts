import { CarePathwayFormType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { getCarePathwayAutoLinkCarePlanNames } from './care-pathway-assessment-registry';

export type AutoLinkedCarePlan = {
  linkId: string;
  carePlanFormId: string;
  carePlanFormName: string;
};

export async function autoLinkCarePathwayAssessmentCompletion(
  prisma: PrismaService,
  audit: AuditLogsService,
  params: {
    userId: string;
    serviceUserId: string;
    completionId: string;
    carePathwayFormName: string;
    assessmentKey: string;
    meta?: RequestAuditMeta;
  },
): Promise<AutoLinkedCarePlan[]> {
  const targetNames = getCarePathwayAutoLinkCarePlanNames(params.carePathwayFormName);
  if (!targetNames.length) return [];

  const carePlans = await prisma.carePathwayForm.findMany({
    where: {
      name: { in: targetNames },
      formType: CarePathwayFormType.CARE_PLAN,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (!carePlans.length) return [];

  const linked: AutoLinkedCarePlan[] = [];

  for (const plan of carePlans) {
    const existing = await prisma.carePlanAssessmentLink.findFirst({
      where: {
        serviceUserId: params.serviceUserId,
        carePlanFormId: plan.id,
        completionId: params.completionId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existing) {
      linked.push({
        linkId: existing.id,
        carePlanFormId: plan.id,
        carePlanFormName: plan.name,
      });
      continue;
    }

    const created = await prisma.carePlanAssessmentLink.create({
      data: {
        serviceUserId: params.serviceUserId,
        carePlanFormId: plan.id,
        completionId: params.completionId,
        linkedById: params.userId,
      },
      select: { id: true },
    });

    await audit.logAudit({
      userId: params.userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.ASSESSMENT_LINKED,
      recordType: 'CarePlanAssessmentLink',
      recordId: created.id,
      newValues: auditSnapshot({
        completionId: params.completionId,
        carePlanFormId: plan.id,
        assessmentKey: params.assessmentKey,
        autoLinked: true,
      }),
      metadata: {
        serviceUserId: params.serviceUserId,
        completionId: params.completionId,
        carePlanFormId: plan.id,
        carePlanFormName: plan.name,
        assessmentKey: params.assessmentKey,
        autoLinked: true,
        carePathwayFormName: params.carePathwayFormName,
      },
      ...params.meta,
    });

    linked.push({
      linkId: created.id,
      carePlanFormId: plan.id,
      carePlanFormName: plan.name,
    });
  }

  return linked;
}
