import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeeHoursApprovalsController } from './employee-hours-approvals.controller';
import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';
import { EmployeeHoursApprovalNotificationHook } from './employee-hours-approval-notification.hook';
import { CarerHoursReductionService } from './carer-hours-reduction.service';
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
  ],
  controllers: [EmployeeHoursApprovalsController],
  providers: [
    EmployeeHoursApprovalsService,
    EmployeeHoursApprovalNotificationHook,
    CarerHoursReductionService,
  ],
  exports: [EmployeeHoursApprovalsService, EmployeeHoursApprovalNotificationHook],
})
export class EmployeeHoursApprovalsModule {}
