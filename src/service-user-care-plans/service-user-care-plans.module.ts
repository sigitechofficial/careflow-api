import { Module, forwardRef } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InitialAssessmentsModule } from '../initial-assessments/initial-assessments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { CarePlanComposeService } from './care-plan-compose.service';
import { CarePlanReviewRemindersJob } from './care-plan-review-reminders.job';
import { CarePlanTaskReconciliationService } from './care-plan-task-reconciliation.service';
import { CarePlanCarerNotificationService } from './care-plan-carer-notification.service';
import { CarePlanRiskLinkService } from './care-plan-risk-link.service';
import { ServiceUserCarePlansReviewController } from './service-user-care-plans-review.controller';
import { ServiceUserCarePlansController } from './service-user-care-plans.controller';
import { ServiceUserCarePlansService } from './service-user-care-plans.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    InitialAssessmentsModule,
    OrganisationGeneralSettingsModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [ServiceUserCarePlansController, ServiceUserCarePlansReviewController],
  providers: [
    ServiceUserCarePlansService,
    CarePlanComposeService,
    CarePlanReviewRemindersJob,
    CarePlanTaskReconciliationService,
    CarePlanCarerNotificationService,
    CarePlanRiskLinkService,
  ],
  exports: [ServiceUserCarePlansService, CarePlanComposeService],
})
export class ServiceUserCarePlansModule {}
