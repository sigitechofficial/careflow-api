import { Module } from '@nestjs/common';
import { ComplianceReportsController } from './compliance-reports.controller';
import { ComplianceReportsService } from './compliance-reports.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [ComplianceReportsController],
  providers: [ComplianceReportsService],
})
export class ComplianceReportsModule {}
