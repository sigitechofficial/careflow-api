import { Module } from '@nestjs/common';
import { EmployeeReportsController } from './employee-reports.controller';
import { EmployeeReportsService } from './employee-reports.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeReportsController],
  providers: [EmployeeReportsService],
})
export class EmployeeReportsModule {}

