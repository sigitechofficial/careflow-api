import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationReviewsController } from './medication-reviews.controller';
import { MedicationReviewsService } from './medication-reviews.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationReviewsController],
  providers: [MedicationReviewsService],
})
export class MedicationReviewsModule {}
