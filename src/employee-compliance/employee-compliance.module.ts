import { Module } from '@nestjs/common';
import { EmployeeComplianceController } from './employee-compliance.controller';
import { EmployeeComplianceQueriesController } from './employee-compliance-queries.controller';
import { EmployeeComplianceService } from './employee-compliance.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeComplianceController, EmployeeComplianceQueriesController],
  providers: [EmployeeComplianceService],
})
export class EmployeeComplianceModule {}

