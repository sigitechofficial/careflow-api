import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CallOffVisitsController } from './call-off-visits.controller';
import { CallOffVisitsService } from './call-off-visits.service';
import { CallOffVisitNotificationHook } from './call-off-visit-notification.hook';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  controllers: [CallOffVisitsController],
  providers: [CallOffVisitsService, CallOffVisitNotificationHook],
  exports: [CallOffVisitsService],
})
export class CallOffVisitsModule {}
