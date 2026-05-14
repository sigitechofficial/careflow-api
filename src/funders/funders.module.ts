import { Module } from '@nestjs/common';
import { FundersController } from './funders.controller';
import { FundersService } from './funders.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [FundersController],
  providers: [FundersService],
  exports: [FundersService],
})
export class FundersModule {}
