import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MedicationStatusCodesController } from './medication-status-codes.controller';
import { MedicationStatusCodesService } from './medication-status-codes.service';

@Module({
  imports: [PrismaModule],
  controllers: [MedicationStatusCodesController],
  providers: [MedicationStatusCodesService],
  exports: [MedicationStatusCodesService],
})
export class MedicationStatusCodesModule {}
