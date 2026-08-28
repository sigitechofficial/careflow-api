import { Module } from '@nestjs/common';
import { EmployeePersonalDetailsController } from './employee-personal-details.controller';
import { EmployeePersonalDetailsService } from './employee-personal-details.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeePersonalDetailsController],
  providers: [EmployeePersonalDetailsService],
  exports: [EmployeePersonalDetailsService],
})
export class EmployeePersonalDetailsModule {}

