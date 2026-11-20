import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CqcEvidenceModule } from '../cqc-evidence/cqc-evidence.module';
import { SurveysModule } from '../surveys/surveys.module';
import { PoliciesModule } from '../policies/policies.module';
import { CqcMockInspectionController } from './cqc-mock-inspection.controller';
import { CqcMockInspectionService } from './cqc-mock-inspection.service';
import { CqcMockInspectionSurveysService } from './cqc-mock-inspection-surveys.service';
import { CqcMockInspectionPoliciesService } from './cqc-mock-inspection-policies.service';

/**
 * Governance → Mock CQC inspection. Reads the framework and evidence from CqcEvidenceModule, and the
 * ready-made surveys and policies for each statement from SurveysModule and PoliciesModule.
 */
@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    CqcEvidenceModule,
    SurveysModule,
    PoliciesModule,
  ],
  controllers: [CqcMockInspectionController],
  providers: [
    CqcMockInspectionService,
    CqcMockInspectionSurveysService,
    CqcMockInspectionPoliciesService,
  ],
  // The CQC evidence pack adds the published policies behind each statement.
  exports: [CqcMockInspectionPoliciesService],
})
export class CqcMockInspectionModule {}
