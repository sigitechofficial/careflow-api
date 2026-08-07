import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduledJobsModule } from '../scheduled-jobs/scheduled-jobs.module';
import { BillingModule } from '../billing/billing.module';
import { ServiceUserObservationsModule } from '../service-user-observations/service-user-observations.module';
import { EcmModule } from '../ecm/ecm.module';
import { VisitAttendanceModule } from '../visit-attendance/visit-attendance.module';
import { ScheduledJobsHousekeepingController } from './scheduled-jobs-housekeeping.controller';
import { ScheduledJobsHousekeepingService } from './scheduled-jobs-housekeeping.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    ScheduledJobsModule,
    BillingModule,
    ServiceUserObservationsModule,
    VisitAttendanceModule,
    forwardRef(() => EcmModule),
  ],
  controllers: [ScheduledJobsHousekeepingController],
  providers: [ScheduledJobsHousekeepingService],
  exports: [ScheduledJobsHousekeepingService],
})
export class ScheduledJobsHousekeepingModule {}
