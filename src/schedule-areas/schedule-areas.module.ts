import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduleAreasController } from './schedule-areas.controller';
import { ScheduleAreasService } from './schedule-areas.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ScheduleAreasController],
  providers: [ScheduleAreasService],
  exports: [ScheduleAreasService],
})
export class ScheduleAreasModule {}
