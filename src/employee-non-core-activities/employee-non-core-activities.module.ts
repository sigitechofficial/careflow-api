import { Module } from '@nestjs/common';
import { EmployeeNonCoreActivitiesController } from './employee-non-core-activities.controller';
import { EmployeeNonCoreActivitiesService } from './employee-non-core-activities.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';

@Module({
  imports: [AuditLogsModule, ScheduleLifecycleImpactModule],
  controllers: [EmployeeNonCoreActivitiesController],
  providers: [EmployeeNonCoreActivitiesService],
})
export class EmployeeNonCoreActivitiesModule {}

