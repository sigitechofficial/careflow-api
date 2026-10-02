import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ComplianceReportsModule } from '../compliance-reports/compliance-reports.module';
import { ServiceUserCarePlansModule } from '../service-user-care-plans/service-user-care-plans.module';
import { ServiceUserAssessmentsModule } from '../service-user-assessments/service-user-assessments.module';
import { SetupChecklistController } from './setup-checklist.controller';
import { SetupChecklistService } from './setup-checklist.service';

@Module({
  imports: [
    PrismaModule,
    OrganisationGeneralSettingsModule,
    ComplianceReportsModule,
    ServiceUserCarePlansModule,
    ServiceUserAssessmentsModule,
  ],
  controllers: [SetupChecklistController],
  providers: [SetupChecklistService],
})
export class SetupChecklistModule {}
