import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeePortalAccountsService } from './employee-portal-accounts.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';

@Module({
  imports: [AuditLogsModule, ScheduleLifecycleImpactModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeePortalAccountsService],
  exports: [EmployeesService, EmployeePortalAccountsService],
})
export class EmployeesModule {}

