import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InitialAssessmentsController } from './initial-assessments.controller';
import { InitialAssessmentsAdminController } from './initial-assessments-admin.controller';
import { InitialAssessmentsService } from './initial-assessments.service';
import { InitialAssessmentNotificationHook } from './initial-assessment-notification.hook';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  controllers: [InitialAssessmentsController, InitialAssessmentsAdminController],
  providers: [InitialAssessmentsService, InitialAssessmentNotificationHook],
  exports: [InitialAssessmentsService],
})
export class InitialAssessmentsModule {}
