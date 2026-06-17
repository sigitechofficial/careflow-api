import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JobAllocationsModule } from '../job-allocations/job-allocations.module';
import { ScheduleRunsController } from './schedule-runs.controller';
import { ScheduleRunsService } from './schedule-runs.service';
import { ScheduleRunCarerSyncService } from './schedule-run-carer-sync.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, JobAllocationsModule],
  controllers: [ScheduleRunsController],
  providers: [ScheduleRunsService, ScheduleRunCarerSyncService],
  exports: [ScheduleRunsService],
})
export class ScheduleRunsModule {}
