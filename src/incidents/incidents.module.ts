import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BodyMapModule } from '../body-map/body-map.module';
import { EmployeesModule } from '../employees/employees.module';
import { LearningModule } from '../learning/learning.module';
import { UsersModule } from '../users/users.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { IncidentCareController } from './incident-care.controller';
import { IncidentCareService } from './incident-care.service';
import { IncidentAnalyticsService } from './incident-analytics.service';
import { IncidentCandourController } from './incident-candour.controller';
import { IncidentCandourService } from './incident-candour.service';
import { IncidentSuspensionStartJob } from './incident-suspension-start.job';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    NotificationsModule,
    BodyMapModule,
    EmployeesModule,
    LearningModule,
    UsersModule,
    OrganisationGeneralSettingsModule,
  ],
  controllers: [IncidentsController, IncidentCareController, IncidentCandourController],
  providers: [
    IncidentsService,
    IncidentCareService,
    IncidentAnalyticsService,
    IncidentCandourService,
    IncidentSuspensionStartJob,
  ],
  exports: [IncidentsService],
})
export class IncidentsModule {}
