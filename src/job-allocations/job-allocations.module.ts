import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobAllocationsController } from './job-allocations.controller';
import { ScheduledJobAllocationsController } from './scheduled-job-allocations.controller';
import { JobAllocationsService } from './job-allocations.service';
import { AllocationChecksService } from './allocation-checks.service';
import { ScheduleAllocationNotificationHook } from './schedule-allocation-notification.hook';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  controllers: [JobAllocationsController, ScheduledJobAllocationsController],
  providers: [JobAllocationsService, AllocationChecksService, ScheduleAllocationNotificationHook],
  exports: [JobAllocationsService, AllocationChecksService],
})
export class JobAllocationsModule {}
