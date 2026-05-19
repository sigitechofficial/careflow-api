import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduledJobsModule } from '../scheduled-jobs/scheduled-jobs.module';
import { ScheduledVisitsController } from './scheduled-visits.controller';
import { ScheduledVisitsService } from './scheduled-visits.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, ScheduledJobsModule],
  controllers: [ScheduledVisitsController],
  providers: [ScheduledVisitsService],
  exports: [ScheduledVisitsService],
})
export class ScheduledVisitsModule {}
