import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';
import { InitialAssessmentsController } from './initial-assessments.controller';
import { InitialAssessmentsAdminController } from './initial-assessments-admin.controller';
import { InitialAssessmentCarePlanRulesController } from './initial-assessment-care-plan-rules.controller';
import { InitialAssessmentsService } from './initial-assessments.service';
import { InitialAssessmentCarePlanRulesService } from './initial-assessment-care-plan-rules.service';
import { InitialAssessmentNotificationHook } from './initial-assessment-notification.hook';
import { InitialAssessmentTranscriptionService } from './initial-assessment-transcription.service';
import { InitialAssessmentAiFillService } from './initial-assessment-ai-fill.service';
import { InitialAssessmentConversationFilesService } from './initial-assessment-conversation-files.service';
// Stateless (Prisma only); provided here so accepting a recommendation can compose the first draft
// without importing ServiceUserCarePlansModule, which already imports this module.
import { CarePlanComposeService } from '../service-user-care-plans/care-plan-compose.service';
import { CarePlanReassessmentService } from './care-plan-reassessment.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    NotificationsModule,
    ServiceUserVisitPlansModule,
  ],
  controllers: [
    InitialAssessmentsController,
    InitialAssessmentsAdminController,
    InitialAssessmentCarePlanRulesController,
  ],
  providers: [
    InitialAssessmentsService,
    InitialAssessmentCarePlanRulesService,
    InitialAssessmentNotificationHook,
    InitialAssessmentTranscriptionService,
    InitialAssessmentAiFillService,
    InitialAssessmentConversationFilesService,
    CarePlanComposeService,
    CarePlanReassessmentService,
  ],
  exports: [InitialAssessmentsService, InitialAssessmentCarePlanRulesService],
})
export class InitialAssessmentsModule {}
