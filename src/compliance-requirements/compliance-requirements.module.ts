import { Module } from '@nestjs/common';
import { ComplianceRequirementsController } from './compliance-requirements.controller';
import { ComplianceRequirementsService } from './compliance-requirements.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [ComplianceRequirementsController],
  providers: [ComplianceRequirementsService],
  exports: [ComplianceRequirementsService],
})
export class ComplianceRequirementsModule {}
