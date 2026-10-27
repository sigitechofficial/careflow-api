import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { CarerWeeklyHoursService } from './carer-weekly-hours.service';
import { EmployeeHoursApprovalNotificationHook } from './employee-hours-approval-notification.hook';

/**
 * The carer weekly-hours count and the approval notifications, on their own so the rota
 * (job allocations) can use them without importing the hours approvals module.
 */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    OrganisationGeneralSettingsModule,
  ],
  providers: [CarerWeeklyHoursService, EmployeeHoursApprovalNotificationHook],
  exports: [CarerWeeklyHoursService, EmployeeHoursApprovalNotificationHook],
})
export class CarerWeeklyHoursModule {}
