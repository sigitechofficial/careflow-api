import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CqcEvidenceModule } from '../cqc-evidence/cqc-evidence.module';
import { PoliciesModule } from '../policies/policies.module';
import { CqcMockInspectionModule } from '../cqc-mock-inspection/cqc-mock-inspection.module';
import { CqcEvidencePackController } from './cqc-evidence-pack.controller';
import { CqcEvidencePackService } from './cqc-evidence-pack.service';

/**
 * CQC evidence pack: brings together CQC evidence, the published policies behind each statement (PoliciesModule,
 * linked through the mock inspection library) and mock inspection scores and actions. Its own module, so CQC
 * evidence does not depend on policies or mock inspections (which depend on it).
 */
@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    CqcEvidenceModule,
    PoliciesModule,
    CqcMockInspectionModule,
  ],
  controllers: [CqcEvidencePackController],
  providers: [CqcEvidencePackService],
})
export class CqcEvidencePackModule {}
