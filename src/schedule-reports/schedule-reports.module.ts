import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduleReportsController } from './schedule-reports.controller';
import { ScheduleReportsService } from './schedule-reports.service';
import { ScheduleReportExportHook } from './schedule-report-export.hook';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ScheduleReportsController],
  providers: [ScheduleReportsService, ScheduleReportExportHook],
  exports: [ScheduleReportsService],
})
export class ScheduleReportsModule {}
