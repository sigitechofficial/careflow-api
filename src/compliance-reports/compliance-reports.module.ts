import { Module } from '@nestjs/common';
import { ComplianceReportsController } from './compliance-reports.controller';
import { ComplianceReportsService } from './compliance-reports.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeComplianceModule } from '../employee-compliance/employee-compliance.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';

@Module({
  imports: [AuditLogsModule, EmployeeComplianceModule, OrganisationGeneralSettingsModule],
  controllers: [ComplianceReportsController],
  providers: [ComplianceReportsService],
  exports: [ComplianceReportsService],
})
export class ComplianceReportsModule {}
