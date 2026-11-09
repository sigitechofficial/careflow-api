import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ServiceUserPrivacyController } from './service-user-privacy.controller';
import { ServiceUserPrivacyService } from './service-user-privacy.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [ServiceUserPrivacyController],
  providers: [ServiceUserPrivacyService],
  exports: [ServiceUserPrivacyService],
})
export class ServiceUserPrivacyModule {}
