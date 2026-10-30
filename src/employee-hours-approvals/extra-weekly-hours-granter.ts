import type { Prisma } from '@prisma/client';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';

/**
 * Gives approved extra weekly hours (CarerExtraHoursService, which itself depends on the hours
 * approvals service). Looked up at run time under this token so the two services don't import
 * each other.
 */
export const EXTRA_WEEKLY_HOURS_GRANTER = 'EXTRA_WEEKLY_HOURS_GRANTER';

export interface ExtraWeeklyHoursGranter {
  applyApprovedRequest(
    userId: string,
    approval: Prisma.EmployeeHoursApprovalGetPayload<object>,
    meta?: RequestAuditMeta,
  ): Promise<{ message: string; data: { id: string } & Record<string, unknown> }>;
}
