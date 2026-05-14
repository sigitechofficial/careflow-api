import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationReportsController } from './medication-reports.controller';
import { MedicationReportsService } from './medication-reports.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationReportsController],
  providers: [MedicationReportsService],
})
export class MedicationReportsModule {}
