import { Module, forwardRef } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { AssessmentReviewRemindersJob } from './assessment-review-reminders.job';
import { ServiceUserAssessmentsController } from './service-user-assessments.controller';
import { ServiceUserAssessmentsReviewController } from './service-user-assessments-review.controller';
import { ServiceUserCarePlanAssessmentLinksController } from './service-user-care-plan-assessment-links.controller';
import { ServiceUserAssessmentsService } from './service-user-assessments.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    OrganisationGeneralSettingsModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [
    ServiceUserAssessmentsController,
    ServiceUserAssessmentsReviewController,
    ServiceUserCarePlanAssessmentLinksController,
  ],
  providers: [ServiceUserAssessmentsService, AssessmentReviewRemindersJob],
  exports: [ServiceUserAssessmentsService],
})
export class ServiceUserAssessmentsModule {}
