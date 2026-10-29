import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmployeeHoursApprovalsModule } from '../employee-hours-approvals/employee-hours-approvals.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { VisitPlanScheduledEndJob } from '../service-user-visit-plans/visit-plan-scheduled-end.job';
import { VisitPlanRollingRotaJob } from '../service-user-visit-plans/visit-plan-rolling-rota.job';
import { LateVisitAlertJob } from '../visit-attendance/late-visit-alert.job';
import { VisitStartReminderJob } from '../visit-attendance/visit-start-reminder.job';

@Module({
  imports: [
    PrismaModule,
    ServiceUserVisitPlansModule,
    NotificationsModule,
    OrganisationGeneralSettingsModule,
    EmployeeHoursApprovalsModule,
  ],
  providers: [VisitPlanScheduledEndJob, VisitPlanRollingRotaJob, LateVisitAlertJob, VisitStartReminderJob],
})
export class VisitPlanJobsModule {}
