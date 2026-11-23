import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { QualityAuditsController } from './quality-audits.controller';
import { QualityAuditsService } from './quality-audits.service';
import { QualityAuditTemplatesService } from './quality-audit-templates.service';
import { QualityAuditSchedulesService } from './quality-audit-schedules.service';

/** Governance → Audits: areas, templates (library and your own), schedules and audits. */
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [QualityAuditsController],
  providers: [
    QualityAuditsService,
    QualityAuditTemplatesService,
    QualityAuditSchedulesService,
  ],
  exports: [QualityAuditsService],
})
export class QualityAuditsModule {}
