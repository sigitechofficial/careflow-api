import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeHoursApprovalsController } from './employee-hours-approvals.controller';
import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [EmployeeHoursApprovalsController],
  providers: [EmployeeHoursApprovalsService],
  exports: [EmployeeHoursApprovalsService],
})
export class EmployeeHoursApprovalsModule {}
