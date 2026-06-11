import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LookupsModule } from '../lookups/lookups.module';
import { InitialAssessmentTemplatesController } from './initial-assessment-templates.controller';
import { InitialAssessmentTemplatesService } from './initial-assessment-templates.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, LookupsModule],
  controllers: [InitialAssessmentTemplatesController],
  providers: [InitialAssessmentTemplatesService],
  exports: [InitialAssessmentTemplatesService],
})
export class InitialAssessmentTemplatesModule {}
