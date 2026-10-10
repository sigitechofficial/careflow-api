import { Module } from '@nestjs/common';
import { ComplianceReportsController } from './compliance-reports.controller';
import { ComplianceReportsService } from './compliance-reports.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeComplianceModule } from '../employee-compliance/employee-compliance.module';

@Module({
  imports: [AuditLogsModule, EmployeeComplianceModule],
  controllers: [ComplianceReportsController],
  providers: [ComplianceReportsService],
  exports: [ComplianceReportsService],
})
export class ComplianceReportsModule {}
