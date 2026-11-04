import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeHoursApprovalsController } from './employee-hours-approvals.controller';
import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';
import { CarerHoursReductionService } from './carer-hours-reduction.service';
import { CarerExtraHoursService } from './carer-extra-hours.service';
import { EXTRA_WEEKLY_HOURS_GRANTER } from './extra-weekly-hours-granter';
import { HoursHistoryService } from './hours-history.service';
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
    CarerExtraHoursService,
    { provide: EXTRA_WEEKLY_HOURS_GRANTER, useExisting: CarerExtraHoursService },
    HoursHistoryService,
  ],
  exports: [EmployeeHoursApprovalsService, CarerExtraHoursService, CarerWeeklyHoursModule],
})
export class EmployeeHoursApprovalsModule {}
