import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InitialAssessmentsModule } from '../initial-assessments/initial-assessments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CarePlanComposeService } from './care-plan-compose.service';
import { CarePlanReviewRemindersJob } from './care-plan-review-reminders.job';
import { ServiceUserCarePlansReviewController } from './service-user-care-plans-review.controller';
import { ServiceUserCarePlansController } from './service-user-care-plans.controller';
import { ServiceUserCarePlansService } from './service-user-care-plans.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    InitialAssessmentsModule,
    forwardRef(() => NotificationsModule),
    ScheduleModule.forRoot(),
  ],
  controllers: [ServiceUserCarePlansController, ServiceUserCarePlansReviewController],
  providers: [ServiceUserCarePlansService, CarePlanComposeService, CarePlanReviewRemindersJob],
  exports: [ServiceUserCarePlansService, CarePlanComposeService],
})
export class ServiceUserCarePlansModule {}
