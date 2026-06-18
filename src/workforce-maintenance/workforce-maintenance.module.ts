import { Module } from '@nestjs/common';
import { EmployeeComplianceModule } from '../employee-compliance/employee-compliance.module';
import { WorkforceMaintenanceCron, WorkforceMaintenanceService } from './workforce-maintenance.service';

@Module({
  imports: [EmployeeComplianceModule],
  providers: [WorkforceMaintenanceService, WorkforceMaintenanceCron],
  exports: [WorkforceMaintenanceService],
})
export class WorkforceMaintenanceModule {}
