import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JobAllocationsModule } from '../job-allocations/job-allocations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ScheduleLifecycleImpactService } from './schedule-lifecycle-impact.service';
import { ScheduleLifecycleNotificationHook } from './schedule-lifecycle-notification.hook';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    JobAllocationsModule,
    NotificationsModule,
    OrganisationGeneralSettingsModule,
  ],
  providers: [ScheduleLifecycleImpactService, ScheduleLifecycleNotificationHook],
  exports: [ScheduleLifecycleImpactService, ScheduleLifecycleNotificationHook],
})
export class ScheduleLifecycleImpactModule {}
