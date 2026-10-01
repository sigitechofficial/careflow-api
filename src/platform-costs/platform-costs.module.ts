import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { PlatformCostsController } from './platform-costs.controller';
import { PlatformCostsService } from './platform-costs.service';
import { PlatformCostsDataService } from './platform-costs-data.service';
import { PlatformCostsAzureGateway } from './platform-costs-azure.gateway';
import { PlatformCostsSyncService } from './platform-costs-sync.service';
import { PlatformCostsAnomalyService } from './platform-costs-anomaly.service';
import { PlatformCostsReportService } from './platform-costs-report.service';
import { PlatformCostsJobs } from './platform-costs.jobs';

/** Azure Pricing: read-only Azure cost/price mirror, estimator, anomalies, monthly report. */
@Module({
  imports: [
    PrismaModule,
    ScheduleModule,
    AuditLogsModule,
    NotificationsModule,
    OrganisationGeneralSettingsModule,
  ],
  controllers: [PlatformCostsController],
  providers: [
    PlatformCostsAzureGateway,
    PlatformCostsDataService,
    PlatformCostsService,
    PlatformCostsAnomalyService,
    PlatformCostsSyncService,
    PlatformCostsReportService,
    PlatformCostsJobs,
  ],
})
export class PlatformCostsModule {}
