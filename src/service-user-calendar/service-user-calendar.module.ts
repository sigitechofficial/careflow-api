import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceUserCalendarController } from './service-user-calendar.controller';
import { ServiceUserGlobalCalendarController } from './service-user-global-calendar.controller';
import { ServiceUserCalendarService } from './service-user-calendar.service';
import { ServiceUserCalendarNotificationHook } from './service-user-calendar-notification.hook';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  controllers: [ServiceUserGlobalCalendarController, ServiceUserCalendarController],
  providers: [ServiceUserCalendarService, ServiceUserCalendarNotificationHook],
  exports: [ServiceUserCalendarService],
})
export class ServiceUserCalendarModule {}
