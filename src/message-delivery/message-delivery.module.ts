import { Global, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessageDeliveryService } from './message-delivery.service';
import { MessageDeliverySettingsService } from './message-delivery-settings.service';
import { MessageDeliveryController } from './message-delivery.controller';

/** Global so the mail, text and push services (and referral replies) can all ask before sending. */
@Global()
@Module({
  imports: [AuditLogsModule, NotificationsModule],
  controllers: [MessageDeliveryController],
  providers: [MessageDeliveryService, MessageDeliverySettingsService],
  exports: [MessageDeliveryService],
})
export class MessageDeliveryModule {}
