import { Module } from '@nestjs/common';
import { EmployeeHoursController } from './employee-hours.controller';
import { EmployeeHoursService } from './employee-hours.service';

@Module({
  controllers: [EmployeeHoursController],
  providers: [EmployeeHoursService],
})
export class EmployeeHoursModule {}
