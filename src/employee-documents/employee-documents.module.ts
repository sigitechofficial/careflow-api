import { Module } from '@nestjs/common';
import { EmployeeDocumentsController } from './employee-documents.controller';
import { EmployeeDocumentsService } from './employee-documents.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeComplianceModule } from '../employee-compliance/employee-compliance.module';

@Module({
  imports: [AuditLogsModule, EmployeeComplianceModule],
  controllers: [EmployeeDocumentsController],
  providers: [EmployeeDocumentsService],
})
export class EmployeeDocumentsModule {}

