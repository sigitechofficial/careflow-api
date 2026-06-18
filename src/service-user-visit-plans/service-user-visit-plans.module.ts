import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduledJobsModule } from '../scheduled-jobs/scheduled-jobs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';
import { ServiceUserVisitPlansController } from './service-user-visit-plans.controller';
import { ServiceUserVisitPlansService } from './service-user-visit-plans.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, ScheduledJobsModule, ScheduleLifecycleImpactModule],
  controllers: [ServiceUserVisitPlansController],
  providers: [ServiceUserVisitPlansService],
  exports: [ServiceUserVisitPlansService],
})
export class ServiceUserVisitPlansModule {}
