import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SafeguardingController } from './safeguarding.controller';
import { SafeguardingService } from './safeguarding.service';
import { SafeguardingInvestigationService } from './safeguarding-investigation.service';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [SafeguardingController],
  providers: [SafeguardingService, SafeguardingInvestigationService],
  exports: [SafeguardingService],
})
export class SafeguardingModule {}
