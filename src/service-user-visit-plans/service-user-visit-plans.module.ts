import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduledJobsModule } from '../scheduled-jobs/scheduled-jobs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';
import { ServiceUserVisitPlansController } from './service-user-visit-plans.controller';
import { ServiceUserVisitPlansService } from './service-user-visit-plans.service';
import { VisitPlanBulkScheduleController } from './visit-plan-bulk-schedule.controller';
import { VisitPlanBulkScheduleService } from './visit-plan-bulk-schedule.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, ScheduledJobsModule, ScheduleLifecycleImpactModule],
  controllers: [ServiceUserVisitPlansController, VisitPlanBulkScheduleController],
  providers: [ServiceUserVisitPlansService, VisitPlanBulkScheduleService],
  exports: [ServiceUserVisitPlansService, VisitPlanBulkScheduleService],
})
export class ServiceUserVisitPlansModule {}
