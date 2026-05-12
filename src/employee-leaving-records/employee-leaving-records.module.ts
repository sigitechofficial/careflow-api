import { Module } from '@nestjs/common';
import { EmployeeLeavingRecordsController } from './employee-leaving-records.controller';
import { EmployeeLeavingRecordsService } from './employee-leaving-records.service';

@Module({
  controllers: [EmployeeLeavingRecordsController],
  providers: [EmployeeLeavingRecordsService],
})
export class EmployeeLeavingRecordsModule {}

