import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MedicationAdministrationRoundsController } from './medication-administration-rounds.controller';
import { MedicationAdministrationRoundsService } from './medication-administration-rounds.service';

@Module({
  imports: [PrismaModule],
  controllers: [MedicationAdministrationRoundsController],
  providers: [MedicationAdministrationRoundsService],
  exports: [MedicationAdministrationRoundsService],
})
export class MedicationAdministrationRoundsModule {}
