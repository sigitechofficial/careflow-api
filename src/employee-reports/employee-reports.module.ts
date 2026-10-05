import { Module } from '@nestjs/common';
import { EmployeeReportsController } from './employee-reports.controller';
import { EmployeeReportsService } from './employee-reports.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ComplianceReportsModule } from '../compliance-reports/compliance-reports.module';

@Module({
  imports: [
    AuditLogsModule,
    OrganisationGeneralSettingsModule,
    ComplianceReportsModule,
  ],
  controllers: [EmployeeReportsController],
  providers: [EmployeeReportsService],
})
export class EmployeeReportsModule {}
