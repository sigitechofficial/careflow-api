import { Module } from '@nestjs/common';
import { FundingTypesController } from './funding-types.controller';
import { FundingTypesService } from './funding-types.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [FundingTypesController],
  providers: [FundingTypesService],
  exports: [FundingTypesService],
})
export class FundingTypesModule {}
