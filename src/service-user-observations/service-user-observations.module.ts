import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ServiceUserObservationsController } from './service-user-observations.controller';
import { ServiceUserObservationsService } from './service-user-observations.service';
import { VisitObservationsCatalogService } from './visit-observations-catalog.service';

@Module({
  imports: [AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [ServiceUserObservationsController],
  providers: [ServiceUserObservationsService, VisitObservationsCatalogService],
  exports: [ServiceUserObservationsService, VisitObservationsCatalogService],
})
export class ServiceUserObservationsModule {}
