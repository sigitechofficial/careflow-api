import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationLookupsController } from './medication-lookups.controller';
import { MedicationLookupsService } from './medication-lookups.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationLookupsController],
  providers: [MedicationLookupsService],
  exports: [MedicationLookupsService],
})
export class MedicationLookupsModule {}
