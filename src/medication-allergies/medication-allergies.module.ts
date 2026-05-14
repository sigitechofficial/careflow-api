import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationAllergiesController } from './medication-allergies.controller';
import { MedicationAllergiesService } from './medication-allergies.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationAllergiesController],
  providers: [MedicationAllergiesService],
})
export class MedicationAllergiesModule {}
