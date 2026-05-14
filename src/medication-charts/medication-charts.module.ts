import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationChartsController } from './medication-charts.controller';
import { MedicationChartsService } from './medication-charts.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationChartsController],
  providers: [MedicationChartsService],
})
export class MedicationChartsModule {}
