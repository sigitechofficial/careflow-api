import { Module } from '@nestjs/common';
import { EmployeeComplianceController } from './employee-compliance.controller';
import { EmployeeComplianceService } from './employee-compliance.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeComplianceController],
  providers: [EmployeeComplianceService],
  exports: [EmployeeComplianceService],
})
export class EmployeeComplianceModule {}
