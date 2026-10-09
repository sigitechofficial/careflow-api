import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { HomeSignalsService } from './home-signals.service';
import { MedicationOverviewService } from './medication-overview.service';

@Module({
  imports: [PrismaModule, OrganisationGeneralSettingsModule],
  controllers: [DashboardController],
  providers: [DashboardService, HomeSignalsService, MedicationOverviewService],
})
export class DashboardModule {}
