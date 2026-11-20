import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CqcNotificationsController } from './cqc-notifications.controller';
import { CqcNotificationsService } from './cqc-notifications.service';
import { CqcNotificationPoliciesService } from './cqc-notification-policies.service';

/** Governance → CQC notifications (statutory notifications prepared and tracked, not sent). */
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CqcNotificationsController],
  providers: [CqcNotificationsService, CqcNotificationPoliciesService],
})
export class CqcNotificationsModule {}
