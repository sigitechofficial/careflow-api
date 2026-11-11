import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  JOB_HANDLER_KEY,
  JobHandler,
  JobHandlerRegistry,
} from './job-handler.registry';
import { JOB_NAMES } from './job-catalogue';
import { SurveyDistributionJob } from '../surveys/survey-distribution.job';
import { VisitStartReminderJob } from '../visit-attendance/visit-start-reminder.job';
import { LateVisitAlertJob } from '../visit-attendance/late-visit-alert.job';
import { EcmMissedVisitDetectionJob } from '../ecm/ecm-missed-visit.job';
import { EcmMissingCheckoutDetectionJob } from '../ecm/ecm-missing-checkout.job';
import { PlatformCostsJobs } from '../platform-costs/platform-costs.jobs';
import { EmployeePayoutAutoJob } from '../billing/employee-payout-auto.job';
import { VisitPlanRollingRotaJob } from '../service-user-visit-plans/visit-plan-rolling-rota.job';
import { VisitPlanScheduledEndJob } from '../service-user-visit-plans/visit-plan-scheduled-end.job';
import { LearningJobs } from '../learning/learning-jobs';
import { CarePlanReviewRemindersJob } from '../service-user-care-plans/care-plan-review-reminders.job';
import { OverCareReviewJob } from '../service-user-visit-plans/over-care-review.job';
import { jobSuccess } from './job-run.types';

@Injectable()
class FakeLateAlertJob {
  calls = 0;
  @JobHandler('late-visit-alert')
  async run() {
    this.calls += 1;
    return jobSuccess({ calls: this.calls });
  }
  notAHandler() {
    return 1;
  }
}

describe('JobHandlerRegistry', () => {
  it('discovers @JobHandler methods bound to their instance', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [JobHandlerRegistry, FakeLateAlertJob],
    }).compile();
    await moduleRef.init();
    const registry = moduleRef.get(JobHandlerRegistry);
    expect(registry.registeredNames()).toEqual(['late-visit-alert']);
    await expect(registry.get('late-visit-alert')!()).resolves.toEqual(
      jobSuccess({ calls: 1 }),
    );
    expect(moduleRef.get(FakeLateAlertJob).calls).toBe(1);
    expect(registry.get('rolling-rota')).toBeUndefined();
    await moduleRef.close();
  });
});

describe('job classes', () => {
  it('each of the 12 jobs has exactly one @JobHandler method', () => {
    const classes = [
      SurveyDistributionJob,
      VisitStartReminderJob,
      LateVisitAlertJob,
      EcmMissedVisitDetectionJob,
      EcmMissingCheckoutDetectionJob,
      PlatformCostsJobs,
      EmployeePayoutAutoJob,
      VisitPlanRollingRotaJob,
      VisitPlanScheduledEndJob,
      LearningJobs,
      CarePlanReviewRemindersJob,
      OverCareReviewJob,
    ];
    const found: string[] = [];
    for (const cls of classes) {
      const proto = cls.prototype as unknown as Record<string, unknown>;
      const names = Object.getOwnPropertyNames(proto)
        .map((m) =>
          typeof proto[m] === 'function'
            ? Reflect.getMetadata(JOB_HANDLER_KEY, proto[m] as object)
            : undefined,
        )
        .filter(Boolean);
      expect(names).toHaveLength(1);
      found.push(names[0] as string);
    }
    expect(found).toEqual([...JOB_NAMES]);
  });
});
