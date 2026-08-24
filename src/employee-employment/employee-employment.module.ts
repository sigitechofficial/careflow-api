import { Module } from '@nestjs/common';
import { EmployeeEmploymentController } from './employee-employment.controller';
import { EmployeeEmploymentService } from './employee-employment.service';
import { RbacEmploymentSyncService } from './rbac-employment-sync.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeEmploymentController],
  providers: [EmployeeEmploymentService, RbacEmploymentSyncService],
  exports: [EmployeeEmploymentService],
})
export class EmployeeEmploymentModule {}

