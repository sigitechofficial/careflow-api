import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduledJobsModule } from '../scheduled-jobs/scheduled-jobs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';
import { BillingModule } from '../billing/billing.module';
import { ServiceUserVisitPlansController } from './service-user-visit-plans.controller';
import { ServiceUserVisitPlansService } from './service-user-visit-plans.service';
import { VisitPlanBulkScheduleController } from './visit-plan-bulk-schedule.controller';
import { VisitPlanBulkScheduleService } from './visit-plan-bulk-schedule.service';
import { VisitPlanAmendmentImpactService } from './visit-plan-amendment-impact.service';
import { VisitPlanGovernanceController } from './visit-plan-governance.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, ScheduledJobsModule, ScheduleLifecycleImpactModule, BillingModule],
  controllers: [ServiceUserVisitPlansController, VisitPlanBulkScheduleController, VisitPlanGovernanceController],
  providers: [ServiceUserVisitPlansService, VisitPlanBulkScheduleService, VisitPlanAmendmentImpactService],
  exports: [ServiceUserVisitPlansService, VisitPlanBulkScheduleService, VisitPlanAmendmentImpactService],
})
export class ServiceUserVisitPlansModule {}
