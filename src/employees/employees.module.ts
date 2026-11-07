import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeePortalAccountsService } from './employee-portal-accounts.service';
import { EmployeeVisitsService } from './employee-visits.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ComplianceReportsModule } from '../compliance-reports/compliance-reports.module';

@Module({
  imports: [AuditLogsModule, ScheduleLifecycleImpactModule, OrganisationGeneralSettingsModule, ComplianceReportsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeePortalAccountsService, EmployeeVisitsService],
  exports: [EmployeesService, EmployeePortalAccountsService, EmployeeVisitsService],
})
export class EmployeesModule {}

