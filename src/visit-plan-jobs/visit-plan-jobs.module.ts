import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VisitPlanScheduledEndJob } from '../service-user-visit-plans/visit-plan-scheduled-end.job';
import { VisitPlanRollingRotaJob } from '../service-user-visit-plans/visit-plan-rolling-rota.job';
import { LateVisitAlertJob } from '../visit-attendance/late-visit-alert.job';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    ServiceUserVisitPlansModule,
    NotificationsModule,
  ],
  providers: [VisitPlanScheduledEndJob, VisitPlanRollingRotaJob, LateVisitAlertJob],
})
export class VisitPlanJobsModule {}
