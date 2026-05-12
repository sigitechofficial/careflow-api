import { Module } from '@nestjs/common';
import { ComplianceTypesController } from './compliance-types.controller';
import { ComplianceTypesService } from './compliance-types.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [ComplianceTypesController],
  providers: [ComplianceTypesService],
  exports: [ComplianceTypesService],
})
export class ComplianceTypesModule {}
