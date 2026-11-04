import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CarerMessagesController } from './carer-messages.controller';
import { CarerMessagesService } from './carer-messages.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  controllers: [CarerMessagesController],
  providers: [CarerMessagesService],
})
export class CarerMessagesModule {}
