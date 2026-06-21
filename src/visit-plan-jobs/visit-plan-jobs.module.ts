import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';
import { VisitPlanScheduledEndJob } from '../service-user-visit-plans/visit-plan-scheduled-end.job';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, ServiceUserVisitPlansModule],
  providers: [VisitPlanScheduledEndJob],
})
export class VisitPlanJobsModule {}
