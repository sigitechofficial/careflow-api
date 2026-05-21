import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceUserFlashMessagesController } from './service-user-flash-messages.controller';
import { ServiceUserFlashMessagesService } from './service-user-flash-messages.service';
import { FlashMessageNotificationHook } from './flash-message-notification.hook';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  controllers: [ServiceUserFlashMessagesController],
  providers: [ServiceUserFlashMessagesService, FlashMessageNotificationHook],
  exports: [ServiceUserFlashMessagesService],
})
export class ServiceUserFlashMessagesModule {}
