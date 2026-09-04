import { Module } from '@nestjs/common';
import { EmployeeComplianceController } from './employee-compliance.controller';
import { EmployeeComplianceService } from './employee-compliance.service';
import { AllocationComplianceService } from './allocation-compliance.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeComplianceController],
  providers: [EmployeeComplianceService, AllocationComplianceService],
  exports: [EmployeeComplianceService, AllocationComplianceService],
})
export class EmployeeComplianceModule {}
