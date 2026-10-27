import { Prisma, VisitPlanStatus } from '@prisma/client';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';

/** Visit plans whose weekly hours follow the DOM Care value (ended plans keep their history). */
const OPEN_VISIT_PLAN_STATUSES: VisitPlanStatus[] = [
  VisitPlanStatus.DRAFT,
  VisitPlanStatus.ACTIVE,
  VisitPlanStatus.SUSPENDED,
];

/**
 * DOM Care and the service user's open visit plans hold the same weekly contracted hours.
 * After either one is saved, copy the value to the others. Clearing a value is not copied,
 * so a visit plan never loses its hours because the DOM Care field was emptied.
 */
export async function syncServiceUserWeeklyHours(
  tx: Prisma.TransactionClient,
  audit: AuditLogsService,
  params: {
    serviceUserId: string;
    value: string | null | undefined;
    userId: string;
    /** Where the change was made (that record is already saved), a manager approval, or a change settings let through without one. */
    source: 'dom_care' | 'visit_plan' | 'approval' | 'direct';
    sourceVisitPlanId?: string;
    meta?: RequestAuditMeta;
  },
): Promise<void> {
  const value = params.value?.trim();
  if (!value) return;
  const metadata = {
    serviceUserId: params.serviceUserId,
    syncedFrom: params.source,
    ...(params.sourceVisitPlanId
      ? { sourceVisitPlanId: params.sourceVisitPlanId }
      : {}),
  };

  if (params.source !== 'dom_care') {
    const dom = await tx.serviceUserDomCare.findUnique({
      where: { serviceUserId: params.serviceUserId },
      select: { id: true, weeklyContractedHours: true },
    });
    if (dom?.weeklyContractedHours?.trim() !== value) {
      const saved = dom
        ? await tx.serviceUserDomCare.update({
            where: { id: dom.id },
            data: { weeklyContractedHours: value, updatedById: params.userId },
            select: { id: true },
          })
        : await tx.serviceUserDomCare.create({
            data: {
              serviceUserId: params.serviceUserId,
              weeklyContractedHours: value,
              numberOfCarers: 1,
              createdById: params.userId,
            },
            select: { id: true },
          });
      await audit.logAudit({
        tx,
        userId: params.userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOM_CARE_UPDATED,
        recordType: 'ServiceUserDomCare',
        recordId: saved.id,
        oldValues: {
          weeklyContractedHours: dom?.weeklyContractedHours ?? null,
        },
        newValues: { weeklyContractedHours: value },
        metadata,
        ipAddress: params.meta?.ipAddress ?? undefined,
        userAgent: params.meta?.userAgent ?? undefined,
      });
    }
  }

  const plans = await tx.serviceUserVisitPlan.findMany({
    where: {
      serviceUserId: params.serviceUserId,
      deletedAt: null,
      status: { in: OPEN_VISIT_PLAN_STATUSES },
      ...(params.sourceVisitPlanId
        ? { id: { not: params.sourceVisitPlanId } }
        : {}),
    },
    select: { id: true, weeklyContractedHours: true },
  });
  for (const plan of plans) {
    if (plan.weeklyContractedHours?.trim() === value) continue;
    await tx.serviceUserVisitPlan.update({
      where: { id: plan.id },
      data: { weeklyContractedHours: value, updatedById: params.userId },
    });
    await audit.logAudit({
      tx,
      userId: params.userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_VISIT_PLAN_UPDATED,
      recordType: 'ServiceUserVisitPlan',
      recordId: plan.id,
      oldValues: { weeklyContractedHours: plan.weeklyContractedHours ?? null },
      newValues: { weeklyContractedHours: value },
      metadata,
      ipAddress: params.meta?.ipAddress ?? undefined,
      userAgent: params.meta?.userAgent ?? undefined,
    });
  }
}

/**
 * The service user's weekly contracted hours as they stand now: DOM Care, else the newest
 * open visit plan. Null when none is set yet.
 */
export async function currentServiceUserWeeklyHours(
  client: Prisma.TransactionClient,
  serviceUserId: string,
): Promise<string | null> {
  const dom = await client.serviceUserDomCare.findUnique({
    where: { serviceUserId },
    select: { weeklyContractedHours: true },
  });
  const domValue = dom?.weeklyContractedHours?.trim();
  if (domValue) return domValue;
  const plan = await client.serviceUserVisitPlan.findFirst({
    where: {
      serviceUserId,
      deletedAt: null,
      status: { in: OPEN_VISIT_PLAN_STATUSES },
      weeklyContractedHours: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: { weeklyContractedHours: true },
  });
  return plan?.weeklyContractedHours?.trim() || null;
}

/** True when two weekly-hours values mean the same number ("16" and "16.00"). */
export function sameWeeklyHours(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (x === y) return true;
  const nx = Number.parseFloat(x);
  const ny = Number.parseFloat(y);
  return Number.isFinite(nx) && Number.isFinite(ny) && Math.abs(nx - ny) < 0.001;
}

export const SERVICE_USER_HOURS_NEED_APPROVAL_MESSAGE =
  'Weekly contracted hours can only be changed through a manager-approved request. Send it for review instead.';
