import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LearningAssessmentsController } from './learning-assessments.controller';
import { LearningAssessmentsService } from './learning-assessments.service';
import { LearningAssignmentsController } from './learning-assignments.controller';
import { LearningAssignmentsService } from './learning-assignments.service';
import { LearningCategoriesController } from './learning-categories.controller';
import { LearningCategoriesService } from './learning-categories.service';
import { LearningCertificatesController } from './learning-certificates.controller';
import { LearningCertificatesService } from './learning-certificates.service';
import { LearningCompetenciesController } from './learning-competencies.controller';
import { LearningCompetenciesService } from './learning-competencies.service';
import { LearningComplianceController } from './learning-compliance.controller';
import { LearningComplianceService } from './learning-compliance.service';
import { LearningCompletionService } from './learning-completion.service';
import { LearningContentController } from './learning-content.controller';
import { LearningContentService } from './learning-content.service';
import { LearningCoursesController } from './learning-courses.controller';
import { LearningCoursesService } from './learning-courses.service';
import { LearningDashboardController } from './learning-dashboard.controller';
import { LearningDashboardService } from './learning-dashboard.service';
import { LearningEligibilityController } from './learning-eligibility.controller';
import { LearningEligibilityService } from './learning-eligibility.service';
import { LearningExternalTrainingController } from './learning-external-training.controller';
import { LearningExternalTrainingService } from './learning-external-training.service';
import { LearningJobs } from './learning-jobs';
import { LearningMeController } from './learning-me.controller';
import { LearningMeService } from './learning-me.service';
import { LearningNotificationHook } from './learning-notification.hook';
import { LearningReportsController } from './learning-reports.controller';
import { LearningReportsService } from './learning-reports.service';
import { LearningSettingsController } from './learning-settings.controller';
import { LearningSettingsService } from './learning-settings.service';
import { LearningTrainingEventsController } from './learning-training-events.controller';
import { LearningTrainingEventsService } from './learning-training-events.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    ScheduleModule.forRoot(),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [
    LearningCategoriesController,
    LearningCoursesController,
    LearningContentController,
    LearningAssessmentsController,
    LearningAssignmentsController,
    LearningMeController,
    LearningComplianceController,
    LearningDashboardController,
    LearningCertificatesController,
    LearningCompetenciesController,
    LearningTrainingEventsController,
    LearningExternalTrainingController,
    LearningReportsController,
    LearningSettingsController,
    LearningEligibilityController,
  ],
  providers: [
    LearningCategoriesService,
    LearningCoursesService,
    LearningContentService,
    LearningAssessmentsService,
    LearningAssignmentsService,
    LearningMeService,
    LearningCompletionService,
    LearningComplianceService,
    LearningDashboardService,
    LearningCertificatesService,
    LearningCompetenciesService,
    LearningTrainingEventsService,
    LearningExternalTrainingService,
    LearningReportsService,
    LearningSettingsService,
    LearningEligibilityService,
    LearningNotificationHook,
    LearningJobs,
  ],
  exports: [
    LearningAssignmentsService,
    LearningCompletionService,
    LearningComplianceService,
    LearningSettingsService,
    LearningEligibilityService,
  ],
})
export class LearningModule {}
