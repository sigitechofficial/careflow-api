import { Injectable } from '@nestjs/common';
import { VisitPlanStatus } from '@prisma/client';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import type { ScheduleImpactResult } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { operationalDayBounds, operationalTodayIso } from '../common/utils/operational-day.util';
import {
  diffVisitPlanSnapshots,
  resolveEndFromStartAndTimes,
  type AmendmentImpactAction,
  type VisitPlanSnapshotShape,
} from './visit-plan-amendment-impact.util';

export type AmendmentImpactPreview = {
  actions: AmendmentImpactAction[];
  scheduleImpact: ScheduleImpactResult;
  truncated: boolean;
};

@Injectable()
export class VisitPlanAmendmentImpactService {
  constructor(
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  private async opsTodayStart(): Promise<Date> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    return operationalDayBounds(operationalTodayIso(new Date(), timeZone), timeZone).start;
  }

  async previewAmendmentImpact(params: {
    serviceUserId: string;
    planStatus: VisitPlanStatus;
    before: VisitPlanSnapshotShape;
    after: VisitPlanSnapshotShape;
  }): Promise<AmendmentImpactPreview> {
    const actions = diffVisitPlanSnapshots(params.before, params.after);
    if (params.planStatus !== VisitPlanStatus.ACTIVE) {
      return {
        actions,
        scheduleImpact: { jobsCancelled: 0, jobsUnallocated: 0, jobIds: [] },
        truncated: false,
      };
    }

    const from = await this.opsTodayStart();
    let jobsCancelled = 0;
    let jobsRescheduled = 0;
    const jobIds: string[] = [];
    let truncated = false;

    for (const action of actions) {
      if (action.type === 'cancel_slot_disabled') {
        const preview = await this.scheduleImpact.previewCancelScopedServiceUserJobs({
          serviceUserId: params.serviceUserId,
          fromDate: from,
          scope: { visitPlanSlotId: action.visitPlanSlotId },
        });
        action.jobCount = preview.jobsCancelled;
        jobsCancelled += preview.jobsCancelled;
        jobIds.push(...preview.jobIds);
        if (preview.truncated) truncated = true;
      } else if (action.type === 'cancel_weekdays_removed' && action.removedWeekdays?.length) {
        const preview = await this.scheduleImpact.previewCancelScopedServiceUserJobs({
          serviceUserId: params.serviceUserId,
          fromDate: from,
          scope: {
            visitPlanSlotId: action.visitPlanSlotId,
            weekdays: action.removedWeekdays,
          },
        });
        action.jobCount = preview.jobsCancelled;
        jobsCancelled += preview.jobsCancelled;
        jobIds.push(...preview.jobIds);
        if (preview.truncated) truncated = true;
      } else if (action.type === 'reschedule_time' && action.newStartTime && action.newEndTime) {
        const preview = await this.scheduleImpact.previewRescheduleSlotJobs({
          serviceUserId: params.serviceUserId,
          visitPlanSlotId: action.visitPlanSlotId,
          fromDate: from,
        });
        action.jobCount = preview.jobsRescheduled ?? 0;
        jobsRescheduled += preview.jobsRescheduled ?? 0;
        jobIds.push(...preview.jobIds);
        if (preview.truncated) truncated = true;
      } else if (action.type === 'skip_exception' && action.exceptionDate) {
        const timeZone = await this.orgSettings.getOperationalTimezone();
        const dayBounds = operationalDayBounds(action.exceptionDate, timeZone);
        const preview = await this.scheduleImpact.previewCancelScopedServiceUserJobs({
          serviceUserId: params.serviceUserId,
          fromDate: dayBounds.start,
          toDate: dayBounds.end,
          scope: { visitPlanSlotId: action.visitPlanSlotId },
        });
        action.jobCount = preview.jobsCancelled;
        jobsCancelled += preview.jobsCancelled;
        jobIds.push(...preview.jobIds);
      }
    }

    return {
      actions,
      scheduleImpact: {
        jobsCancelled,
        jobsUnallocated: 0,
        jobsRescheduled,
        jobIds: [...new Set(jobIds)],
        truncated,
      },
      truncated,
    };
  }

  async applyAmendmentImpact(
    userId: string,
    params: {
      serviceUserId: string;
      amendmentReason: string;
      before: VisitPlanSnapshotShape;
      after: VisitPlanSnapshotShape;
    },
    meta?: RequestAuditMeta,
  ): Promise<ScheduleImpactResult> {
    const preview = await this.previewAmendmentImpact({
      serviceUserId: params.serviceUserId,
      planStatus: VisitPlanStatus.ACTIVE,
      before: params.before,
      after: params.after,
    });

    const from = await this.opsTodayStart();
    let jobsCancelled = 0;
    let jobsRescheduled = 0;
    const jobIds: string[] = [];

    for (const action of preview.actions) {
      if (action.type === 'cancel_slot_disabled') {
        const result = await this.scheduleImpact.cancelScopedServiceUserJobs(userId, {
          serviceUserId: params.serviceUserId,
          fromDate: from,
          reason: params.amendmentReason,
          source: 'visit_plan_amendment',
          scope: { visitPlanSlotId: action.visitPlanSlotId },
        }, meta);
        jobsCancelled += result.jobsCancelled;
        jobIds.push(...result.jobIds);
      } else if (action.type === 'cancel_weekdays_removed' && action.removedWeekdays?.length) {
        const result = await this.scheduleImpact.cancelScopedServiceUserJobs(userId, {
          serviceUserId: params.serviceUserId,
          fromDate: from,
          reason: params.amendmentReason,
          source: 'visit_plan_amendment',
          scope: {
            visitPlanSlotId: action.visitPlanSlotId,
            weekdays: action.removedWeekdays,
          },
        }, meta);
        jobsCancelled += result.jobsCancelled;
        jobIds.push(...result.jobIds);
      } else if (action.type === 'reschedule_time' && action.newStartTime && action.newEndTime) {
        const result = await this.scheduleImpact.rescheduleSlotJobs(userId, {
          serviceUserId: params.serviceUserId,
          visitPlanSlotId: action.visitPlanSlotId,
          fromDate: from,
          resolveNewTimes: (jobStart) =>
            resolveEndFromStartAndTimes(jobStart, action.newStartTime!, action.newEndTime!),
          reason: params.amendmentReason,
          source: 'visit_plan_amendment',
        }, meta);
        jobsRescheduled += result.jobsRescheduled ?? 0;
        jobIds.push(...result.jobIds);
      } else if (action.type === 'skip_exception' && action.exceptionDate) {
        const timeZone = await this.orgSettings.getOperationalTimezone();
        const dayBounds = operationalDayBounds(action.exceptionDate, timeZone);
        const result = await this.scheduleImpact.cancelScopedServiceUserJobs(userId, {
          serviceUserId: params.serviceUserId,
          fromDate: dayBounds.start,
          toDate: dayBounds.end,
          reason: `SKIP exception: ${params.amendmentReason}`,
          source: 'visit_plan_skip_exception',
          scope: { visitPlanSlotId: action.visitPlanSlotId },
        }, meta);
        jobsCancelled += result.jobsCancelled;
        jobIds.push(...result.jobIds);
      }
    }

    return {
      jobsCancelled,
      jobsUnallocated: 0,
      jobsRescheduled,
      jobIds: [...new Set(jobIds)],
    };
  }
}
