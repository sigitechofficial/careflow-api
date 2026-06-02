import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationPacksController } from './medication-packs.controller';
import { MedicationPacksService } from './medication-packs.service';
import { MedicationPackDeliveriesController } from './medication-pack-deliveries.controller';
import { MedicationPackDeliveriesService } from './medication-pack-deliveries.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationPacksController, MedicationPackDeliveriesController],
  providers: [MedicationPacksService, MedicationPackDeliveriesService],
})
export class MedicationPacksModule {}
