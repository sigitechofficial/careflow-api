import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';
import { InitialAssessmentsModule } from '../initial-assessments/initial-assessments.module';
import { QuotationsController } from './quotations/quotations.controller';
import { QuotationsService } from './quotations/quotations.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, OrganisationGeneralSettingsModule, ServiceUserVisitPlansModule, InitialAssessmentsModule],
  controllers: [CrmController, QuotationsController],
  providers: [CrmService, QuotationsService],
  exports: [CrmService],
})
export class CrmModule {}
