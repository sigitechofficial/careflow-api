import { Module } from '@nestjs/common';
import {
  EmployeeAllocationsController,
  EmployeeAllocationsRegistryController,
} from './employee-allocations.controller';
import { EmployeeAllocationsService } from './employee-allocations.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [
    EmployeeAllocationsController,
    EmployeeAllocationsRegistryController,
  ],
  providers: [EmployeeAllocationsService],
})
export class EmployeeAllocationsModule {}
