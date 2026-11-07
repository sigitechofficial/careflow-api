import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { CqcEvidenceController } from './cqc-evidence.controller';
import { CqcEvidenceService } from './cqc-evidence.service';
import { CqcFrameworkService } from './cqc-framework.service';
import { CqcSurveyEvidenceService } from './cqc-survey-evidence.service';

/**
 * Quality & compliance → CQC evidence. Surveys feed it through CqcSurveyEvidenceService (exported
 * for SurveysModule); policies, audits, incidents, training, complaints and compliments can feed
 * it later the same way (a service call that creates CqcEvidence with their sourceType/sourceId).
 * Does not import SurveysModule, so there is no cycle.
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [CqcEvidenceController],
  providers: [CqcEvidenceService, CqcFrameworkService, CqcSurveyEvidenceService],
  exports: [CqcEvidenceService, CqcFrameworkService, CqcSurveyEvidenceService],
})
export class CqcEvidenceModule {}
