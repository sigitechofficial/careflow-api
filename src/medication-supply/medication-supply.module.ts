import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationSupplyController } from './medication-supply.controller';
import { MedicationSupplyService } from './medication-supply.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationSupplyController],
  providers: [MedicationSupplyService],
  exports: [MedicationSupplyService],
})
export class MedicationSupplyModule {}
