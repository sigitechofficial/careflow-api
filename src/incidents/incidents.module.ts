import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BodyMapModule } from '../body-map/body-map.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { IncidentCareController } from './incident-care.controller';
import { IncidentCareService } from './incident-care.service';
import { IncidentAnalyticsService } from './incident-analytics.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule, BodyMapModule],
  controllers: [IncidentsController, IncidentCareController],
  providers: [IncidentsService, IncidentCareService, IncidentAnalyticsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
