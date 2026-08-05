import { Module } from '@nestjs/common';
import { ServiceUserFundingController } from './service-user-funding.controller';
import { ServiceUserFundingService } from './service-user-funding.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [AuditLogsModule, BillingModule],
  controllers: [ServiceUserFundingController],
  providers: [ServiceUserFundingService],
  exports: [ServiceUserFundingService],
})
export class ServiceUserFundingModule {}
