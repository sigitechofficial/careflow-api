import { Module } from '@nestjs/common';
import { EmployeeNonCoreActivitiesController } from './employee-non-core-activities.controller';
import { EmployeeNonCoreActivitiesService } from './employee-non-core-activities.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeNonCoreActivitiesController],
  providers: [EmployeeNonCoreActivitiesService],
})
export class EmployeeNonCoreActivitiesModule {}

