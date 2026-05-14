import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MedicationNotificationHook } from '../medications/medication-notification.hook';
import { MedicationAdministrationController } from './medication-administration.controller';
import { MedicationAdministrationService } from './medication-administration.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  controllers: [MedicationAdministrationController],
  providers: [MedicationAdministrationService, MedicationNotificationHook],
})
export class MedicationAdministrationModule {}
