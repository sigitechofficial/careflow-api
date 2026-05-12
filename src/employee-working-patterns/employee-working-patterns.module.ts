import { Module } from '@nestjs/common';
import { EmployeeWorkingPatternsController } from './employee-working-patterns.controller';
import { EmployeeWorkingPatternsService } from './employee-working-patterns.service';

@Module({
  controllers: [EmployeeWorkingPatternsController],
  providers: [EmployeeWorkingPatternsService],
})
export class EmployeeWorkingPatternsModule {}

