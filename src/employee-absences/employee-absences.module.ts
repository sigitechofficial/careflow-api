import { Module } from '@nestjs/common';
import { EmployeeAbsencesController } from './employee-absences.controller';
import { EmployeeAbsencesService } from './employee-absences.service';

@Module({
  controllers: [EmployeeAbsencesController],
  providers: [EmployeeAbsencesService],
})
export class EmployeeAbsencesModule {}
