import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';
import { ScheduleTimelinesController } from './schedule-timelines.controller';
import { ScheduleTimelinesService } from './schedule-timelines.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, ScheduleLifecycleImpactModule],
  controllers: [ScheduleTimelinesController],
  providers: [ScheduleTimelinesService],
  exports: [ScheduleTimelinesService],
})
export class ScheduleTimelinesModule {}
