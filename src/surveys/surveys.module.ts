import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SurveysController } from './surveys.controller';
import { SurveysPublicController } from './surveys-public.controller';
import { SurveysPortalController } from './surveys-portal.controller';
import { SurveysEmployeeAppController } from './surveys-employee-app.controller';
import { SurveysService } from './surveys.service';
import { SurveyDistributionJob } from './survey-distribution.job';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    ScheduleModule,
    MailModule,
    NotificationsModule,
  ],
  controllers: [
    SurveysController,
    SurveysPublicController,
    SurveysPortalController,
    SurveysEmployeeAppController,
  ],
  providers: [SurveysService, SurveyDistributionJob],
  exports: [SurveysService],
})
export class SurveysModule {}
