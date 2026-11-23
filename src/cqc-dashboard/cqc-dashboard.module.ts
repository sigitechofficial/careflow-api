import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CqcEvidenceModule } from '../cqc-evidence/cqc-evidence.module';
import { CqcDashboardController } from './cqc-dashboard.controller';
import { CqcDashboardService } from './cqc-dashboard.service';

/** Governance → CQC dashboard and reports, built on CQC evidence, mock inspections and notifications. */
@Module({
  imports: [PrismaModule, CqcEvidenceModule],
  controllers: [CqcDashboardController],
  providers: [CqcDashboardService],
})
export class CqcDashboardModule {}
