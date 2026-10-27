import { CarerWeeklyHoursModule } from '../employee-hours-approvals/carer-weekly-hours.module';
import { Module } from '@nestjs/common';
import { SpecialVisitsController } from './special-visits.controller';
import { SpecialVisitsService } from './special-visits.service';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';

@Module({
  imports: [ServiceUserVisitPlansModule, CarerWeeklyHoursModule],
  controllers: [SpecialVisitsController],
  providers: [SpecialVisitsService],
})
export class SpecialVisitsModule {}
