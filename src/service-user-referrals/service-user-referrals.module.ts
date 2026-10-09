import { Module } from '@nestjs/common';
import { ServiceUserReferralsController } from './service-user-referrals.controller';
import { ServiceUserReferralsService } from './service-user-referrals.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

/** Service user referrals, private care quotations and their history. */
@Module({
  imports: [AuditLogsModule],
  controllers: [ServiceUserReferralsController],
  providers: [ServiceUserReferralsService],
})
export class ServiceUserReferralsModule {}
