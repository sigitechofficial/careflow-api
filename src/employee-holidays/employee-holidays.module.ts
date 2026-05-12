import { Module } from '@nestjs/common';
import { EmployeeHolidaysController } from './employee-holidays.controller';
import { EmployeeHolidaysService } from './employee-holidays.service';

@Module({
  controllers: [EmployeeHolidaysController],
  providers: [EmployeeHolidaysService],
})
export class EmployeeHolidaysModule {}

