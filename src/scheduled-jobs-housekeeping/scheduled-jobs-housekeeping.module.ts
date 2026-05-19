import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduledJobsHousekeepingController } from './scheduled-jobs-housekeeping.controller';
import { ScheduledJobsHousekeepingService } from './scheduled-jobs-housekeeping.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ScheduledJobsHousekeepingController],
  providers: [ScheduledJobsHousekeepingService],
  exports: [ScheduledJobsHousekeepingService],
})
export class ScheduledJobsHousekeepingModule {}
