import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';
import { EmployeeHolidaysController } from './employee-holidays.controller';
import { EmployeeHolidaysService } from './employee-holidays.service';

@Module({
  imports: [PrismaModule, ScheduleLifecycleImpactModule],
  controllers: [EmployeeHolidaysController],
  providers: [EmployeeHolidaysService],
})
export class EmployeeHolidaysModule {}
