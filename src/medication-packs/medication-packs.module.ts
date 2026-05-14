import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationPacksController } from './medication-packs.controller';
import { MedicationPacksService } from './medication-packs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationPacksController],
  providers: [MedicationPacksService],
})
export class MedicationPacksModule {}
