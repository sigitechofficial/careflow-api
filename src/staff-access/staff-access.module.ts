import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeEmploymentModule } from '../employee-employment/employee-employment.module';
import { CareAppLinksController, OfficeUserInvitesController, StaffAccessController } from './staff-access.controller';
import { StaffAccessService } from './staff-access.service';
import { StaffLeaversAccessJob } from './staff-leavers-access.job';

/** Office login and Care app access from the staff record, welcome emails, and ending access for leavers. */
@Module({
  imports: [AuthModule, AuditLogsModule, EmployeeEmploymentModule],
  controllers: [StaffAccessController, OfficeUserInvitesController, CareAppLinksController],
  providers: [StaffAccessService, StaffLeaversAccessJob],
  exports: [StaffAccessService],
})
export class StaffAccessModule {}
