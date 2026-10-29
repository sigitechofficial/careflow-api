import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';
import { QuotationsController } from './quotations/quotations.controller';
import { QuotationsService } from './quotations/quotations.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, OrganisationGeneralSettingsModule, ServiceUserVisitPlansModule],
  controllers: [CrmController, QuotationsController],
  providers: [CrmService, QuotationsService],
  exports: [CrmService],
})
export class CrmModule {}
