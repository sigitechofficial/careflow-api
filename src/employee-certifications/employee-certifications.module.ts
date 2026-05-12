import { Module } from '@nestjs/common';
import { EmployeeCertificationsController } from './employee-certifications.controller';
import { EmployeeCertificationsService } from './employee-certifications.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeCertificationsController],
  providers: [EmployeeCertificationsService],
})
export class EmployeeCertificationsModule {}

