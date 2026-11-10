import { Module } from '@nestjs/common';
import { EmployeeCertificationsController } from './employee-certifications.controller';
import { EmployeeCertificationsService } from './employee-certifications.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeComplianceModule } from '../employee-compliance/employee-compliance.module';

@Module({
  imports: [AuditLogsModule, EmployeeComplianceModule],
  controllers: [EmployeeCertificationsController],
  providers: [EmployeeCertificationsService],
})
export class EmployeeCertificationsModule {}

