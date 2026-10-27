import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeHoursApprovalsController } from './employee-hours-approvals.controller';
import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';
import { CarerHoursReductionService } from './carer-hours-reduction.service';
import { CarerWeeklyHoursModule } from './carer-weekly-hours.module';
import { JobAllocationsModule } from '../job-allocations/job-allocations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    NotificationsModule,
    OrganisationGeneralSettingsModule,
    ScheduleLifecycleImpactModule,
    CarerWeeklyHoursModule,
    JobAllocationsModule,
  ],
  controllers: [EmployeeHoursApprovalsController],
  providers: [
    EmployeeHoursApprovalsService,
    CarerHoursReductionService,
  ],
  exports: [EmployeeHoursApprovalsService, CarerWeeklyHoursModule],
})
export class EmployeeHoursApprovalsModule {}
