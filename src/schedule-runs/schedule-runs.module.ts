import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduleRunsController } from './schedule-runs.controller';
import { ScheduleRunsService } from './schedule-runs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ScheduleRunsController],
  providers: [ScheduleRunsService],
  exports: [ScheduleRunsService],
})
export class ScheduleRunsModule {}
