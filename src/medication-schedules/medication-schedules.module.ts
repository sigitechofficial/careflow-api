import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationSchedulesController } from './medication-schedules.controller';
import { MedicationSchedulePreviewController } from './medication-schedule-preview.controller';
import { MedicationSchedulesService } from './medication-schedules.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationSchedulesController, MedicationSchedulePreviewController],
  providers: [MedicationSchedulesService],
  exports: [MedicationSchedulesService],
})
export class MedicationSchedulesModule {}
